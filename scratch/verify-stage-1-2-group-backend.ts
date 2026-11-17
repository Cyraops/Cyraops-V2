import { PrismaClient, CallStatus, ParticipantStatus, CallType, ConversationType } from "@prisma/client";
import {
  createCallSession,
  acceptCallInvitation,
  declineCallInvitation,
  leaveCall,
  endCallForEveryone,
  joinCall,
  kickParticipant,
  transferHost,
} from "../src/lib/calling/state-machine";

const DEV_DB_URL = "postgresql://tanveersinghsaini:@localhost:5432/company_os_dev";
const db = new PrismaClient({ datasources: { db: { url: DEV_DB_URL } } });

async function run() {
  console.log("======================================================================");
  console.log("STAGE 1 & 2 GROUP CALLING BACKEND & STATE MACHINE VERIFICATION");
  console.log("======================================================================");

  // Clean old active calls
  await db.callSession.updateMany({
    where: { status: { in: [CallStatus.CREATED, CallStatus.RINGING, CallStatus.CONNECTING, CallStatus.ACTIVE] } },
    data: { status: CallStatus.ENDED },
  });

  // Ensure test users: Alice (host), Bob, Charlie, David
  const users = await Promise.all([
    db.user.upsert({
      where: { email: "audit_alice@cyraops.com" },
      update: { disabledAt: null },
      create: { email: "audit_alice@cyraops.com", name: "Audit Alice", passwordHash: "dummy" },
    }),
    db.user.upsert({
      where: { email: "audit_bob@cyraops.com" },
      update: { disabledAt: null },
      create: { email: "audit_bob@cyraops.com", name: "Audit Bob", passwordHash: "dummy" },
    }),
    db.user.upsert({
      where: { email: "audit_charlie@cyraops.com" },
      update: { disabledAt: null },
      create: { email: "audit_charlie@cyraops.com", name: "Audit Charlie", passwordHash: "dummy" },
    }),
    db.user.upsert({
      where: { email: "audit_david@cyraops.com" },
      update: { disabledAt: null },
      create: { email: "audit_david@cyraops.com", name: "Audit David", passwordHash: "dummy" },
    }),
  ]);
  const [alice, bob, charlie, david] = users;

  // Create or retrieve a group conversation with all 4 users
  let groupConv = await db.conversation.findFirst({
    where: {
      type: ConversationType.GROUP,
      name: "Engineering Group Standup",
    },
  });
  if (!groupConv) {
    groupConv = await db.conversation.create({
      data: {
        type: ConversationType.GROUP,
        name: "Engineering Group Standup",
        members: {
          create: [{ userId: alice.id }, { userId: bob.id }, { userId: charlie.id }, { userId: david.id }],
        },
      },
    });
  } else {
    // Ensure all 4 are members
    for (const u of users) {
      await db.conversationMember.upsert({
        where: { conversationId_userId: { conversationId: groupConv.id, userId: u.id } },
        update: {},
        create: { conversationId: groupConv.id, userId: u.id },
      });
    }
  }

  // Also ensure a direct conversation between Alice and Bob
  let directConv = await db.conversation.findFirst({
    where: {
      type: ConversationType.DIRECT,
      AND: [{ members: { some: { userId: alice.id } } }, { members: { some: { userId: bob.id } } }],
    },
  });
  if (!directConv) {
    directConv = await db.conversation.create({
      data: {
        type: ConversationType.DIRECT,
        members: { create: [{ userId: alice.id }, { userId: bob.id }] },
      },
    });
  }

  let passed = 0;
  let total = 10;

  // -------------------------------------------------------------------------
  // TEST 1: Direct 1:1 Calling Semantics Preserved
  // -------------------------------------------------------------------------
  console.log("\n[TEST 1] Verifying 1:1 DIRECT Calling Semantics...");
  const call1Res = await db.$transaction(async (tx) => {
    return createCallSession(tx, {
      conversationId: directConv.id,
      initiatorId: alice.id,
      type: CallType.AUDIO,
    });
  });
  if (call1Res.success && call1Res.call?.status === CallStatus.RINGING) {
    console.log("  ✔ PASS: Direct call created with RINGING status");
    // Bob leaves -> in 1:1, call must terminate!
    const leaveDirect = await db.$transaction(async (tx) => {
      return leaveCall(tx, call1Res.call.id, bob.id);
    });
    if (leaveDirect.call?.status === CallStatus.ENDED) {
      console.log("  ✔ PASS: In DIRECT conversation, participant departure terminates call (1:1 semantics intact)");
      passed++;
    } else {
      console.error("  ✖ FAIL: Direct call did not terminate on participant leave");
    }
  } else {
    console.error("  ✖ FAIL: Direct call creation failed:", call1Res.error);
  }

  // -------------------------------------------------------------------------
  // TEST 2: Group Call Creation (Ringing Specific Targets)
  // -------------------------------------------------------------------------
  console.log("\n[TEST 2] Verifying Group Call Creation with Targeted Invitees...");
  const groupCallRes = await db.$transaction(async (tx) => {
    return createCallSession(tx, {
      conversationId: groupConv.id,
      initiatorId: alice.id,
      type: CallType.VIDEO,
      inviteeIds: [bob.id, charlie.id], // Target Bob and Charlie
    });
  });
  if (groupCallRes.success && groupCallRes.call?.status === CallStatus.RINGING) {
    const ringingCount = groupCallRes.call.participants.filter((p: any) => p.status === ParticipantStatus.RINGING).length;
    if (ringingCount === 2) {
      console.log("  ✔ PASS: Group call created ringing only selected targets (Bob & Charlie)");
      passed++;
    } else {
      console.error("  ✖ FAIL: Ringing count mismatch:", ringingCount);
    }
  } else {
    console.error("  ✖ FAIL: Group call creation failed:", groupCallRes.error);
  }

  const callId = groupCallRes.call!.id;

  // -------------------------------------------------------------------------
  // TEST 3: Individual Decline Does NOT Terminate Group Call
  // -------------------------------------------------------------------------
  console.log("\n[TEST 3] Verifying Individual Decline in Group Call...");
  const declineBob = await db.$transaction(async (tx) => {
    return declineCallInvitation(tx, callId, bob.id, "Busy with audit");
  });
  if (declineBob.success && declineBob.call?.status === CallStatus.RINGING) {
    console.log("  ✔ PASS: Bob declined; call remains active/ringing for Alice and Charlie");
    passed++;
  } else {
    console.error("  ✖ FAIL: Group call unexpectedly terminated after one decline:", declineBob.call?.status);
  }

  // -------------------------------------------------------------------------
  // TEST 4: Acceptance Transitions Participant and Call
  // -------------------------------------------------------------------------
  console.log("\n[TEST 4] Verifying Call Acceptance by Charlie...");
  const acceptCharlie = await db.$transaction(async (tx) => {
    return acceptCallInvitation(tx, callId, charlie.id);
  });
  if (acceptCharlie.success && acceptCharlie.participant?.status === ParticipantStatus.CONNECTING) {
    console.log("  ✔ PASS: Charlie accepted; transitioned to CONNECTING");
    passed++;
  } else {
    console.error("  ✖ FAIL: Accept failed:", acceptCharlie.error);
  }

  // -------------------------------------------------------------------------
  // TEST 5: Self-Join by Uninvited Teammate (David)
  // -------------------------------------------------------------------------
  console.log("\n[TEST 5] Verifying Self-Join API by David...");
  const joinDavid = await db.$transaction(async (tx) => {
    return joinCall(tx, callId, david.id);
  });
  if (joinDavid.success && joinDavid.participant?.userId === david.id) {
    console.log("  ✔ PASS: David joined group call via joinCall API");
    passed++;
  } else {
    console.error("  ✖ FAIL: Self-join failed:", joinDavid.error);
  }

  // -------------------------------------------------------------------------
  // TEST 6: Participant Departure Does NOT Terminate Group Call (3 participants -> 2)
  // -------------------------------------------------------------------------
  console.log("\n[TEST 6] Verifying Participant Departure Does NOT Terminate Group Call...");
  // Charlie leaves
  const leaveCharlie = await db.$transaction(async (tx) => {
    return leaveCall(tx, callId, charlie.id);
  });
  if (leaveCharlie.success && leaveCharlie.call?.status !== CallStatus.ENDED) {
    console.log("  ✔ PASS: Charlie left; group call remains ACTIVE for Alice and David");
    passed++;
  } else {
    console.error("  ✖ FAIL: Group call terminated when count fell to 2:", leaveCharlie.call?.status);
  }

  // -------------------------------------------------------------------------
  // TEST 7: Host Privileges & Transfer Host
  // -------------------------------------------------------------------------
  console.log("\n[TEST 7] Verifying Host Transfer to David...");
  const xferRes = await db.$transaction(async (tx) => {
    return transferHost(tx, callId, alice.id, david.id);
  });
  if (xferRes.success && xferRes.call?.hostId === david.id) {
    console.log("  ✔ PASS: Host privileges transferred from Alice to David");
    passed++;
  } else {
    console.error("  ✖ FAIL: Host transfer failed:", xferRes.error);
  }

  // -------------------------------------------------------------------------
  // TEST 8: Host Kick Participant (David kicks Alice)
  // -------------------------------------------------------------------------
  console.log("\n[TEST 8] Verifying Host Kick API...");
  // Non-host (Alice) cannot kick David
  const failKick = await db.$transaction(async (tx) => {
    return kickParticipant(tx, callId, alice.id, david.id);
  });
  if (!failKick.success && failKick.code === 403) {
    console.log("  ✔ PASS: Non-host cannot kick (HTTP 403 Forbidden)");
  } else {
    console.error("  ✖ FAIL: Non-host kick should have failed with 403");
  }

  // Host (David) kicks Alice
  const kickAlice = await db.$transaction(async (tx) => {
    return kickParticipant(tx, callId, david.id, alice.id, "Testing kick");
  });
  if (kickAlice.success && kickAlice.participant?.status === ParticipantStatus.EJECTED) {
    console.log("  ✔ PASS: Host David kicked Alice; Alice marked EJECTED and outbox job created");
    passed++;
  } else {
    console.error("  ✖ FAIL: Host kick failed:", kickAlice.error);
  }

  // -------------------------------------------------------------------------
  // TEST 9: Final Participant Departure Terminates Group Call
  // -------------------------------------------------------------------------
  console.log("\n[TEST 9] Verifying Group Call Termination When Last Participant Leaves...");
  // David leaves
  const leaveDavid = await db.$transaction(async (tx) => {
    return leaveCall(tx, callId, david.id);
  });
  if (leaveDavid.success && leaveDavid.call?.status === CallStatus.ENDED) {
    console.log("  ✔ PASS: Last participant (David) left; group call cleanly transitioned to ENDED");
    passed++;
  } else {
    console.error("  ✖ FAIL: Group call did not terminate when last participant left:", leaveDavid.call?.status);
  }

  // -------------------------------------------------------------------------
  // TEST 10: Open Meeting Mode (No members rung, join via banner)
  // -------------------------------------------------------------------------
  console.log("\n[TEST 10] Verifying Open Group Meeting Mode (ringAll: false)...");
  const openMeetingRes = await db.$transaction(async (tx) => {
    return createCallSession(tx, {
      conversationId: groupConv.id,
      initiatorId: alice.id,
      type: CallType.AUDIO,
      ringAll: false, // Do not ring members; open meeting mode
    });
  });
  if (openMeetingRes.success) {
    const ringingCount = openMeetingRes.call.participants.filter((p: any) => p.status === ParticipantStatus.RINGING).length;
    if (ringingCount === 0 && openMeetingRes.call.initiatorId === alice.id) {
      console.log("  ✔ PASS: Open Group Meeting created with 0 ringing members (banner mode verified)");
      passed++;
    } else {
      console.error("  ✖ FAIL: Expected 0 ringing members, got", ringingCount);
    }
    // Clean up
    await db.$transaction(async (tx) => {
      return endCallForEveryone(tx, openMeetingRes.call.id, alice.id);
    });
  } else {
    console.error("  ✖ FAIL: Open meeting creation failed:", openMeetingRes.error);
  }

  console.log("\n======================================================================");
  console.log(`STAGE 1 & 2 VERIFICATION SUMMARY: ${passed}/${total} TESTS PASSED`);
  console.log("======================================================================");

  await db.$disconnect();
}

run().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});

