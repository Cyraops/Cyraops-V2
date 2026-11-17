import { PrismaClient, CallStatus, ParticipantStatus, CallEventType, OutboxJobStatus } from "@prisma/client";
import { NextRequest } from "next/server";
import { createHash } from "node:crypto";

const TEST_DB_URL = "postgresql://tanveersinghsaini:@localhost:5432/company_os_sfu_test";
process.env.DATABASE_URL = TEST_DB_URL;
process.env.LIVEKIT_URL = "http://localhost:7880";
process.env.LIVEKIT_API_KEY = "devkey";
process.env.LIVEKIT_API_SECRET = "devsecret";

const db = new PrismaClient({ datasources: { db: { url: TEST_DB_URL } } });
(globalThis as any).prisma = db;

// Import application modules after pointing global prisma to test database
import { PATCH as teamMemberRoute } from "../src/app/api/team/[id]/route";
import {
  createCallSession,
  acceptCallInvitation,
  ejectUserFromActiveCalls,
} from "../src/lib/calling/state-machine";
import {
  queueSfuEjection,
  executeSfuEjectionJob,
  processPendingSfuEjectionJobs,
  recoverStuckOutboxJobs,
  triggerImmediateSfuEjection,
  calculateBackoffMs,
  isNotFoundError,
  setGlobalSfuClientForTesting,
} from "../src/lib/calling/outbox";

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

// Helper to create mock authenticated request
function createMockRequest(url: string, options: { method?: string; body?: any; cookieToken?: string } = {}) {
  const headers = new Headers();
  headers.set("origin", "http://localhost:3001");
  headers.set("host", "localhost:3001");
  headers.set("content-type", "application/json");
  if (options.cookieToken) {
    headers.set("cookie", `company_session=${options.cookieToken}`);
  }

  const init: any = {
    method: options.method || "PATCH",
    headers,
  };

  if (options.body) {
    init.body = typeof options.body === "string" ? options.body : JSON.stringify(options.body);
  }

  return new NextRequest(new URL(url, "http://localhost:3001"), init);
}

// Mock SFU RoomServiceClient recorder
class MockRoomServiceClient {
  public calls: Array<{ roomName: string; identity: string }> = [];
  public failureMode: "NONE" | "NETWORK_ERROR" | "NOT_FOUND" = "NONE";
  public failureMessage: string = "connect ECONNREFUSED 127.0.0.1:7880";

  async removeParticipant(roomName: string, identity: string): Promise<any> {
    if (this.failureMode === "NETWORK_ERROR") {
      throw new Error(this.failureMessage);
    }
    if (this.failureMode === "NOT_FOUND") {
      const err: any = new Error("could not find participant");
      err.status = 404;
      throw err;
    }
    this.calls.push({ roomName, identity });
    return {};
  }

  reset() {
    this.calls = [];
    this.failureMode = "NONE";
    this.failureMessage = "connect ECONNREFUSED 127.0.0.1:7880";
  }
}

const mockSfu = new MockRoomServiceClient();

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
  console.log("CYRAOPS VERIFICATION: SFU EJECTION & TRANSACTIONAL OUTBOX ENGINE");
  console.log("======================================================================");

  setGlobalSfuClientForTesting(mockSfu);

  // -------------------------------------------------------------------------
  // TEST SCENARIO 1: Ordinary Participant Ejection
  // -------------------------------------------------------------------------
  console.log("\n[TEST SCENARIO 1] Ordinary Participant Ejection via Admin Team PATCH");
  await cleanDb();
  mockSfu.reset();

  const owner1 = await db.user.create({ data: { name: "Owner 1", email: "owner1@cyraops.com", role: "OWNER" } });
  const bob1 = await db.user.create({ data: { name: "Bob 1", email: "bob1@cyraops.com", role: "MEMBER" } });

  const ownerTok1 = "tok_owner_1";
  await db.session.create({
    data: { id: "sess_owner1", tokenHash: createHash("sha256").update(ownerTok1).digest("hex"), userId: owner1.id, expiresAt: new Date(Date.now() + 86400000) },
  });

  const bobTok1 = "tok_bob_1";
  await db.session.create({
    data: { id: "sess_bob1", tokenHash: createHash("sha256").update(bobTok1).digest("hex"), userId: bob1.id, expiresAt: new Date(Date.now() + 86400000) },
  });

  const conv1 = await db.conversation.create({
    data: {
      type: "DIRECT",
      members: { createMany: { data: [{ userId: owner1.id }, { userId: bob1.id }] } },
    },
  });

  const callRes1 = await createCallSession(db, { conversationId: conv1.id, initiatorId: owner1.id, inviteeIds: [bob1.id] });
  const call1 = callRes1.call!;
  await acceptCallInvitation(db, call1.id, bob1.id);

  // Transition Bob to CONNECTED
  await db.callParticipant.updateMany({
    where: { callSessionId: call1.id, userId: bob1.id },
    data: { status: ParticipantStatus.CONNECTED },
  });

  // Admin Owner disables Bob
  const req1 = createMockRequest(`/api/team/${bob1.id}`, {
    cookieToken: ownerTok1,
    body: { disabled: true },
  });
  const res1 = await teamMemberRoute(req1, { params: Promise.resolve({ id: bob1.id }) });
  assert(res1.status === 200, "Team PATCH endpoint returned HTTP 200");

  const bob1Db = await db.user.findUnique({ where: { id: bob1.id } });
  assert(bob1Db?.disabledAt !== null, "Bob account has disabledAt set");

  const bob1Sessions = await db.session.count({ where: { userId: bob1.id } });
  assert(bob1Sessions === 0, "Bob sessions revoked (count = 0)");

  const bob1Part = await db.callParticipant.findFirst({ where: { callSessionId: call1.id, userId: bob1.id } });
  assert(bob1Part?.status === ParticipantStatus.EJECTED, "Bob participant status is EJECTED in DB");

  const outboxJob1 = await db.callSfuEjectionJob.findFirst({
    where: { callSessionId: call1.id, userId: bob1.id },
  });
  assert(outboxJob1 !== null, "CallSfuEjectionJob record was created in PostgreSQL");
  assert(outboxJob1?.status === OutboxJobStatus.COMPLETED, "Outbox job marked COMPLETED by immediate post-commit runner");
  assert(outboxJob1?.roomName === call1.livekitRoomName, "Outbox job roomName matches call.livekitRoomName");
  assert(mockSfu.calls.length === 1, "Mock SFU client received removeParticipant call");
  assert(mockSfu.calls[0]?.roomName === call1.livekitRoomName && mockSfu.calls[0]?.identity === bob1.id, "Mock SFU received correct room and identity");

  // -------------------------------------------------------------------------
  // TEST SCENARIO 2: Host Ejection with Automatic Handoff
  // -------------------------------------------------------------------------
  console.log("\n[TEST SCENARIO 2] Host Ejection with Automatic Handoff in Group Call");
  await cleanDb();
  mockSfu.reset();

  const owner2 = await db.user.create({ data: { name: "Owner 2", email: "owner2@cyraops.com", role: "OWNER" } });
  const host2 = await db.user.create({ data: { name: "Host Alice", email: "host2@cyraops.com", role: "ADMIN" } });
  const memberBob2 = await db.user.create({ data: { name: "Member Bob", email: "bob2@cyraops.com", role: "MEMBER" } });
  const memberCharlie2 = await db.user.create({ data: { name: "Member Charlie", email: "charlie2@cyraops.com", role: "MEMBER" } });

  const ownerTok2 = "tok_owner_2";
  await db.session.create({
    data: { id: "sess_owner2", tokenHash: createHash("sha256").update(ownerTok2).digest("hex"), userId: owner2.id, expiresAt: new Date(Date.now() + 86400000) },
  });

  const conv2 = await db.conversation.create({
    data: {
      type: "GROUP",
      name: "Strategy Meeting",
      members: {
        createMany: {
          data: [
            { userId: host2.id },
            { userId: memberBob2.id },
            { userId: memberCharlie2.id },
          ],
        },
      },
    },
  });

  const callRes2 = await createCallSession(db, {
    conversationId: conv2.id,
    initiatorId: host2.id,
    inviteeIds: [memberBob2.id, memberCharlie2.id],
  });
  const call2 = callRes2.call!;
  await acceptCallInvitation(db, call2.id, memberBob2.id);
  await acceptCallInvitation(db, call2.id, memberCharlie2.id);

  // Transition all 3 to CONNECTED, call to ACTIVE
  await db.callParticipant.updateMany({
    where: { callSessionId: call2.id },
    data: { status: ParticipantStatus.CONNECTED },
  });
  await db.callSession.update({
    where: { id: call2.id },
    data: { status: CallStatus.ACTIVE },
  });

  // Owner disables Host Alice
  const req2 = createMockRequest(`/api/team/${host2.id}`, {
    cookieToken: ownerTok2,
    body: { disabled: true },
  });
  const res2 = await teamMemberRoute(req2, { params: Promise.resolve({ id: host2.id }) });
  assert(res2.status === 200, "Team PATCH returned 200 for host disable");

  const host2Part = await db.callParticipant.findFirst({ where: { callSessionId: call2.id, userId: host2.id } });
  assert(host2Part?.status === ParticipantStatus.EJECTED, "Host participant status marked EJECTED in DB");
  assert(host2Part?.isHost === false, "Host participant isHost reset to false");

  const call2Db = await db.callSession.findUnique({ where: { id: call2.id } });
  assert(call2Db?.status === CallStatus.ACTIVE, "Group call remains ACTIVE after host ejection");
  assert(call2Db?.hostId !== host2.id, "Host was reassigned away from disabled user");
  assert(call2Db?.hostId === memberBob2.id || call2Db?.hostId === memberCharlie2.id, "New host is an active call member");

  const newHostPart = await db.callParticipant.findFirst({ where: { callSessionId: call2.id, userId: call2Db!.hostId } });
  assert(newHostPart?.isHost === true, "New host participant record has isHost = true");

  const hostOutboxJob = await db.callSfuEjectionJob.findFirst({ where: { callSessionId: call2.id, userId: host2.id } });
  assert(hostOutboxJob?.status === OutboxJobStatus.COMPLETED, "Host SFU ejection job completed");
  assert(mockSfu.calls.some((c) => c.identity === host2.id), "Mock SFU client evicted former host");

  // -------------------------------------------------------------------------
  // TEST SCENARIO 3: Multi-Call Ejection
  // -------------------------------------------------------------------------
  console.log("\n[TEST SCENARIO 3] Multi-Call Ejection Across Concurrent Sessions");
  await cleanDb();
  mockSfu.reset();

  const owner3 = await db.user.create({ data: { name: "Owner 3", email: "owner3@cyraops.com", role: "OWNER" } });
  const multiUser = await db.user.create({ data: { name: "Multi User", email: "multi@cyraops.com", role: "MEMBER" } });
  const peerA = await db.user.create({ data: { name: "Peer A", email: "peera@cyraops.com", role: "MEMBER" } });
  const peerB = await db.user.create({ data: { name: "Peer B", email: "peerb@cyraops.com", role: "MEMBER" } });

  const ownerTok3 = "tok_owner_3";
  await db.session.create({
    data: { id: "sess_owner3", tokenHash: createHash("sha256").update(ownerTok3).digest("hex"), userId: owner3.id, expiresAt: new Date(Date.now() + 86400000) },
  });

  const conv3A = await db.conversation.create({
    data: { type: "DIRECT", members: { createMany: { data: [{ userId: peerA.id }, { userId: multiUser.id }] } } },
  });
  const conv3B = await db.conversation.create({
    data: { type: "DIRECT", members: { createMany: { data: [{ userId: peerB.id }, { userId: multiUser.id }] } } },
  });

  const callA = (await createCallSession(db, { conversationId: conv3A.id, initiatorId: peerA.id, inviteeIds: [multiUser.id] })).call!;
  const callB = (await createCallSession(db, { conversationId: conv3B.id, initiatorId: peerB.id, inviteeIds: [multiUser.id] })).call!;

  await acceptCallInvitation(db, callA.id, multiUser.id);
  await acceptCallInvitation(db, callB.id, multiUser.id);

  // Disable multiUser
  const req3 = createMockRequest(`/api/team/${multiUser.id}`, { cookieToken: ownerTok3, body: { disabled: true } });
  const res3 = await teamMemberRoute(req3, { params: Promise.resolve({ id: multiUser.id }) });
  assert(res3.status === 200, "Team PATCH returned 200 for multi-call user");

  const jobs3 = await db.callSfuEjectionJob.findMany({ where: { userId: multiUser.id } });
  assert(jobs3.length === 2, "Created exactly 2 outbox jobs (1 per active call)");
  assert(jobs3.every((j) => j.status === OutboxJobStatus.COMPLETED), "All outbox jobs marked COMPLETED");

  const roomNames = jobs3.map((j) => j.roomName);
  assert(roomNames.includes(callA.livekitRoomName) && roomNames.includes(callB.livekitRoomName), "Outbox jobs correspond to both LiveKit rooms");
  assert(mockSfu.calls.length === 2, "Mock SFU client received ejections for both rooms");

  // -------------------------------------------------------------------------
  // TEST SCENARIO 4: LiveKit Unavailable at Disable Time & Recovery
  // -------------------------------------------------------------------------
  console.log("\n[TEST SCENARIO 4] LiveKit Unavailable at Disable Time with Clean Recovery");
  await cleanDb();
  mockSfu.reset();

  const owner4 = await db.user.create({ data: { name: "Owner 4", email: "owner4@cyraops.com", role: "OWNER" } });
  const target4 = await db.user.create({ data: { name: "Target 4", email: "target4@cyraops.com", role: "MEMBER" } });
  const peer4 = await db.user.create({ data: { name: "Peer 4", email: "peer4@cyraops.com", role: "MEMBER" } });

  const ownerTok4 = "tok_owner_4";
  await db.session.create({
    data: { id: "sess_owner4", tokenHash: createHash("sha256").update(ownerTok4).digest("hex"), userId: owner4.id, expiresAt: new Date(Date.now() + 86400000) },
  });

  const conv4 = await db.conversation.create({
    data: { type: "DIRECT", members: { createMany: { data: [{ userId: peer4.id }, { userId: target4.id }] } } },
  });
  const call4 = (await createCallSession(db, { conversationId: conv4.id, initiatorId: peer4.id, inviteeIds: [target4.id] })).call!;
  await acceptCallInvitation(db, call4.id, target4.id);

  // SIMULATE LIVEKIT DOWN
  mockSfu.failureMode = "NETWORK_ERROR";
  mockSfu.failureMessage = "connect ECONNREFUSED 127.0.0.1:7880";

  const req4 = createMockRequest(`/api/team/${target4.id}`, { cookieToken: ownerTok4, body: { disabled: true } });
  const res4 = await teamMemberRoute(req4, { params: Promise.resolve({ id: target4.id }) });
  assert(res4.status === 200, "Team PATCH succeeded despite LiveKit being down (non-blocking)");

  const target4Db = await db.user.findUnique({ where: { id: target4.id } });
  assert(target4Db?.disabledAt !== null, "User is securely disabled in PostgreSQL");

  const job4 = await db.callSfuEjectionJob.findFirst({ where: { userId: target4.id } });
  assert(job4 !== null, "Outbox job exists in database");
  assert(job4?.status === OutboxJobStatus.PENDING, "Job remains PENDING for retry");
  assert(job4?.attempts === 1, "Job attempts recorded as 1");
  assert(job4?.lastError?.includes("ECONNREFUSED") === true, "lastError records network failure message");
  assert(Boolean(job4?.nextRetryAt && job4.nextRetryAt > job4.createdAt), "nextRetryAt is scheduled in future");

  // RESTORE LIVEKIT AND RUN SWEEPER
  mockSfu.failureMode = "NONE";
  // Fast-forward nextRetryAt so sweeper picks it up immediately
  await db.callSfuEjectionJob.update({ where: { id: job4!.id }, data: { nextRetryAt: new Date(Date.now() - 1000) } });

  const sweepRes4 = await processPendingSfuEjectionJobs({ dbClient: db, roomClient: mockSfu });
  assert(sweepRes4.processed === 1 && sweepRes4.succeeded === 1, "Background worker processed and succeeded upon LiveKit recovery");

  const job4Recovered = await db.callSfuEjectionJob.findUnique({ where: { id: job4!.id } });
  assert(job4Recovered?.status === OutboxJobStatus.COMPLETED, "Job status transitioned to COMPLETED");

  // -------------------------------------------------------------------------
  // TEST SCENARIO 5: Bounded Exponential Backoff & Max Attempts
  // -------------------------------------------------------------------------
  console.log("\n[TEST SCENARIO 5] Bounded Exponential Backoff & Max Attempts (Failure)");
  await cleanDb();
  mockSfu.reset();

  // Test calculateBackoffMs sequence
  const b1 = calculateBackoffMs(1, 1000);
  const b2 = calculateBackoffMs(2, 1000);
  const b3 = calculateBackoffMs(3, 1000);
  const b4 = calculateBackoffMs(4, 1000);
  const b5 = calculateBackoffMs(5, 1000);
  const bCap = calculateBackoffMs(10, 1000);
  assert(b1 === 1000 && b2 === 2000 && b3 === 4000 && b4 === 8000 && b5 === 16000, "Exponential backoff progression is exact (1s, 2s, 4s, 8s, 16s)");
  assert(bCap === 30000, "Exponential backoff is strictly capped at 30,000ms");

  const dummyUser = await db.user.create({ data: { name: "Dummy", email: "dummy@cyraops.com", role: "MEMBER" } });
  const dummyPeer = await db.user.create({ data: { name: "Dummy Peer", email: "dummypeer@cyraops.com", role: "MEMBER" } });
  const dummyConv = await db.conversation.create({ data: { type: "DIRECT", members: { createMany: { data: [{ userId: dummyUser.id }, { userId: dummyPeer.id }] } } } });
  const dummyCall = (await createCallSession(db, { conversationId: dummyConv.id, initiatorId: dummyUser.id, inviteeIds: [dummyPeer.id] })).call!;

  const testJob = await queueSfuEjection(db, {
    callSessionId: dummyCall.id,
    roomName: dummyCall.livekitRoomName,
    userId: dummyUser.id,
    maxAttempts: 3,
  });

  mockSfu.failureMode = "NETWORK_ERROR";
  mockSfu.failureMessage = "ETIMEDOUT: LiveKit gateway unreachable";

  // Attempt 1
  let run1 = await executeSfuEjectionJob(testJob.id, { dbClient: db, roomClient: mockSfu, backoffBaseMs: 10 });
  assert(!run1.success && run1.job?.status === OutboxJobStatus.PENDING && run1.job?.attempts === 1, "Attempt 1 failed: status=PENDING, attempts=1");

  // Attempt 2
  let run2 = await executeSfuEjectionJob(testJob.id, { dbClient: db, roomClient: mockSfu, backoffBaseMs: 10 });
  assert(!run2.success && run2.job?.status === OutboxJobStatus.PENDING && run2.job?.attempts === 2, "Attempt 2 failed: status=PENDING, attempts=2");

  // Attempt 3 (reaches maxAttempts=3)
  let run3 = await executeSfuEjectionJob(testJob.id, { dbClient: db, roomClient: mockSfu, backoffBaseMs: 10 });
  assert(!run3.success && run3.job?.status === OutboxJobStatus.FAILED && run3.job?.attempts === 3, "Attempt 3 reached maxAttempts: status=FAILED");

  // Verify retries stop on FAILED job
  let run4 = await executeSfuEjectionJob(testJob.id, { dbClient: db, roomClient: mockSfu, backoffBaseMs: 10 });
  assert(!run4.success && run4.error === "ETIMEDOUT: LiveKit gateway unreachable", "Retries stop immediately once FAILED");

  // -------------------------------------------------------------------------
  // TEST SCENARIO 6: Duplicate Disable Calls (Idempotency)
  // -------------------------------------------------------------------------
  console.log("\n[TEST SCENARIO 6] Duplicate Disable Calls Idempotency");
  await cleanDb();
  mockSfu.reset();

  const owner6 = await db.user.create({ data: { name: "Owner 6", email: "owner6@cyraops.com", role: "OWNER" } });
  const target6 = await db.user.create({ data: { name: "Target 6", email: "target6@cyraops.com", role: "MEMBER" } });
  const ownerTok6 = "tok_owner_6";
  await db.session.create({
    data: { id: "sess_owner6", tokenHash: createHash("sha256").update(ownerTok6).digest("hex"), userId: owner6.id, expiresAt: new Date(Date.now() + 86400000) },
  });

  const conv6 = await db.conversation.create({
    data: { type: "DIRECT", members: { createMany: { data: [{ userId: owner6.id }, { userId: target6.id }] } } },
  });
  const call6 = (await createCallSession(db, { conversationId: conv6.id, initiatorId: owner6.id, inviteeIds: [target6.id] })).call!;
  await acceptCallInvitation(db, call6.id, target6.id);

  // First disable call
  const req6A = createMockRequest(`/api/team/${target6.id}`, { cookieToken: ownerTok6, body: { disabled: true } });
  const res6A = await teamMemberRoute(req6A, { params: Promise.resolve({ id: target6.id }) });
  assert(res6A.status === 200, "First disable call returned 200");
  const countAfterFirst = await db.callSfuEjectionJob.count({ where: { userId: target6.id } });
  assert(countAfterFirst === 1, "Exactly 1 outbox job created after first disable");

  // Duplicate disable call
  const req6B = createMockRequest(`/api/team/${target6.id}`, { cookieToken: ownerTok6, body: { disabled: true } });
  const res6B = await teamMemberRoute(req6B, { params: Promise.resolve({ id: target6.id }) });
  assert(res6B.status === 200, "Second duplicate disable call returned 200 without error");

  const countAfterSecond = await db.callSfuEjectionJob.count({ where: { userId: target6.id } });
  assert(countAfterSecond === 1, "No phantom duplicate outbox jobs created (count remains 1)");

  // -------------------------------------------------------------------------
  // TEST SCENARIO 7: Outbox Crash Recovery
  // -------------------------------------------------------------------------
  console.log("\n[TEST SCENARIO 7] Outbox Crash Recovery for Stalled PROCESSING Jobs");
  await cleanDb();
  mockSfu.reset();

  const user7 = await db.user.create({ data: { name: "User 7", email: "user7@cyraops.com", role: "MEMBER" } });
  const peer7 = await db.user.create({ data: { name: "Peer 7", email: "peer7@cyraops.com", role: "MEMBER" } });
  const conv7 = await db.conversation.create({ data: { type: "DIRECT", members: { createMany: { data: [{ userId: user7.id }, { userId: peer7.id }] } } } });
  const call7 = (await createCallSession(db, { conversationId: conv7.id, initiatorId: user7.id, inviteeIds: [peer7.id] })).call!;

  const stuckJob = await db.callSfuEjectionJob.create({
    data: {
      callSessionId: call7.id,
      roomName: call7.livekitRoomName,
      userId: user7.id,
      status: OutboxJobStatus.PROCESSING,
      attempts: 1,
      maxAttempts: 5,
      updatedAt: new Date(Date.now() - 120000), // 2 minutes ago
    },
  });

  const recoveredCount = await recoverStuckOutboxJobs(db, 60000);
  assert(recoveredCount === 1, "recoverStuckOutboxJobs detected and recovered 1 stuck job");

  const recoveredJob = await db.callSfuEjectionJob.findUnique({ where: { id: stuckJob.id } });
  assert(recoveredJob?.status === OutboxJobStatus.PENDING, "Stuck job status reset from PROCESSING to PENDING");

  const processRes7 = await processPendingSfuEjectionJobs({ dbClient: db, roomClient: mockSfu });
  assert(processRes7.processed === 1 && processRes7.succeeded === 1, "Recovered job was swept and processed to completion");

  const finalJob7 = await db.callSfuEjectionJob.findUnique({ where: { id: stuckJob.id } });
  assert(finalJob7?.status === OutboxJobStatus.COMPLETED, "Final status is COMPLETED");

  // -------------------------------------------------------------------------
  // TEST SCENARIO 8: Participant Already Absent (Idempotent Success)
  // -------------------------------------------------------------------------
  console.log("\n[TEST SCENARIO 8] Participant Already Absent from SFU (Idempotent 404 Success)");
  await cleanDb();
  mockSfu.reset();

  const user8 = await db.user.create({ data: { name: "User 8", email: "user8@cyraops.com", role: "MEMBER" } });
  const peer8 = await db.user.create({ data: { name: "Peer 8", email: "peer8@cyraops.com", role: "MEMBER" } });
  const conv8 = await db.conversation.create({ data: { type: "DIRECT", members: { createMany: { data: [{ userId: user8.id }, { userId: peer8.id }] } } } });
  const call8 = (await createCallSession(db, { conversationId: conv8.id, initiatorId: user8.id, inviteeIds: [peer8.id] })).call!;

  // Configure SFU mock to throw 404 / could not find participant
  mockSfu.failureMode = "NOT_FOUND";

  const absentJob = await queueSfuEjection(db, {
    callSessionId: call8.id,
    roomName: call8.livekitRoomName,
    userId: user8.id,
  });

  const run8 = await executeSfuEjectionJob(absentJob.id, { dbClient: db, roomClient: mockSfu });
  assert(run8.success === true, "Absent participant ejection returned success (idempotent)");
  assert(run8.job?.status === OutboxJobStatus.COMPLETED, "Absent participant job marked COMPLETED");
  assert(run8.job?.lastError === null, "lastError is null (not treated as error)");

  // -------------------------------------------------------------------------
  // TEST SCENARIO 9: Database Transaction Consistency (No Network Calls in Tx)
  // -------------------------------------------------------------------------
  console.log("\n[TEST SCENARIO 9] DB Transaction Consistency (Zero SFU Network Calls in Tx)");
  await cleanDb();
  mockSfu.reset();

  const user9 = await db.user.create({ data: { name: "User 9", email: "user9@cyraops.com", role: "MEMBER" } });
  const peer9 = await db.user.create({ data: { name: "Peer 9", email: "peer9@cyraops.com", role: "MEMBER" } });
  const conv9 = await db.conversation.create({
    data: { type: "DIRECT", members: { createMany: { data: [{ userId: peer9.id }, { userId: user9.id }] } } },
  });
  const call9 = (await createCallSession(db, { conversationId: conv9.id, initiatorId: peer9.id, inviteeIds: [user9.id] })).call!;
  await acceptCallInvitation(db, call9.id, user9.id);

  let sfuCallsDuringTx = 0;
  let jobCreatedDuringTx: boolean = false;

  await db.$transaction(async (tx) => {
    // Eject user inside the transaction
    const ejectRes = await ejectUserFromActiveCalls(tx, user9.id);
    assert(ejectRes.ejectedCount === 1, "ejectUserFromActiveCalls ejected 1 active call in transaction");
    assert(ejectRes.queuedJobIds.length === 1, "1 outbox job ID returned from transaction");

    // Check SFU calls made DURING the transaction
    sfuCallsDuringTx = mockSfu.calls.length;

    // Verify job exists in DB within the transaction
    const jobInTx = await tx.callSfuEjectionJob.findUnique({ where: { id: ejectRes.queuedJobIds[0] } });
    jobCreatedDuringTx = jobInTx !== null && jobInTx.status === OutboxJobStatus.PENDING;
  });

  assert(sfuCallsDuringTx === 0, "Zero SFU network calls were made inside the Postgres transaction block");
  assert(Boolean(jobCreatedDuringTx), "Outbox job was committed in PENDING status inside the transaction");

  // Post-commit trigger outside transaction
  const committedJob = await db.callSfuEjectionJob.findFirst({ where: { userId: user9.id } });
  await triggerImmediateSfuEjection([committedJob!.id], { dbClient: db, roomClient: mockSfu });
  assert(mockSfu.calls.length === 1, "SFU network call executed strictly POST-COMMIT");

  const completedJob9 = await db.callSfuEjectionJob.findUnique({ where: { id: committedJob!.id } });
  assert(completedJob9?.status === OutboxJobStatus.COMPLETED, "Job completed cleanly post-commit");

  // -------------------------------------------------------------------------
  // FINAL SUMMARY
  // -------------------------------------------------------------------------
  console.log("\n======================================================================");
  console.log(`SFU EJECTION TEST RESULTS: ${passed} PASSED, ${failed} FAILED`);
  console.log("======================================================================");

  if (failed > 0) {
    process.exit(1);
  }
}

run()
  .catch((err) => {
    console.error("Test execution failed with unhandled error:", err);
    process.exit(1);
  })
  .finally(async () => {
    await db.$disconnect();
  });
