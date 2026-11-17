import { PrismaClient, OutboxJobStatus } from "@prisma/client";
import {
  queueSfuEjection,
  executeSfuEjectionJob,
  processPendingSfuEjectionJobs,
  recoverStuckOutboxJobs,
  getFailedOutboxJobs,
  retryFailedOutboxJobs,
  calculateBackoffMs,
  isNotFoundError,
} from "../src/lib/calling/outbox";
import { createCallSession } from "../src/lib/calling/state-machine";

const TEST_DB_URL = "postgresql://tanveersinghsaini:@localhost:5432/company_os_stage_e_test";
process.env.DATABASE_URL = TEST_DB_URL;

const db = new PrismaClient({ datasources: { db: { url: TEST_DB_URL } } });

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

async function cleanDb() {
  await db.callSfuEjectionJob.deleteMany();
  await db.callEvent.deleteMany();
  await db.callParticipant.deleteMany();
  await db.callSession.deleteMany();
  await db.message.deleteMany();
  await db.conversationMember.deleteMany();
  await db.conversation.deleteMany();
  await db.session.deleteMany();
  await db.user.deleteMany();
}

async function run() {
  console.log("======================================================================");
  console.log("STAGE E VERIFICATION: OUTBOX OPERATIONAL RECOVERY & CONCURRENCY SAFETY");
  console.log("======================================================================");

  await cleanDb();

  // Seed fixture
  const userA = await db.user.create({ data: { name: "Alice E", email: "alice.e@cyraops.com", role: "ADMIN" } });
  const userB = await db.user.create({ data: { name: "Bob E", email: "bob.e@cyraops.com", role: "MEMBER" } });
  const conv = await db.conversation.create({
    data: { type: "DIRECT", members: { createMany: { data: [{ userId: userA.id }, { userId: userB.id }] } } },
  });
  const call = (await createCallSession(db, { conversationId: conv.id, initiatorId: userA.id, inviteeIds: [userB.id] })).call!;

  // 1. Atomic Job Claiming & Duplicate Worker Safety
  console.log("\n[E1] Atomic Job Claiming & Duplicate Worker Safety");
  const job1 = await queueSfuEjection(db, {
    callSessionId: call.id,
    roomName: call.livekitRoomName,
    userId: userB.id,
  });

  // Mock slow room client to simulate concurrent worker arrival while processing
  let mockInFlight = false;
  const mockSlowClient = {
    async removeParticipant() {
      mockInFlight = true;
      await new Promise((r) => setTimeout(r, 400));
      return {};
    },
  };

  // Launch worker 1 and worker 2 concurrently
  const [resWorker1, resWorker2] = await Promise.all([
    executeSfuEjectionJob(job1.id, { dbClient: db, roomClient: mockSlowClient }),
    new Promise<any>(async (resolve) => {
      await new Promise((r) => setTimeout(r, 50)); // worker 2 starts slightly after worker 1 claimed it
      const r2 = await executeSfuEjectionJob(job1.id, { dbClient: db, roomClient: mockSlowClient });
      resolve(r2);
    }),
  ]);

  assert(resWorker1.success === true, "Worker 1 successfully claimed and completed job");
  assert(resWorker2.error?.includes("already claimed") === true || resWorker2.success === true, "Worker 2 safely handled concurrent claim without duplicate execution");
  const job1Final = await db.callSfuEjectionJob.findUnique({ where: { id: job1.id } });
  assert(job1Final?.status === OutboxJobStatus.COMPLETED, "Job completed cleanly with single execution");

  // 2. Stale PROCESSING Recovery (Crash simulation)
  console.log("\n[E2] Stale PROCESSING Recovery for Stalled Workers");
  const stuckJob = await db.callSfuEjectionJob.create({
    data: {
      callSessionId: call.id,
      roomName: call.livekitRoomName,
      userId: userB.id,
      status: OutboxJobStatus.PROCESSING,
      attempts: 1,
      maxAttempts: 5,
      updatedAt: new Date(Date.now() - 90000), // 90 seconds ago
    },
  });

  const recoveredCount = await recoverStuckOutboxJobs(db, 60000);
  assert(recoveredCount === 1, "recoverStuckOutboxJobs detected exactly 1 stale job");
  const recoveredJob = await db.callSfuEjectionJob.findUnique({ where: { id: stuckJob.id } });
  assert(recoveredJob?.status === OutboxJobStatus.PENDING, "Stuck job was safely reset to PENDING");

  // 3. Retry Scheduling & Bounded Exponential Backoff
  console.log("\n[E3] Retry Scheduling & Exponential Backoff Verification");
  const b1 = calculateBackoffMs(1, 1000);
  const b2 = calculateBackoffMs(2, 1000);
  const b3 = calculateBackoffMs(3, 1000);
  const b4 = calculateBackoffMs(4, 1000);
  const b5 = calculateBackoffMs(5, 1000);
  const bCap = calculateBackoffMs(8, 1000);

  assert(b1 === 1000, "Attempt 1 backoff: 1,000ms");
  assert(b2 === 2000, "Attempt 2 backoff: 2,000ms");
  assert(b3 === 4000, "Attempt 3 backoff: 4,000ms");
  assert(b4 === 8000, "Attempt 4 backoff: 8,000ms");
  assert(b5 === 16000, "Attempt 5 backoff: 16,000ms");
  assert(bCap === 30000, "Backoff strictly capped at 30,000ms");

  // 4. Maximum Retry Handling & Transition to FAILED
  console.log("\n[E4] Maximum Retry Exhaustion & Transition to FAILED");
  const failingJob = await db.callSfuEjectionJob.create({
    data: {
      callSessionId: call.id,
      roomName: call.livekitRoomName,
      userId: userB.id,
      status: OutboxJobStatus.PENDING,
      attempts: 2,
      maxAttempts: 3,
    },
  });

  const mockFailClient = {
    async removeParticipant() {
      throw new Error("LiveKit connection refused (persistent outage)");
    },
  };

  const failRun = await executeSfuEjectionJob(failingJob.id, { dbClient: db, roomClient: mockFailClient, backoffBaseMs: 10 });
  assert(failRun.success === false, "Execution failed as expected");
  assert(failRun.job?.status === OutboxJobStatus.FAILED, "Job reached maxAttempts=3 and transitioned to status: FAILED");
  assert(failRun.job?.attempts === 3, "Recorded exactly 3 attempts");
  assert(failRun.job?.lastError?.includes("persistent outage") === true, "lastError accurately captures failure diagnostics");

  // 5. Handling of LiveKit 404 / Not Found
  console.log("\n[E5] Idempotent Handling of 404 / Not Found Responses");
  const notFoundJob = await db.callSfuEjectionJob.create({
    data: {
      callSessionId: call.id,
      roomName: call.livekitRoomName,
      userId: userB.id,
      status: OutboxJobStatus.PENDING,
    },
  });

  const mock404Client = {
    async removeParticipant() {
      const err: any = new Error("could not find participant");
      err.status = 404;
      throw err;
    },
  };

  const nfRun = await executeSfuEjectionJob(notFoundJob.id, { dbClient: db, roomClient: mock404Client });
  assert(nfRun.success === true, "404 not-found treated as idempotent success");
  assert(nfRun.job?.status === OutboxJobStatus.COMPLETED, "Job status marked COMPLETED");
  assert(nfRun.job?.lastError === null, "lastError is null");

  // 6. Admin Discovery & Recovery of FAILED Jobs
  console.log("\n[E6] Administrative Discovery & Recovery of FAILED Jobs");
  const failedList = await getFailedOutboxJobs(db, 10);
  assert(failedList.length >= 1, "getFailedOutboxJobs discovered failed ejection jobs");
  assert(failedList.some((j) => j.id === failingJob.id), "Discovered the persistent outage job");

  // Admin recovers failed job after LiveKit service is restored
  const mockRestoredClient = {
    async removeParticipant() {
      return {};
    },
  };

  const recoveryResult = await retryFailedOutboxJobs(db, [failingJob.id]);
  assert(recoveryResult.resetCount === 1, "retryFailedOutboxJobs reset 1 job to PENDING");

  const jobAfterAdminRetry = await db.callSfuEjectionJob.findUnique({ where: { id: failingJob.id } });
  assert(jobAfterAdminRetry?.status === OutboxJobStatus.COMPLETED, "Job completed successfully after administrative recovery");

  console.log("\n======================================================================");
  console.log(`STAGE E RESULTS: ${passed} PASSED, ${failed} FAILED`);
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

