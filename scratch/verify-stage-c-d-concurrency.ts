import { PrismaClient, CallStatus, ParticipantStatus, CallType } from "@prisma/client";
import { createCallSession, leaveCall } from "../src/lib/calling/state-machine";

const DEV_DB_URL = "postgresql://tanveersinghsaini:@localhost:5432/company_os_dev";
const db = new PrismaClient({ datasources: { db: { url: DEV_DB_URL } } });

async function run() {
  console.log("======================================================================");
  console.log("PHASE 4.2 VERIFICATION: BACKEND CONCURRENCY & BUSY REJECTION BATTERY");
  console.log("======================================================================");

  // Setup test users and conversations
  let userA = await db.user.findFirst({ where: { email: "audit_alice@cyraops.com" } });
  let userB = await db.user.findFirst({ where: { email: "audit_bob@cyraops.com" } });
  let userC = await db.user.findFirst({ where: { email: "audit_charlie@cyraops.com" } });

  if (!userA || !userB || !userC) {
    const existingUsers = await db.user.findMany({ take: 3 });
    userA = existingUsers[0];
    userB = existingUsers[1];
    userC = existingUsers[2];
  }

  console.log(`Users: A=${userA.name} (${userA.id}), B=${userB.name} (${userB.id}), C=${userC.name} (${userC.id})`);

  // Ensure two distinct conversations exist
  // Conv 1: A and B
  let conv1 = await db.conversation.findFirst({
    where: {
      type: "DIRECT",
      AND: [
        { members: { some: { userId: userA.id } } },
        { members: { some: { userId: userB.id } } },
      ],
    },
  });
  if (!conv1) {
    conv1 = await db.conversation.create({
      data: {
        type: "DIRECT",
        members: {
          create: [{ userId: userA.id }, { userId: userB.id }],
        },
      },
    });
  }

  // Conv 2: B and C
  let conv2 = await db.conversation.findFirst({
    where: {
      type: "DIRECT",
      AND: [
        { members: { some: { userId: userB.id } } },
        { members: { some: { userId: userC.id } } },
      ],
    },
  });
  if (!conv2) {
    conv2 = await db.conversation.create({
      data: {
        type: "DIRECT",
        members: {
          create: [{ userId: userB.id }, { userId: userC.id }],
        },
      },
    });
  }

  // Clean up any stale active calls
  await db.callSession.updateMany({
    where: {
      status: { in: [CallStatus.CREATED, CallStatus.RINGING, CallStatus.CONNECTING, CallStatus.ACTIVE] },
    },
    data: { status: CallStatus.ENDED },
  });

  // -------------------------------------------------------------------------
  // TEST 1: Cross-Conversation Busy Check (User B is ACTIVE in Conv 1)
  // -------------------------------------------------------------------------
  console.log("\n[TEST 1] Cross-conversation busy check: User B active in Call 1");
  const call1 = await db.callSession.create({
    data: {
      conversationId: conv1.id,
      type: "AUDIO",
      status: CallStatus.ACTIVE,
      initiatorId: userA.id,
      hostId: userA.id,
      livekitRoomName: `test_busy_active_${Date.now()}`,
      participants: {
        create: [
          { userId: userA.id, status: ParticipantStatus.CONNECTED, isHost: true },
          { userId: userB.id, status: ParticipantStatus.CONNECTED, isHost: false },
        ],
      },
    },
  });

  // Now User C attempts to call User B in Conv 2
  const res1 = await db.$transaction(async (tx) => {
    return createCallSession(tx, {
      conversationId: conv2.id,
      initiatorId: userC.id,
      type: CallType.AUDIO,
    });
  });

  if (!res1.success && res1.code === 409 && res1.error?.includes("on another call")) {
    console.log("  PASS: Call creation rejected with HTTP 409:", res1.error);
  } else {
    console.error("  FAIL: Expected 409 busy rejection, got:", res1);
    process.exit(1);
  }

  // -------------------------------------------------------------------------
  // TEST 2: Cross-Conversation Busy Check (User B is RINGING in Conv 1)
  // -------------------------------------------------------------------------
  console.log("\n[TEST 2] Cross-conversation busy check: User B ringing in Call 1");
  await db.callSession.update({
    where: { id: call1.id },
    data: { status: CallStatus.RINGING },
  });
  await db.callParticipant.updateMany({
    where: { callSessionId: call1.id, userId: userB.id },
    data: { status: ParticipantStatus.RINGING },
  });

  const res2 = await db.$transaction(async (tx) => {
    return createCallSession(tx, {
      conversationId: conv2.id,
      initiatorId: userC.id,
      type: CallType.AUDIO,
    });
  });

  if (!res2.success && res2.code === 409 && res2.error?.includes("on another call")) {
    console.log("  PASS: Call creation rejected when recipient is RINGING:", res2.error);
  } else {
    console.error("  FAIL: Expected 409 for RINGING state, got:", res2);
    process.exit(1);
  }

  // -------------------------------------------------------------------------
  // TEST 3: Initiator Busy Check (Initiator is already on a call)
  // -------------------------------------------------------------------------
  console.log("\n[TEST 3] Initiator busy check: User A already active in Call 1 attempts to call C");
  // Create conversation 3 between A and C
  let conv3 = await db.conversation.findFirst({
    where: {
      type: "DIRECT",
      AND: [
        { members: { some: { userId: userA.id } } },
        { members: { some: { userId: userC.id } } },
      ],
    },
  });
  if (!conv3) {
    conv3 = await db.conversation.create({
      data: {
        type: "DIRECT",
        members: {
          create: [{ userId: userA.id }, { userId: userC.id }],
        },
      },
    });
  }

  const res3 = await db.$transaction(async (tx) => {
    return createCallSession(tx, {
      conversationId: conv3.id,
      initiatorId: userA.id,
      type: CallType.AUDIO,
    });
  });

  if (!res3.success && res3.code === 409 && res3.error?.includes("already participating")) {
    console.log("  PASS: Initiator rejected with 409:", res3.error);
  } else {
    console.error("  FAIL: Expected 409 for active initiator, got:", res3);
    process.exit(1);
  }

  // End Call 1 and verify B is immediately available again
  await db.callSession.update({ where: { id: call1.id }, data: { status: CallStatus.ENDED } });
  await db.callParticipant.updateMany({ where: { callSessionId: call1.id }, data: { status: ParticipantStatus.LEFT } });

  // -------------------------------------------------------------------------
  // TEST 4: Concurrent Busy-Reservation Race (Two users calling B simultaneously)
  // -------------------------------------------------------------------------
  console.log("\n[TEST 4] Concurrent busy reservation: User A (Conv 1) & User C (Conv 2) calling User B simultaneously");
  const [attemptA, attemptC] = await Promise.all([
    db.$transaction(async (tx) => {
      return createCallSession(tx, {
        conversationId: conv1.id,
        initiatorId: userA.id,
        type: CallType.AUDIO,
      });
    }),
    db.$transaction(async (tx) => {
      return createCallSession(tx, {
        conversationId: conv2.id,
        initiatorId: userC.id,
        type: CallType.AUDIO,
      });
    }),
  ]);

  const successes = [attemptA, attemptC].filter((r) => r.success);
  const rejections = [attemptA, attemptC].filter((r) => !r.success);

  if (successes.length === 1 && rejections.length === 1 && rejections[0].code === 409) {
    console.log(`  PASS: Concurrency row locking serialized the requests:`);
    console.log(`    Winner: Call ${successes[0].call?.id} created successfully`);
    console.log(`    Rejected: ${rejections[0].error} (code ${rejections[0].code})`);
  } else {
    console.error("  FAIL: Expected exactly 1 success and 1 rejection, got:", { attemptA, attemptC });
    process.exit(1);
  }

  // Clean up active call
  await db.callSession.updateMany({
    where: { status: { in: [CallStatus.CREATED, CallStatus.RINGING, CallStatus.CONNECTING, CallStatus.ACTIVE] } },
    data: { status: CallStatus.ENDED },
  });
  await db.callParticipant.updateMany({
    where: { status: { in: [ParticipantStatus.RINGING, ParticipantStatus.CONNECTING, ParticipantStatus.CONNECTED] } },
    data: { status: ParticipantStatus.LEFT },
  });

  // -------------------------------------------------------------------------
  // TEST 5: Simultaneous Call Collision with ZERO SQLSTATE 25P02
  // -------------------------------------------------------------------------
  console.log("\n[TEST 5] Simultaneous call collision in same conversation (A -> B and B -> A)");
  let p2002Count = 0;
  let p25P02Count = 0;

  const collisionResults = await Promise.all(
    [userA, userB].map(async (initiator) => {
      try {
        const res = await db.$transaction(async (tx) => {
          return createCallSession(tx, {
            conversationId: conv1.id,
            initiatorId: initiator.id,
            type: CallType.AUDIO,
          });
        });
        return { ok: true, res };
      } catch (err: any) {
        if (String(err?.message).includes("25P02")) p25P02Count++;
        return { ok: false, error: err?.message };
      }
    })
  );

  console.log("  Collision results:", collisionResults);
  if (p25P02Count > 0) {
    console.error("  FAIL: SQLSTATE 25P02 detected! Transaction abortion not properly handled!");
    process.exit(1);
  }

  const successCollisions = collisionResults.filter((r) => r.ok && r.res?.success);
  const conflictCollisions = collisionResults.filter((r) => r.ok && !r.res?.success && r.res?.code === 409);

  if (successCollisions.length === 1 && conflictCollisions.length === 1 && p25P02Count === 0) {
    console.log("  PASS: Exactly 1 call created, 1 clean 409 conflict, and 0 25P02 errors!");
  } else {
    console.error("  FAIL: Unexpected collision results:", { successCollisions, conflictCollisions });
    process.exit(1);
  }

  // Clean up active call
  await db.callSession.updateMany({
    where: { status: { in: [CallStatus.CREATED, CallStatus.RINGING, CallStatus.CONNECTING, CallStatus.ACTIVE] } },
    data: { status: CallStatus.ENDED },
  });
  await db.callParticipant.updateMany({
    where: { status: { in: [ParticipantStatus.RINGING, ParticipantStatus.CONNECTING, ParticipantStatus.CONNECTED] } },
    data: { status: ParticipantStatus.LEFT },
  });

  // -------------------------------------------------------------------------
  // TEST 6: Duplicate Leave & Unload Beacon Safety
  // -------------------------------------------------------------------------
  console.log("\n[TEST 6] Duplicate leave requests & beacon idempotent delivery");
  const testCall = await db.callSession.create({
    data: {
      conversationId: conv1.id,
      type: "AUDIO",
      status: CallStatus.ACTIVE,
      initiatorId: userA.id,
      hostId: userA.id,
      livekitRoomName: `test_leave_beacon_${Date.now()}`,
      participants: {
        create: [
          { userId: userA.id, status: ParticipantStatus.CONNECTED, isHost: true },
          { userId: userB.id, status: ParticipantStatus.CONNECTED, isHost: false },
        ],
      },
    },
  });

  // 1st leave
  const leave1 = await db.$transaction(async (tx) => leaveCall(tx, testCall.id, userB.id));
  // 2nd leave (simulating duplicate beacon or refresh)
  const leave2 = await db.$transaction(async (tx) => leaveCall(tx, testCall.id, userB.id));
  // 3rd leave after call ended
  const leave3 = await db.$transaction(async (tx) => leaveCall(tx, testCall.id, userB.id));

  if (leave1.success && leave2.success && leave3.success) {
    console.log("  PASS: All 3 consecutive leave calls succeeded idempotently with zero errors.");
  } else {
    console.error("  FAIL: Non-idempotent leave behavior:", { leave1, leave2, leave3 });
    process.exit(1);
  }

  // Clean up
  await db.callSession.updateMany({
    where: { status: { in: [CallStatus.CREATED, CallStatus.RINGING, CallStatus.CONNECTING, CallStatus.ACTIVE] } },
    data: { status: CallStatus.ENDED },
  });

  console.log("\n======================================================================");
  console.log("ALL BACKEND CONCURRENCY & BUSY TESTS PASSED (6/6)");
  console.log("======================================================================");
  await db.$disconnect();
}

run().catch((err) => {
  console.error("Unhandled error:", err);
  process.exit(1);
});
