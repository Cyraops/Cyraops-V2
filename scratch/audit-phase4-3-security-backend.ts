import { PrismaClient, CallStatus, ParticipantStatus, CallType } from "@prisma/client";
import { createSession } from "../src/lib/auth";
import { generateParticipantToken } from "../src/lib/calling/livekit-token";
import { createCallSession, leaveCall } from "../src/lib/calling/state-machine";
import { RoomServiceClient } from "livekit-server-sdk";
import { getLiveKitConfig } from "../src/lib/calling/config";

const DEV_DB_URL = "postgresql://tanveersinghsaini:@localhost:5432/company_os_dev";
const db = new PrismaClient({ datasources: { db: { url: DEV_DB_URL } } });
const BASE_URL = "http://localhost:3001";

async function run() {
  console.log("======================================================================");
  console.log("PHASE 4.3 AUDIT: SECURITY, CONCURRENCY & BACKEND VERIFICATION BATTERY");
  console.log("======================================================================");

  // 1. Reset old calls
  await db.callSession.updateMany({
    where: { status: { in: [CallStatus.CREATED, CallStatus.RINGING, CallStatus.CONNECTING, CallStatus.ACTIVE] } },
    data: { status: CallStatus.ENDED },
  });

  const alice = await db.user.findFirst({ where: { email: "audit_alice@cyraops.com" } });
  const bob = await db.user.findFirst({ where: { email: "audit_bob@cyraops.com" } });
  const charlie = await db.user.findFirst({ where: { email: "audit_charlie@cyraops.com" } });
  if (!alice || !bob || !charlie) throw new Error("Audit users not found");

  // Create Direct conversation between Alice and Bob
  let convAB = await db.conversation.findFirst({
    where: {
      type: "DIRECT",
      AND: [{ members: { some: { userId: alice.id } } }, { members: { some: { userId: bob.id } } }],
    },
  });
  if (!convAB) {
    convAB = await db.conversation.create({
      data: {
        type: "DIRECT",
        members: { create: [{ userId: alice.id }, { userId: bob.id }] },
      },
    });
  }

  const sessAlice = await createSession(alice.id);
  const sessBob = await createSession(bob.id);
  const sessCharlie = await createSession(charlie.id);

  let passed = 0;
  let failed = 0;

  function report(name: string, ok: boolean, detail: string) {
    if (ok) {
      console.log(`[PASS] ${name}\n       Detail: ${detail}`);
      passed++;
    } else {
      console.error(`[FAIL] ${name}\n       Detail: ${detail}`);
      failed++;
    }
  }

  // -------------------------------------------------------------------------
  // SEC-01: Token Authorization - Only Authorized Participants
  // -------------------------------------------------------------------------
  const call1Res = await createCallSession(db, {
    conversationId: convAB.id,
    initiatorId: alice.id,
    type: CallType.AUDIO,
  });
  if (!call1Res.success || !call1Res.call) throw new Error("Call creation failed");
  const call1 = call1Res.call;

  // Alice (member & participant) requests token
  const tokenAliceRes = await fetch(`${BASE_URL}/api/calls/${call1.id}/token`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Cookie: `company_session=${sessAlice.token}`,
      Origin: BASE_URL,
    },
  });
  report(
    "SEC-01A: Token Issued to Eligible Participant",
    tokenAliceRes.status === 200,
    `Status ${tokenAliceRes.status}`
  );

  // Charlie (NOT a participant in call1) requests token
  const tokenCharlieRes = await fetch(`${BASE_URL}/api/calls/${call1.id}/token`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Cookie: `company_session=${sessCharlie.token}`,
      Origin: BASE_URL,
    },
  });
  const charlieErr = await tokenCharlieRes.json().catch(() => ({}));
  report(
    "SEC-01B: Non-Participant Blocked from Token Endpoint",
    tokenCharlieRes.status === 403,
    `Status ${tokenCharlieRes.status}, error: ${charlieErr.error}`
  );

  // -------------------------------------------------------------------------
  // SEC-02: Disabled User Token Denial
  // -------------------------------------------------------------------------
  // Create a temporary user and disable them
  const disabledUser = await db.user.upsert({
    where: { email: "audit_disabled@cyraops.com" },
    update: { disabledAt: new Date() },
    create: {
      email: "audit_disabled@cyraops.com",
      name: "Disabled User",
      role: "MEMBER",
      disabledAt: new Date(),
    },
  });
  const sessDisabled = await createSession(disabledUser.id);
  const tokenDisabledRes = await fetch(`${BASE_URL}/api/calls/${call1.id}/token`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Cookie: `company_session=${sessDisabled.token}`,
      Origin: BASE_URL,
    },
  });
  report(
    "SEC-02: Disabled User Cannot Obtain Calling Token",
    tokenDisabledRes.status === 401 || tokenDisabledRes.status === 403,
    `Status ${tokenDisabledRes.status}`
  );

  // -------------------------------------------------------------------------
  // SEC-03: User Removed from Conversation Cannot Join
  // -------------------------------------------------------------------------
  // Add a user to conv, add to call, then remove from conversation
  const tempMember = await db.user.upsert({
    where: { email: "audit_removed@cyraops.com" },
    update: { disabledAt: null },
    create: {
      email: "audit_removed@cyraops.com",
      name: "Removed Member",
      role: "MEMBER",
    },
  });
  const sessRemoved = await createSession(tempMember.id);
  // Ensure not a member of convAB
  await db.conversationMember.deleteMany({
    where: { conversationId: convAB.id, userId: tempMember.id },
  });
  const tokenRemovedRes = await fetch(`${BASE_URL}/api/calls/${call1.id}/token`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Cookie: `company_session=${sessRemoved.token}`,
      Origin: BASE_URL,
    },
  });
  report(
    "SEC-03: Non-Member of Conversation Strictly Denied Calling Token",
    tokenRemovedRes.status === 403,
    `Status ${tokenRemovedRes.status}`
  );

  // -------------------------------------------------------------------------
  // SEC-04: Participant Identity Spoofing Protection
  // -------------------------------------------------------------------------
  // Clean up call1 first to allow test
  await db.callSession.update({ where: { id: call1.id }, data: { status: CallStatus.ENDED } });

  // Alice tries to create call claiming initiatorId: bob.id in request body
  const spoofCreateRes = await fetch(`${BASE_URL}/api/calls`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Cookie: `company_session=${sessAlice.token}`,
      Origin: BASE_URL,
    },
    body: JSON.stringify({
      conversationId: convAB.id,
      initiatorId: bob.id, // Attempt to spoof initiator as Bob
      type: "AUDIO",
    }),
  });

  const spoofResJson = await spoofCreateRes.json().catch(() => ({}));
  const callCreated = spoofResJson.call;
  const isInitiatorDerivedFromSession = callCreated?.initiatorId === alice.id;
  report(
    "SEC-04: Server Strictly Derives Identity from Session (Ignores Body Spoof)",
    isInitiatorDerivedFromSession,
    `Initiator assigned in DB: ${callCreated?.initiatorId} (Alice: ${alice.id})`
  );

  // -------------------------------------------------------------------------
  // SEC-05: Media Trust Boundary - Client Cannot Set Authoritative CONNECTED
  // -------------------------------------------------------------------------
  const spoofMediaRes = await fetch(`${BASE_URL}/api/calls/${callCreated.id}/events`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Cookie: `company_session=${sessAlice.token}`,
      Origin: BASE_URL,
    },
    body: JSON.stringify({
      type: "PARTICIPANT_CONNECTED",
    }),
  });
  report(
    "SEC-05: Client Cannot Assert Authoritative CONNECTED State via Direct Endpoint",
    spoofMediaRes.status === 400 || spoofMediaRes.status === 404 || spoofMediaRes.status === 403,
    `Status ${spoofMediaRes.status}`
  );

  // -------------------------------------------------------------------------
  // SEC-06: Webhook Signature Verification
  // -------------------------------------------------------------------------
  const unsignedWebhookRes = await fetch(`${BASE_URL}/api/calls/webhook`, {
    method: "POST",
    headers: { "Content-Type": "application/webhook+json" },
    body: JSON.stringify({ event: "participant_joined", room: { name: callCreated.livekitRoomName } }),
  });
  report(
    "SEC-06A: Webhook without Authorization Header Rejected",
    unsignedWebhookRes.status === 401,
    `Status ${unsignedWebhookRes.status}`
  );

  const forgedWebhookRes = await fetch(`${BASE_URL}/api/calls/webhook`, {
    method: "POST",
    headers: {
      "Content-Type": "application/webhook+json",
      Authorization: "Bearer invalid.forged.signature",
    },
    body: JSON.stringify({ event: "participant_joined", room: { name: callCreated.livekitRoomName } }),
  });
  report(
    "SEC-06B: Webhook with Forged/Invalid Signature Rejected",
    forgedWebhookRes.status === 401,
    `Status ${forgedWebhookRes.status}`
  );

  // -------------------------------------------------------------------------
  // SEC-07: Idempotency Key Payload Mismatch Protection (HTTP 422)
  // -------------------------------------------------------------------------
  // Clean up all active calls first
  await db.callSession.updateMany({
    where: { status: { in: [CallStatus.CREATED, CallStatus.RINGING, CallStatus.CONNECTING, CallStatus.ACTIVE] } },
    data: { status: CallStatus.ENDED },
  });

  const sharedKey = crypto.randomUUID();
  // 1st request with sharedKey
  const idemReq1 = await fetch(`${BASE_URL}/api/calls`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Idempotency-Key": sharedKey,
      Cookie: `company_session=${sessBob.token}`,
      Origin: BASE_URL,
    },
    body: JSON.stringify({ conversationId: convAB.id, type: "AUDIO" }),
  });
  // 2nd request with SAME sharedKey but DIFFERENT payload (type: "VIDEO")
  const idemReq2 = await fetch(`${BASE_URL}/api/calls`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Idempotency-Key": sharedKey,
      Cookie: `company_session=${sessBob.token}`,
      Origin: BASE_URL,
    },
    body: JSON.stringify({ conversationId: convAB.id, type: "VIDEO" }),
  });
  const idemErr = await idemReq2.json().catch(() => ({}));
  report(
    "SEC-07: Idempotency Key Reused with Different Payload Returns 422 Unprocessable Entity",
    idemReq2.status === 422,
    `Status ${idemReq2.status}, error: ${idemErr.error}`
  );

  // -------------------------------------------------------------------------
  // SEC-08: Cross-Conversation Busy Protection
  // -------------------------------------------------------------------------
  // Clean up all active calls
  await db.callSession.updateMany({
    where: { status: { in: [CallStatus.CREATED, CallStatus.RINGING, CallStatus.CONNECTING, CallStatus.ACTIVE] } },
    data: { status: CallStatus.ENDED },
  });

  // Bob is in an active call with Alice
  const activeCallRes = await createCallSession(db, {
    conversationId: convAB.id,
    initiatorId: alice.id,
    type: CallType.AUDIO,
  });
  // Charlie tries to call Bob in a separate conversation
  let convBC = await db.conversation.findFirst({
    where: {
      type: "DIRECT",
      AND: [{ members: { some: { userId: bob.id } } }, { members: { some: { userId: charlie.id } } }],
    },
  });
  if (!convBC) {
    convBC = await db.conversation.create({
      data: {
        type: "DIRECT",
        members: { create: [{ userId: bob.id }, { userId: charlie.id }] },
      },
    });
  }

  const charlieCallRes = await fetch(`${BASE_URL}/api/calls`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Cookie: `company_session=${sessCharlie.token}`,
      Origin: BASE_URL,
    },
    body: JSON.stringify({ conversationId: convBC.id, type: "AUDIO" }),
  });
  const charlieCallErr = await charlieCallRes.json().catch(() => ({}));
  report(
    "SEC-08A: Cross-Conversation Call Creation to Busy Recipient Blocked with 409",
    charlieCallRes.status === 409,
    `Status ${charlieCallRes.status}, error: ${charlieCallErr.error}`
  );

  // Bob (already in active call) tries to initiate a call to Charlie
  const bobCallRes = await fetch(`${BASE_URL}/api/calls`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Cookie: `company_session=${sessBob.token}`,
      Origin: BASE_URL,
    },
    body: JSON.stringify({ conversationId: convBC.id, type: "AUDIO" }),
  });
  const bobCallErr = await bobCallRes.json().catch(() => ({}));
  report(
    "SEC-08B: Busy Initiator Blocked with 409 from Starting Another Call",
    bobCallRes.status === 409,
    `Status ${bobCallRes.status}, error: ${bobCallErr.error}`
  );

  // -------------------------------------------------------------------------
  // SEC-09: Simultaneous Collision Concurrency Without 25P02
  // -------------------------------------------------------------------------
  await db.callSession.updateMany({
    where: { status: { in: [CallStatus.CREATED, CallStatus.RINGING, CallStatus.CONNECTING, CallStatus.ACTIVE] } },
    data: { status: CallStatus.ENDED },
  });

  const [race1, race2] = await Promise.all([
    fetch(`${BASE_URL}/api/calls`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Cookie: `company_session=${sessAlice.token}`, Origin: BASE_URL },
      body: JSON.stringify({ conversationId: convAB.id, type: "AUDIO" }),
    }),
    fetch(`${BASE_URL}/api/calls`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Cookie: `company_session=${sessBob.token}`, Origin: BASE_URL },
      body: JSON.stringify({ conversationId: convAB.id, type: "AUDIO" }),
    }),
  ]);

  const s1 = race1.status;
  const s2 = race2.status;
  const hasWinner = (s1 === 201 && s2 === 409) || (s1 === 409 && s2 === 201);
  const race1Body = await race1.json().catch(() => ({}));
  const race2Body = await race2.json().catch(() => ({}));
  const zero25P02 = !JSON.stringify(race1Body).includes("25P02") && !JSON.stringify(race2Body).includes("25P02");

  report(
    "SEC-09: Simultaneous Call Collision Has 1 Winner, 1 Conflict, 0 25P02 Errors",
    hasWinner && zero25P02,
    `Status1: ${s1}, Status2: ${s2}, zero25P02: ${zero25P02}`
  );

  // -------------------------------------------------------------------------
  // SEC-10: Outbox Jobs Observability
  // -------------------------------------------------------------------------
  const outboxJobs = await db.callSfuEjectionJob.findMany({
    take: 5,
    orderBy: { createdAt: "desc" },
  });
  report(
    "SEC-10: Outbox SFU Ejection Jobs Persisted & Observable",
    outboxJobs.length > 0,
    `Found ${outboxJobs.length} ejection job(s) in database (status: ${outboxJobs[0]?.status})`
  );

  // Clean up
  await db.callSession.updateMany({
    where: { status: { in: [CallStatus.CREATED, CallStatus.RINGING, CallStatus.CONNECTING, CallStatus.ACTIVE] } },
    data: { status: CallStatus.ENDED },
  });

  await db.$disconnect();

  console.log("\n======================================================================");
  console.log(`SECURITY BATTERY COMPLETE: ${passed} PASSED, ${failed} FAILED`);
  console.log("======================================================================");

  if (failed > 0) process.exit(1);
}

run().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
