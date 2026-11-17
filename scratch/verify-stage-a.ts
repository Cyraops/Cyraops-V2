import { PrismaClient, CallStatus, ParticipantStatus, CallEventType, CallTerminationReason } from "@prisma/client";
import {
  createCallSession,
  inviteParticipants,
  acceptCallInvitation,
  ejectUserFromActiveCalls,
} from "../src/lib/calling/state-machine";
import {
  checkIdempotency,
  saveIdempotencyResponse,
  releaseIdempotencyReservation,
} from "../src/lib/calling/idempotency";

const TEST_DB_URL = "postgresql://tanveersinghsaini:@localhost:5432/company_os_stage_a_test";
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

async function run() {
  console.log("=================================================");
  console.log("STAGE A VERIFICATION: OUTSTANDING AUDIT FINDINGS");
  console.log("=================================================");

  // Setup test environment
  await db.callIdempotencyKey.deleteMany();
  await db.callEvent.deleteMany();
  await db.callParticipant.deleteMany();
  await db.callSession.deleteMany();
  await db.message.deleteMany();
  await db.conversationMember.deleteMany();
  await db.conversation.deleteMany();
  await db.session.deleteMany();
  await db.user.deleteMany();

  const userHost = await db.user.create({ data: { name: "Host User", email: "host@cyraops.com", role: "ADMIN" } });
  const userMember1 = await db.user.create({ data: { name: "Member One", email: "m1@cyraops.com", role: "MEMBER" } });
  const userMember2 = await db.user.create({ data: { name: "Member Two", email: "m2@cyraops.com", role: "MEMBER" } });
  const userMember3 = await db.user.create({ data: { name: "Member Three", email: "m3@cyraops.com", role: "MEMBER" } });

  const groupConv = await db.conversation.create({
    data: {
      name: "Engineering Standup",
      type: "GROUP",
      members: {
        create: [
          { userId: userHost.id },
          { userId: userMember1.id },
          { userId: userMember2.id },
          { userId: userMember3.id },
        ],
      },
    },
  });

  const directConv = await db.conversation.create({
    data: {
      type: "DIRECT",
      members: {
        create: [
          { userId: userHost.id },
          { userId: userMember1.id },
        ],
      },
    },
  });

  // ------------------------------------------------------------------------
  // TEST A1: Migration and Schema Verification
  // ------------------------------------------------------------------------
  console.log("\n--- [A1] Canonical Migration Verification ---");
  const migrations: any[] = await db.$queryRaw`SELECT migration_name FROM "_prisma_migrations" ORDER BY finished_at`;
  const migNames = migrations.map((m) => m.migration_name);
  assert(migNames.includes("20261105000000_calling_foundations_and_identity_hardening"), "Canonical migration recorded in _prisma_migrations");

  const tableCheck: any[] = await db.$queryRaw`
    SELECT tablename FROM pg_tables WHERE schemaname = 'public' AND tablename IN ('CallSession', 'CallParticipant', 'CallEvent', 'CallIdempotencyKey')
  `;
  assert(tableCheck.length === 4, "All 4 calling tables exist");

  const indexCheck: any[] = await db.$queryRaw`
    SELECT indexname FROM pg_indexes WHERE indexname = 'idx_call_session_unique_active_per_conv'
  `;
  assert(indexCheck.length === 1, "Partial unique active-call index exists");

  const triggerCheck: any[] = await db.$queryRaw`
    SELECT trigger_name FROM information_schema.triggers WHERE trigger_name = 'trg_session_identity_immutable'
  `;
  assert(triggerCheck.length === 1, "Session identity immutability trigger exists");

  // ------------------------------------------------------------------------
  // TEST A2: Account Disablement during Active Calls
  // ------------------------------------------------------------------------
  console.log("\n--- [A2] Account Disablement during Active Calls ---");

  // Subtest 1: Disable host in group call -> Ejected, host transferred to eligible participant
  const call1 = await createCallSession(db, {
    conversationId: groupConv.id,
    initiatorId: userHost.id,
    inviteeIds: [userMember1.id, userMember2.id],
  });
  assert(call1.success, "Group call created with userHost as host");
  await acceptCallInvitation(db, call1.call.id, userMember1.id);
  await acceptCallInvitation(db, call1.call.id, userMember2.id);

  // Proactively eject userHost (simulating admin disabling userHost)
  const ejectHostRes = await ejectUserFromActiveCalls(db, userHost.id, "admin_user");
  assert(ejectHostRes.ejectedCount === 1, "Host was marked EJECTED");
  assert(ejectHostRes.reassignedCallIds.includes(call1.call.id), "Call had host reassigned");

  const partHost = await db.callParticipant.findUnique({
    where: { callSessionId_userId: { callSessionId: call1.call.id, userId: userHost.id } },
  });
  assert(partHost?.status === ParticipantStatus.EJECTED, "Host participant status is EJECTED");
  assert(partHost?.isHost === false, "Ejected host isHost flag reset to false");

  const call1After = await db.callSession.findUnique({
    where: { id: call1.call.id },
    include: { participants: true },
  });
  assert(call1After?.status !== CallStatus.ENDED, "Group call remains active after host ejection");
  assert(call1After?.hostId === userMember1.id, "New host assigned to userMember1");
  const newHostPart = call1After?.participants.find((p) => p.userId === userMember1.id);
  assert(newHostPart?.isHost === true, "New host participant isHost flag is true");

  const hostEjectEvent = await db.callEvent.findFirst({
    where: { callSessionId: call1.call.id, type: CallEventType.PARTICIPANT_EJECTED, targetUserId: userHost.id },
  });
  assert(!!hostEjectEvent, "PARTICIPANT_EJECTED event recorded for host");

  const hostReassignedEvent = await db.callEvent.findFirst({
    where: { callSessionId: call1.call.id, type: CallEventType.HOST_REASSIGNED, targetUserId: userMember1.id },
  });
  assert(!!hostReassignedEvent, "HOST_REASSIGNED event recorded");

  // Subtest 2: Disable ordinary participant in group call -> Participant Ejected, call stays active
  const ejectMem2Res = await ejectUserFromActiveCalls(db, userMember2.id, "admin_user");
  assert(ejectMem2Res.ejectedCount === 1, "Ordinary participant marked EJECTED");
  assert(!ejectMem2Res.endedCallIds.includes(call1.call.id), "Call does not end while 1 active participant remains");

  // Subtest 3: Disable last remaining participant in group call -> Call ends
  const ejectMem1Res = await ejectUserFromActiveCalls(db, userMember1.id, "admin_user");
  assert(ejectMem1Res.ejectedCount === 1, "Last participant marked EJECTED");
  assert(ejectMem1Res.endedCallIds.includes(call1.call.id), "Call ended when last active participant ejected");
  const call1Final = await db.callSession.findUnique({ where: { id: call1.call.id } });
  assert(call1Final?.status === CallStatus.ENDED, "Call status is ENDED");

  // Subtest 4: Disable participant in 1-on-1 direct call -> Call terminates immediately
  const callDirect = await createCallSession(db, {
    conversationId: directConv.id,
    initiatorId: userHost.id,
    inviteeIds: [userMember1.id],
  });
  assert(callDirect.success, "1-on-1 call created");
  const ejectDirect = await ejectUserFromActiveCalls(db, userMember1.id, "admin_user");
  assert(ejectDirect.endedCallIds.includes(callDirect.call.id), "1-on-1 call ended immediately upon participant ejection");

  // ------------------------------------------------------------------------
  // TEST A3: Idempotency In-Flight Reservation Lifecycle
  // ------------------------------------------------------------------------
  console.log("\n--- [A3] Idempotency In-Flight Reservation Lifecycle ---");

  const testKey = "req_idem_12345";
  const payloadA = { conversationId: groupConv.id, type: "AUDIO" };
  const payloadB = { conversationId: groupConv.id, type: "VIDEO" };

  // 1. Worker 1 acquires reservation
  const res1 = await checkIdempotency(db, {
    key: testKey,
    userId: userHost.id,
    endpoint: "/api/calls",
    payload: payloadA,
  });
  assert(!res1.isDuplicate, "Worker 1 successfully acquired PENDING reservation");

  // 2. Concurrent Worker 2 with identical key and payload: IN_FLIGHT
  const res2 = await checkIdempotency(db, {
    key: testKey,
    userId: userHost.id,
    endpoint: "/api/calls",
    payload: payloadA,
  });
  assert(res2.isDuplicate && res2.inFlight === true, "Worker 2 detected concurrent request is IN_FLIGHT");

  // 3. Worker with same key but DIFFERENT payload: MISMATCH (422)
  const resMismatch = await checkIdempotency(db, {
    key: testKey,
    userId: userHost.id,
    endpoint: "/api/calls",
    payload: payloadB,
  });
  assert(resMismatch.isDuplicate && resMismatch.mismatch === true, "Payload mismatch detected (422)");

  // 4. Different user using same key: Scoped separately, acquires independent reservation
  const resUser2 = await checkIdempotency(db, {
    key: testKey,
    userId: userMember1.id,
    endpoint: "/api/calls",
    payload: payloadA,
  });
  assert(!resUser2.isDuplicate, "Different user gets independent scoped key reservation");

  // 5. Worker 1 completes and caches response (COMPLETED)
  await saveIdempotencyResponse(db, {
    key: testKey,
    userId: userHost.id,
    endpoint: "/api/calls",
    payload: payloadA,
    responseBody: { callId: "call_abc", status: "CREATED" },
    statusCode: 201,
  });

  // 6. Subsequent request replays cached response
  const resCached = await checkIdempotency(db, {
    key: testKey,
    userId: userHost.id,
    endpoint: "/api/calls",
    payload: payloadA,
  });
  assert(resCached.isDuplicate && !resCached.mismatch && resCached.cachedStatus === 201, "Subsequent request receives cached 201 response");
  assert(resCached.cachedResponse?.callId === "call_abc", "Cached response body matches original");

  // 7. Simulated process crash / abandoned PENDING reservation
  const crashKey = "req_crashed_999";
  await checkIdempotency(db, {
    key: crashKey,
    userId: userHost.id,
    endpoint: "/api/calls",
    payload: payloadA,
  });
  // Simulate crash by winding back lockedAt past TTL (e.g. 60 seconds ago)
  const scopedCrashKey = `${userHost.id}:/api/calls:${crashKey}`;
  await db.callIdempotencyKey.update({
    where: { key: scopedCrashKey },
    data: { lockedAt: new Date(Date.now() - 60_000) },
  });

  // Next worker detects expired lock and atomically takes over reservation
  const takeoverRes = await checkIdempotency(db, {
    key: crashKey,
    userId: userHost.id,
    endpoint: "/api/calls",
    payload: payloadA,
  });
  assert(!takeoverRes.isDuplicate, "Crashed/abandoned reservation was safely taken over by new worker");

  // ------------------------------------------------------------------------
  // TEST A4: Deterministic Secondary Pagination
  // ------------------------------------------------------------------------
  console.log("\n--- [A4] Deterministic Secondary Pagination ---");

  // Clear previous calls
  await db.callEvent.deleteMany();
  await db.callParticipant.deleteMany();
  await db.callSession.deleteMany();

  // Create 6 calls with the exact same millisecond timestamp
  const tieTimestamp = new Date("2026-11-05T03:00:00.000Z");
  const seededCalls = [];
  for (let i = 1; i <= 6; i++) {
    const c = await db.callSession.create({
      data: {
        id: `call_tied_${i.toString().padStart(2, "0")}`,
        conversationId: groupConv.id,
        initiatorId: userHost.id,
        hostId: userHost.id,
        livekitRoomName: `room_tie_${i}_${Date.now()}`,
        status: CallStatus.ENDED,
        createdAt: tieTimestamp,
      },
    });
    seededCalls.push(c);
  }

  // Fetch Page 1: take 2
  const page1 = await db.callSession.findMany({
    where: { conversationId: groupConv.id },
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    take: 3, // limit + 1
  });
  const page1Items = page1.slice(0, 2);
  const cursor1 = page1Items[page1Items.length - 1].id;

  // Fetch Page 2: take 2 with cursor
  const page2 = await db.callSession.findMany({
    where: { conversationId: groupConv.id },
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    take: 3,
    cursor: { id: cursor1 },
    skip: 1,
  });
  const page2Items = page2.slice(0, 2);
  const cursor2 = page2Items[page2Items.length - 1].id;

  // Fetch Page 3: take 2 with cursor
  const page3 = await db.callSession.findMany({
    where: { conversationId: groupConv.id },
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    take: 3,
    cursor: { id: cursor2 },
    skip: 1,
  });
  const page3Items = page3.slice(0, 2);

  const allPagedIds = [...page1Items.map((c) => c.id), ...page2Items.map((c) => c.id), ...page3Items.map((c) => c.id)];
  const uniquePagedIds = new Set(allPagedIds);

  assert(allPagedIds.length === 6, "All 6 items retrieved across 3 pages");
  assert(uniquePagedIds.size === 6, "Zero duplicates across pages despite tied timestamps");
  assert(allPagedIds[0] === "call_tied_06" && allPagedIds[5] === "call_tied_01", "Strict deterministic descending order verified (call_tied_06 down to call_tied_01)");

  console.log("\n=================================================");
  console.log(`STAGE A RESULTS: ${passed} PASSED, ${failed} FAILED`);
  console.log("=================================================");

  await db.$disconnect();
  process.exit(failed === 0 ? 0 : 1);
}

run().catch((err) => {
  console.error("Test execution failed:", err);
  process.exit(1);
});

