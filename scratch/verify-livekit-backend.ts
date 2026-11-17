import { PrismaClient, CallStatus, ParticipantStatus, CallEventType } from "@prisma/client";
import { NextRequest } from "next/server";
import { POST as tokenRoute } from "../src/app/api/calls/[id]/token/route";
import { POST as webhookRoute } from "../src/app/api/calls/webhook/route";
import { createCallSession, acceptCallInvitation } from "../src/lib/calling/state-machine";
import { generateParticipantToken } from "../src/lib/calling/livekit-token";
import { SignJWT, jwtVerify } from "jose";
import { createHash } from "node:crypto";

const TEST_DB_URL = "postgresql://tanveersinghsaini:@localhost:5432/company_os_livekit_test";
process.env.DATABASE_URL = TEST_DB_URL;
process.env.LIVEKIT_URL = "http://localhost:7880";
process.env.LIVEKIT_API_KEY = "devkey";
process.env.LIVEKIT_API_SECRET = "devsecret";

const db = new PrismaClient({ datasources: { db: { url: TEST_DB_URL } } });
(globalThis as any).prisma = db;

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

// Helper to create signed LiveKit webhook Authorization header
async function createSignedWebhookHeader(rawBody: string, apiKey: string, apiSecret: string): Promise<string> {
  const hash = createHash("sha256").update(rawBody).digest("base64");
  return new SignJWT({ sha256: hash })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuer(apiKey)
    .setExpirationTime("1m")
    .sign(new TextEncoder().encode(apiSecret));
}

// Helper to create mock authenticated request
function createMockRequest(url: string, options: { method?: string; body?: any; cookieToken?: string; headers?: Record<string, string> } = {}) {
  const headers = new Headers();
  headers.set("origin", "http://localhost:3001");
  headers.set("host", "localhost:3001");
  if (options.cookieToken) {
    headers.set("cookie", `company_session=${options.cookieToken}`);
  }
  if (options.headers) {
    for (const [k, v] of Object.entries(options.headers)) {
      headers.set(k, v);
    }
  }

  const init: any = {
    method: options.method || "POST",
    headers,
  };

  if (options.body) {
    init.body = typeof options.body === "string" ? options.body : JSON.stringify(options.body);
  }

  return new NextRequest(new URL(url, "http://localhost:3001"), init);
}

async function run() {
  console.log("=================================================");
  console.log("STAGE C VERIFICATION: LIVEKIT BACKEND FOUNDATION");
  console.log("=================================================");

  // Set environment variables for tests
  process.env.LIVEKIT_URL = "http://localhost:7880";
  process.env.LIVEKIT_API_KEY = "devkey";
  process.env.LIVEKIT_API_SECRET = "devsecret";
  process.env.DATABASE_URL = TEST_DB_URL;

  // Clean test database
  await db.callIdempotencyKey.deleteMany();
  await db.callEvent.deleteMany();
  await db.callParticipant.deleteMany();
  await db.callSession.deleteMany();
  await db.message.deleteMany();
  await db.conversationMember.deleteMany();
  await db.conversation.deleteMany();
  await db.session.deleteMany();
  await db.user.deleteMany();

  // Create Users
  const userA = await db.user.create({ data: { name: "User Alice", email: "alice@cyraops.com", role: "ADMIN" } });
  const userB = await db.user.create({ data: { name: "User Bob", email: "bob@cyraops.com", role: "MEMBER" } });
  const userC = await db.user.create({ data: { name: "User Charlie", email: "charlie@cyraops.com", role: "MEMBER" } });

  // Create Sessions
  const sessionTokenA = "tok_session_alice_123";
  const tokenHashA = createHash("sha256").update(sessionTokenA).digest("hex");
  await db.session.create({ data: { id: "sess_a", tokenHash: tokenHashA, userId: userA.id, expiresAt: new Date(Date.now() + 86400000) } });

  const sessionTokenB = "tok_session_bob_456";
  const tokenHashB = createHash("sha256").update(sessionTokenB).digest("hex");
  await db.session.create({ data: { id: "sess_b", tokenHash: tokenHashB, userId: userB.id, expiresAt: new Date(Date.now() + 86400000) } });

  const sessionTokenC = "tok_session_charlie_789";
  const tokenHashC = createHash("sha256").update(sessionTokenC).digest("hex");
  await db.session.create({ data: { id: "sess_c", tokenHash: tokenHashC, userId: userC.id, expiresAt: new Date(Date.now() + 86400000) } });

  // Create Conversation
  const conv = await db.conversation.create({
    data: {
      name: "LiveKit Test Group",
      type: "GROUP",
      members: {
        create: [
          { userId: userA.id },
          { userId: userB.id },
          { userId: userC.id },
        ],
      },
    },
  });

  // Create Call
  const callRes = await createCallSession(db, {
    conversationId: conv.id,
    initiatorId: userA.id,
    inviteeIds: [userB.id, userC.id],
  });
  assert(callRes.success, "Test call session created");
  const callId = callRes.call.id;
  const roomName = callRes.call.livekitRoomName;

  // Accept call for B
  await acceptCallInvitation(db, callId, userB.id);

  // ------------------------------------------------------------------------
  // TEST 1: Unauthenticated user cannot obtain a token
  // ------------------------------------------------------------------------
  console.log("\n--- TEST 1: Unauthenticated Token Request ---");
  const reqUnauth = createMockRequest(`http://localhost:3001/api/calls/${callId}/token`);
  const resUnauth = await tokenRoute(reqUnauth, { params: Promise.resolve({ id: callId }) });
  assert(resUnauth.status === 401, "Unauthenticated request returns 401 Unauthorized");

  // ------------------------------------------------------------------------
  // TEST 2: Disabled user cannot obtain a token
  // ------------------------------------------------------------------------
  console.log("\n--- TEST 2: Disabled User Token Request ---");
  await db.user.update({ where: { id: userC.id }, data: { disabledAt: new Date() } });
  const reqDisabled = createMockRequest(`http://localhost:3001/api/calls/${callId}/token`, { cookieToken: sessionTokenC });
  const resDisabled = await tokenRoute(reqDisabled, { params: Promise.resolve({ id: callId }) });
  assert(resDisabled.status === 401 || resDisabled.status === 403, "Disabled user is blocked (401/403)");
  // Restore userC for subsequent tests
  await db.user.update({ where: { id: userC.id }, data: { disabledAt: null } });
  await db.session.deleteMany({ where: { userId: userC.id } });
  await db.session.create({
    data: { id: "sess_c_restored", tokenHash: tokenHashC, userId: userC.id, expiresAt: new Date(Date.now() + 86400000) },
  });

  // ------------------------------------------------------------------------
  // TEST 3: Removed conversation member cannot obtain a token
  // ------------------------------------------------------------------------
  console.log("\n--- TEST 3: Removed Member Token Request ---");
  // Temporarily remove userC from conversation
  await db.conversationMember.delete({ where: { conversationId_userId: { conversationId: conv.id, userId: userC.id } } });
  const reqRemoved = createMockRequest(`http://localhost:3001/api/calls/${callId}/token`, { cookieToken: sessionTokenC });
  const resRemoved = await tokenRoute(reqRemoved, { params: Promise.resolve({ id: callId }) });
  assert(resRemoved.status === 403, "Removed conversation member returns 403 Forbidden");
  // Re-add userC
  await db.conversationMember.create({ data: { conversationId: conv.id, userId: userC.id } });

  // ------------------------------------------------------------------------
  // TEST 4 & 5: Server Binds Identity and Room Name (Ignoring Client Tampering)
  // ------------------------------------------------------------------------
  console.log("\n--- TEST 4 & 5: Identity and Room Name Tampering Proof ---");
  const reqTamper = createMockRequest(`http://localhost:3001/api/calls/${callId}/token`, {
    cookieToken: sessionTokenB,
    body: { userId: userA.id, roomName: "malicious_injected_room", isHost: true },
  });
  const resTamper = await tokenRoute(reqTamper, { params: Promise.resolve({ id: callId }) });
  assert(resTamper.status === 200, "Token request succeeds for active member");
  const tamperData = await resTamper.json();
  assert(tamperData.roomName === roomName, "Token bound strictly to server stored room name");

  // Verify decoded JWT claims
  const { payload } = await jwtVerify(tamperData.token, new TextEncoder().encode("devsecret"));
  assert(payload.sub === userB.id, "JWT sub bound strictly to authenticated User B (client userId ignored)");
  const videoGrant = (payload as any).video;
  assert(videoGrant.room === roomName, "JWT video.room strictly bound to call.livekitRoomName");
  assert(videoGrant.canPublish === true, "Publish permissions granted according to participant model");

  // ------------------------------------------------------------------------
  // TEST 6: Declined participant cannot obtain a token
  // ------------------------------------------------------------------------
  console.log("\n--- TEST 6: Declined Participant Ineligible ---");
  await db.callParticipant.update({
    where: { callSessionId_userId: { callSessionId: callId, userId: userC.id } },
    data: { status: ParticipantStatus.DECLINED },
  });
  const reqDeclined = createMockRequest(`http://localhost:3001/api/calls/${callId}/token`, { cookieToken: sessionTokenC });
  const resDeclined = await tokenRoute(reqDeclined, { params: Promise.resolve({ id: callId }) });
  assert(resDeclined.status === 403, "Declined participant returns 403 Ineligible");

  // ------------------------------------------------------------------------
  // TEST 7: Ejected participant cannot obtain a token
  // ------------------------------------------------------------------------
  console.log("\n--- TEST 7: Ejected Participant Ineligible ---");
  await db.callParticipant.update({
    where: { callSessionId_userId: { callSessionId: callId, userId: userC.id } },
    data: { status: ParticipantStatus.EJECTED },
  });
  const reqEjected = createMockRequest(`http://localhost:3001/api/calls/${callId}/token`, { cookieToken: sessionTokenC });
  const resEjected = await tokenRoute(reqEjected, { params: Promise.resolve({ id: callId }) });
  assert(resEjected.status === 403, "Ejected participant returns 403 Ineligible");

  // ------------------------------------------------------------------------
  // TEST 8: Ended call cannot obtain a token
  // ------------------------------------------------------------------------
  console.log("\n--- TEST 8: Ended Call Ineligible ---");
  const dummyEndedCall = await db.callSession.create({
    data: {
      conversationId: conv.id,
      initiatorId: userA.id,
      hostId: userA.id,
      livekitRoomName: "room_ended_dummy",
      status: CallStatus.ENDED,
      participants: { create: [{ userId: userA.id, status: ParticipantStatus.ACCEPTED }] },
    },
  });
  const reqEnded = createMockRequest(`http://localhost:3001/api/calls/${dummyEndedCall.id}/token`, { cookieToken: sessionTokenA });
  const resEnded = await tokenRoute(reqEnded, { params: Promise.resolve({ id: dummyEndedCall.id }) });
  assert(resEnded.status === 410, "Ended call returns 410 Call is no longer active");

  // ------------------------------------------------------------------------
  // TEST 9: Invalid webhook signature is rejected
  // ------------------------------------------------------------------------
  console.log("\n--- TEST 9: Webhook Signature Verification ---");
  const webhookBody = JSON.stringify({
    event: "participant_joined",
    room: { name: roomName },
    participant: { identity: userB.id },
  });

  const reqBadSig = createMockRequest("http://localhost:3001/api/calls/webhook", {
    body: webhookBody,
    headers: { authorization: "invalid.jwt.signature" },
  });
  const resBadSig = await webhookRoute(reqBadSig);
  assert(resBadSig.status === 401, "Invalid webhook signature returns 401 Unauthorized");

  const reqNoSig = createMockRequest("http://localhost:3001/api/calls/webhook", { body: webhookBody });
  const resNoSig = await webhookRoute(reqNoSig);
  assert(resNoSig.status === 401, "Missing webhook authorization header returns 401 Unauthorized");

  // ------------------------------------------------------------------------
  // TEST 10: Valid webhook updates the correct participant & call state
  // ------------------------------------------------------------------------
  console.log("\n--- TEST 10: Valid Webhook Media State Transition ---");
  const validAuthHeader = await createSignedWebhookHeader(webhookBody, "devkey", "devsecret");
  const reqValid = createMockRequest("http://localhost:3001/api/calls/webhook", {
    body: webhookBody,
    headers: { authorization: validAuthHeader },
  });
  const resValid = await webhookRoute(reqValid);
  assert(resValid.status === 200, "Valid webhook accepted with 200 OK");

  const partBAfter = await db.callParticipant.findUnique({
    where: { callSessionId_userId: { callSessionId: callId, userId: userB.id } },
  });
  assert(partBAfter?.status === ParticipantStatus.CONNECTED, "Participant B authoritatively transitioned to CONNECTED");

  // Now participant A joins, reaching connectedCount >= 2 -> ACTIVE
  const webhookBodyA = JSON.stringify({
    event: "participant_joined",
    room: { name: roomName },
    participant: { identity: userA.id },
  });
  const validAuthHeaderA = await createSignedWebhookHeader(webhookBodyA, "devkey", "devsecret");
  const reqValidA = createMockRequest("http://localhost:3001/api/calls/webhook", {
    body: webhookBodyA,
    headers: { authorization: validAuthHeaderA },
  });
  const resValidA = await webhookRoute(reqValidA);
  assert(resValidA.status === 200, "Participant A join webhook accepted");

  const callAfterJoin = await db.callSession.findUnique({ where: { id: callId } });
  assert(callAfterJoin?.status === CallStatus.ACTIVE, "CallSession authoritatively transitioned to ACTIVE (>= 2 connected)");

  // ------------------------------------------------------------------------
  // TEST 11: Duplicate webhook does not duplicate lifecycle events
  // ------------------------------------------------------------------------
  console.log("\n--- TEST 11: Duplicate Webhook Delivery Idempotency ---");
  const eventsBefore = await db.callEvent.count({ where: { callSessionId: callId } });
  const reqDup = createMockRequest("http://localhost:3001/api/calls/webhook", {
    body: webhookBodyA,
    headers: { authorization: validAuthHeaderA },
  });
  const resDuplicate = await webhookRoute(reqDup);
  assert(resDuplicate.status === 200, "Duplicate webhook accepted safely");
  const eventsAfter = await db.callEvent.count({ where: { callSessionId: callId } });
  assert(eventsBefore === eventsAfter, "Zero duplicate events created on identical webhook delivery");

  // ------------------------------------------------------------------------
  // TEST 12: Delayed webhook cannot resurrect an ended call
  // ------------------------------------------------------------------------
  console.log("\n--- TEST 12: Delayed Webhook on Terminated Call ---");
  await db.callSession.update({ where: { id: callId }, data: { status: CallStatus.ENDED, endedAt: new Date() } });

  const delayedJoinBody = JSON.stringify({
    event: "participant_joined",
    room: { name: roomName },
    participant: { identity: userA.id },
  });
  const delayedHeader = await createSignedWebhookHeader(delayedJoinBody, "devkey", "devsecret");
  const reqDelayed = createMockRequest("http://localhost:3001/api/calls/webhook", {
    body: delayedJoinBody,
    headers: { authorization: delayedHeader },
  });
  const resDelayed = await webhookRoute(reqDelayed);
  const delayedData = await resDelayed.json();
  assert(delayedData.status === "ignored" && delayedData.reason === "Call already terminated", "Delayed webhook ignored for ended call");

  const callStillEnded = await db.callSession.findUnique({ where: { id: callId } });
  assert(callStillEnded?.status === CallStatus.ENDED, "Call remains strictly ENDED and was NOT resurrected");

  // ------------------------------------------------------------------------
  // TEST 13 & 14: Webhook for unknown room or participant rejected safely
  // ------------------------------------------------------------------------
  console.log("\n--- TEST 13 & 14: Unknown Room and Participant Safety ---");
  const unknownRoomBody = JSON.stringify({
    event: "participant_joined",
    room: { name: "unknown_room_xyz_999" },
    participant: { identity: userA.id },
  });
  const unknownRoomHeader = await createSignedWebhookHeader(unknownRoomBody, "devkey", "devsecret");
  const reqUnknownRoom = createMockRequest("http://localhost:3001/api/calls/webhook", {
    body: unknownRoomBody,
    headers: { authorization: unknownRoomHeader },
  });
  const resUnknownRoom = await webhookRoute(reqUnknownRoom);
  const unkRoomData = await resUnknownRoom.json();
  assert(unkRoomData.status === "ignored" && unkRoomData.reason === "Unknown call room", "Unknown room webhook safely ignored");

  // Reopen a fresh call for unknown participant test
  const call2 = await createCallSession(db, {
    conversationId: conv.id,
    initiatorId: userA.id,
    inviteeIds: [userB.id],
  });
  const unknownPartBody = JSON.stringify({
    event: "participant_joined",
    room: { name: call2.call.livekitRoomName },
    participant: { identity: "non_existent_user_999" },
  });
  const unknownPartHeader = await createSignedWebhookHeader(unknownPartBody, "devkey", "devsecret");
  const reqUnknownPart = createMockRequest("http://localhost:3001/api/calls/webhook", {
    body: unknownPartBody,
    headers: { authorization: unknownPartHeader },
  });
  const resUnknownPart = await webhookRoute(reqUnknownPart);
  const unkPartData = await resUnknownPart.json();
  assert(unkPartData.status === "ignored" && unkPartData.reason === "Unknown participant in call", "Unknown participant webhook safely ignored");

  // ------------------------------------------------------------------------
  // TEST 15: Concurrent token requests do not create inconsistent state
  // ------------------------------------------------------------------------
  console.log("\n--- TEST 15: Concurrent Token Requests ---");
  const tokenPromises = Array.from({ length: 10 }).map(() =>
    tokenRoute(
      createMockRequest(`http://localhost:3001/api/calls/${call2.call.id}/token`, { cookieToken: sessionTokenA }),
      { params: Promise.resolve({ id: call2.call.id }) }
    )
  );
  const tokenResponses = await Promise.all(tokenPromises);
  const all200 = tokenResponses.every((r) => r.status === 200);
  assert(all200, "All 10 concurrent token requests succeeded (HTTP 200)");

  // ------------------------------------------------------------------------
  // TEST 16: Account disablement prevents further token issuance
  // ------------------------------------------------------------------------
  console.log("\n--- TEST 16: Account Disablement Prevents Token Issuance ---");
  await db.user.update({ where: { id: userA.id }, data: { disabledAt: new Date() } });
  const reqPostDisable = createMockRequest(`http://localhost:3001/api/calls/${call2.call.id}/token`, { cookieToken: sessionTokenA });
  const resPostDisable = await tokenRoute(reqPostDisable, { params: Promise.resolve({ id: call2.call.id }) });
  assert(resPostDisable.status === 401 || resPostDisable.status === 403, "Disabled user strictly blocked from token issuance (401/403)");

  // ------------------------------------------------------------------------
  // TEST 17: Webhook Host Reassignment Consistency
  // ------------------------------------------------------------------------
  console.log("\n--- TEST 17: Webhook Host Reassignment ---");
  await db.user.update({ where: { id: userA.id }, data: { disabledAt: null } });
  const convHostTest = await db.conversation.create({
    data: {
      name: "Host Reassignment Test Group",
      type: "GROUP",
      members: {
        create: [
          { userId: userA.id },
          { userId: userB.id },
          { userId: userC.id },
        ],
      },
    },
  });
  const call3 = await createCallSession(db, {
    conversationId: convHostTest.id,
    initiatorId: userA.id,
    inviteeIds: [userB.id, userC.id],
  });
  await acceptCallInvitation(db, call3.call.id, userB.id);
  await acceptCallInvitation(db, call3.call.id, userC.id);

  // Host Alice leaves via participant_left webhook
  const hostLeftBody = JSON.stringify({
    event: "participant_left",
    room: { name: call3.call.livekitRoomName },
    participant: { identity: userA.id },
  });
  const hostLeftHeader = await createSignedWebhookHeader(hostLeftBody, "devkey", "devsecret");
  const reqHostLeft = createMockRequest("http://localhost:3001/api/calls/webhook", {
    body: hostLeftBody,
    headers: { authorization: hostLeftHeader },
  });
  const resHostLeft = await webhookRoute(reqHostLeft);
  assert(resHostLeft.status === 200, "Host departure webhook processed");

  const call3After = await db.callSession.findUnique({
    where: { id: call3.call.id },
    include: { participants: true },
  });
  assert(call3After?.hostId !== userA.id, "Host was reassigned away from departing User A");
  const hostParts = call3After?.participants.filter((p) => p.isHost);
  assert(hostParts?.length === 1, "Exactly ONE participant holds isHost: true");
  assert(hostParts?.[0].userId === call3After?.hostId, "Call hostId matches isHost participant userId");

  console.log("\n=================================================");
  console.log(`STAGE C RESULTS: ${passed} PASSED, ${failed} FAILED`);
  console.log("=================================================");

  await db.$disconnect();
  process.exit(failed === 0 ? 0 : 1);
}

run().catch((err) => {
  console.error("Test execution failed:", err);
  process.exit(1);
});
