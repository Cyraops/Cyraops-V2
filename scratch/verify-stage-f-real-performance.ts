import { PrismaClient, CallStatus, ParticipantStatus, OutboxJobStatus } from "@prisma/client";
import { getRoomServiceClient, createLiveKitRoom, deleteLiveKitRoom } from "../src/lib/calling/livekit-room";
import {
  queueSfuEjection,
  executeSfuEjectionJob,
  processPendingSfuEjectionJobs,
  calculateBackoffMs,
} from "../src/lib/calling/outbox";
import { createCallSession } from "../src/lib/calling/state-machine";
import { createHash } from "node:crypto";
import { SignJWT } from "jose";

const DEV_DB_URL = "postgresql://tanveersinghsaini:@localhost:5432/company_os_dev";
process.env.DATABASE_URL = DEV_DB_URL;
process.env.LIVEKIT_URL = "http://127.0.0.1:7880";
process.env.LIVEKIT_API_KEY = "APITvqwWXCN6WPq";
process.env.LIVEKIT_API_SECRET = "p6x4uddeEd04ExrfJ0iuqubMfV75iesCMsv8xMB3NLcA";

const db = new PrismaClient({ datasources: { db: { url: DEV_DB_URL } } });

let passed = 0;
let failed = 0;

function assert(cond: boolean, msg: string) {
  if (cond) {
    console.log(`  ✔ PASS: ${msg}`);
    passed++;
  } else {
    console.error(`  ✖ FAIL: ${msg}`);
    failed++;
  }
}

async function createSignedWebhookHeader(rawBody: string, apiKey: string, apiSecret: string): Promise<string> {
  const hash = createHash("sha256").update(rawBody).digest("base64");
  return new SignJWT({ sha256: hash })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuer(apiKey)
    .setExpirationTime("1m")
    .sign(new TextEncoder().encode(apiSecret));
}

async function run() {
  console.log("======================================================================");
  console.log("STAGE F VERIFICATION: REAL LIVEKIT PERFORMANCE & RELIABILITY BATTERY");
  console.log("======================================================================");

  const roomService = getRoomServiceClient();

  // -------------------------------------------------------------------------
  // TEST F1: Multiple Simultaneous Room Creations
  // -------------------------------------------------------------------------
  console.log("\n[F1] Real-World Simultaneous Room Creation Concurrency & Latency");
  const batchSize = 10;
  const roomPrefix = `perf_room_${Date.now()}`;
  const roomNames = Array.from({ length: batchSize }, (_, i) => `${roomPrefix}_${i}`);

  const creationLatencies: number[] = [];
  const tStartBatch = Date.now();

  const creationResults = await Promise.all(
    roomNames.map(async (name) => {
      const t0 = Date.now();
      const res = await createLiveKitRoom({ roomName: name, maxParticipants: 20 });
      const duration = Date.now() - t0;
      creationLatencies.push(duration);
      return res;
    })
  );

  const tTotalBatch = Date.now() - tStartBatch;
  const avgLatency = (creationLatencies.reduce((a, b) => a + b, 0) / creationLatencies.length).toFixed(1);
  const minLatency = Math.min(...creationLatencies);
  const maxLatency = Math.max(...creationLatencies);

  console.log(`Measured Latencies: min=${minLatency}ms, max=${maxLatency}ms, avg=${avgLatency}ms, total batch=${tTotalBatch}ms`);
  assert(creationResults.every((r) => r === true), `All ${batchSize} concurrent rooms created successfully in LiveKit SFU`);

  // Verify all rooms physically exist on the SFU
  const listedRooms = await roomService.listRooms(roomNames);
  assert(listedRooms.length === batchSize, `Real LiveKit SFU confirms all ${batchSize} rooms are active`);

  // Clean up rooms
  await Promise.all(roomNames.map((name) => deleteLiveKitRoom(name)));
  const listedRoomsAfter = await roomService.listRooms(roomNames);
  assert(listedRoomsAfter.length === 0, "All benchmark rooms deleted cleanly from SFU");

  // -------------------------------------------------------------------------
  // TEST F2: Webhook Delivery Retries & High-Concurrency Duplicate Bursts
  // -------------------------------------------------------------------------
  console.log("\n[F2] Webhook High-Concurrency Duplicate Burst Idempotency");
  // Create a real call in DB
  const userHost = await db.user.create({ data: { name: "Perf Host", email: `perf_host_${Date.now()}@cyraops.com`, role: "ADMIN" } });
  const userGuest = await db.user.create({ data: { name: "Perf Guest", email: `perf_guest_${Date.now()}@cyraops.com`, role: "MEMBER" } });
  const conv = await db.conversation.create({
    data: { type: "DIRECT", members: { createMany: { data: [{ userId: userHost.id }, { userId: userGuest.id }] } } },
  });
  const call = (await createCallSession(db, { conversationId: conv.id, initiatorId: userHost.id, inviteeIds: [userGuest.id] })).call!;

  const webhookPayload = JSON.stringify({
    event: "participant_joined",
    room: { name: call.livekitRoomName, sid: "RM_perf_test" },
    participant: { identity: userGuest.id, sid: "PA_perf_guest" },
    createdAt: Date.now(),
  });

  const signedHeader = await createSignedWebhookHeader(webhookPayload, process.env.LIVEKIT_API_KEY!, process.env.LIVEKIT_API_SECRET!);

  // Fire 10 identical webhook requests simultaneously to live dev server
  const burstCount = 10;
  const tBurstStart = Date.now();
  const burstResponses = await Promise.all(
    Array.from({ length: burstCount }, async () => {
      const res = await fetch("http://127.0.0.1:3001/api/calls/webhook", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: signedHeader,
        },
        body: webhookPayload,
      });
      return res.status;
    })
  );
  const tBurstTotal = Date.now() - tBurstStart;
  console.log(`10 concurrent webhook deliveries completed in ${tBurstTotal}ms`);
  console.log("Burst status codes:", burstResponses);

  assert(burstResponses.every((s) => s === 200), `All 10 concurrent webhook deliveries returned HTTP 200 (statuses: ${burstResponses.join(",")})`);

  // Verify participant state is CONNECTED with zero corruptions
  const guestPart = await db.callParticipant.findFirst({ where: { callSessionId: call.id, userId: userGuest.id } });
  assert(guestPart?.status === ParticipantStatus.CONNECTED, "Participant safely transitioned to CONNECTED under concurrent burst");

  const eventsCount = await db.callEvent.count({
    where: { callSessionId: call.id, type: "PARTICIPANT_CONNECTED" as any, actorId: userGuest.id },
  });
  assert(eventsCount <= 1, `Zero duplicate lifecycle events recorded under concurrent burst (events count = ${eventsCount})`);

  // -------------------------------------------------------------------------
  // TEST F3: Outbox Worker Restart & Stalled Batch Recovery
  // -------------------------------------------------------------------------
  console.log("\n[F3] Outbox Worker Recovery for Queued Job Batches");
  const jobBatchSize = 5;
  const queuedJobIds: string[] = [];

  for (let i = 0; i < jobBatchSize; i++) {
    const job = await queueSfuEjection(db, {
      callSessionId: call.id,
      roomName: call.livekitRoomName,
      userId: `user_perf_${i}`,
    });
    queuedJobIds.push(job.id);
  }

  assert(queuedJobIds.length === jobBatchSize, `Queued batch of ${jobBatchSize} ejection jobs in PENDING status`);

  // Process batch using background worker
  const tSweepStart = Date.now();
  const sweepResult = await processPendingSfuEjectionJobs({ dbClient: db });
  const tSweepDuration = Date.now() - tSweepStart;
  console.log(`Outbox sweeper processed ${sweepResult.processed} jobs in ${tSweepDuration}ms (Succeeded: ${sweepResult.succeeded})`);

  assert(sweepResult.processed >= jobBatchSize, "All queued jobs processed by sweeper");
  assert(sweepResult.failed === 0, "Zero failures during batch processing");

  const completedJobs = await db.callSfuEjectionJob.findMany({ where: { id: { in: queuedJobIds } } });
  assert(completedJobs.every((j) => j.status === OutboxJobStatus.COMPLETED), "All batch jobs transitioned to COMPLETED");

  // -------------------------------------------------------------------------
  // TEST F4: Network Interruption Simulation & Graceful Recovery
  // -------------------------------------------------------------------------
  console.log("\n[F4] Simulated Network Interruption & Resilient Recovery");
  const outageJob = await queueSfuEjection(db, {
    callSessionId: call.id,
    roomName: call.livekitRoomName,
    userId: "outage_test_user",
  });

  // Attempt 1: Network outage
  const outageClient = {
    async removeParticipant() {
      throw new Error("connect ECONNREFUSED 127.0.0.1:7880");
    },
  };

  const failRes = await executeSfuEjectionJob(outageJob.id, { dbClient: db, roomClient: outageClient, backoffBaseMs: 50 });
  assert(failRes.success === false && failRes.job?.status === OutboxJobStatus.PENDING, "Outage handled gracefully: job remains PENDING with scheduled retry");
  assert(failRes.job?.attempts === 1, "Attempts incremented to 1");

  // Attempt 2: Network restored
  const restoredClient = {
    async removeParticipant() {
      return {};
    },
  };

  // Fast forward nextRetryAt
  await db.callSfuEjectionJob.update({ where: { id: outageJob.id }, data: { nextRetryAt: new Date(Date.now() - 100) } });
  const restoredRes = await executeSfuEjectionJob(outageJob.id, { dbClient: db, roomClient: restoredClient });
  assert(restoredRes.success === true && restoredRes.job?.status === OutboxJobStatus.COMPLETED, "Upon network restoration, job completed cleanly");

  // -------------------------------------------------------------------------
  // TEST F5: LiveKit Live Health Check & Backend Communication Health
  // -------------------------------------------------------------------------
  console.log("\n[F5] LiveKit SFU Health & Backend Daemon Inter-service Health");
  const sfuHealthRes = await fetch("http://127.0.0.1:7880/");
  assert(sfuHealthRes.status === 200, "LiveKit SFU root HTTP health check returns HTTP 200 OK");
  const sfuText = await sfuHealthRes.text();
  assert(sfuText.trim() === "OK", "LiveKit health response text is 'OK'");

  const backendHealthRes = await fetch("http://127.0.0.1:3001/api/health");
  assert(backendHealthRes.status === 200, "Cyraops dev backend health check returns HTTP 200 OK");
  const backendJson = await backendHealthRes.json();
  assert(backendJson.status === "ok" && backendJson.database === "connected", "Cyraops backend confirms database is connected");

  // Clean up perf test fixtures
  await db.callSfuEjectionJob.deleteMany({ where: { callSessionId: call.id } });
  await db.callParticipant.deleteMany({ where: { callSessionId: call.id } });
  await db.callEvent.deleteMany({ where: { callSessionId: call.id } });
  await db.callSession.delete({ where: { id: call.id } });
  await db.conversationMember.deleteMany({ where: { conversationId: conv.id } });
  await db.conversation.delete({ where: { id: conv.id } });
  await db.user.deleteMany({ where: { id: { in: [userHost.id, userGuest.id] } } });

  console.log("\n======================================================================");
  console.log(`STAGE F RESULTS: ${passed} PASSED, ${failed} FAILED`);
  console.log("======================================================================");

  if (failed > 0) {
    process.exit(1);
  }
}

run()
  .catch((err) => {
    console.error("Test failed:", err);
    process.exit(1);
  })
  .finally(async () => {
    await db.$disconnect();
  });
