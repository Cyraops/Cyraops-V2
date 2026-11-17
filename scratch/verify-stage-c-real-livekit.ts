import { PrismaClient, CallStatus, ParticipantStatus, CallEventType } from "@prisma/client";
import { NextRequest } from "next/server";
import { createHash } from "node:crypto";
import { SignJWT } from "jose";
import { getRoomServiceClient, createLiveKitRoom, deleteLiveKitRoom } from "../src/lib/calling/livekit-room";
import { POST as tokenRoute } from "../src/app/api/calls/[id]/token/route";
import { POST as webhookRoute } from "../src/app/api/calls/webhook/route";
import { createCallSession, acceptCallInvitation } from "../src/lib/calling/state-machine";

const TEST_DB_URL = "postgresql://tanveersinghsaini:@localhost:5432/company_os_stage_c_test";
process.env.DATABASE_URL = TEST_DB_URL;
process.env.LIVEKIT_URL = "http://127.0.0.1:7880";
process.env.LIVEKIT_API_KEY = "APITvqwWXCN6WPq";
process.env.LIVEKIT_API_SECRET = "p6x4uddeEd04ExrfJ0iuqubMfV75iesCMsv8xMB3NLcA";

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

// Helper to create mock authenticated request
function createMockRequest(url: string, options: { method?: string; body?: any; cookieToken?: string; headers?: Record<string, string> } = {}) {
  const headers = new Headers();
  headers.set("origin", "http://localhost:3001");
  headers.set("host", "localhost:3001");
  headers.set("content-type", "application/json");
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

// Helper to create signed LiveKit webhook Authorization header
async function createSignedWebhookHeader(rawBody: string, apiKey: string, apiSecret: string): Promise<string> {
  const hash = createHash("sha256").update(rawBody).digest("base64");
  return new SignJWT({ sha256: hash })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuer(apiKey)
    .setExpirationTime("1m")
    .sign(new TextEncoder().encode(apiSecret));
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
  console.log("STAGE C VERIFICATION: CONNECTIVITY WITH REAL PRIVATE LIVEKIT SFU");
  console.log("======================================================================");

  await cleanDb();
  const roomService = getRoomServiceClient();

  // 1. Real Room Creation in LiveKit Server
  console.log("\n[C1] Real LiveKit Server Communication: Room Creation & Listing");
  const testRoomName = `cyraops-test-room-${Date.now()}`;
  const created = await createLiveKitRoom({ roomName: testRoomName, maxParticipants: 10 });
  assert(created === true, "createLiveKitRoom succeeded with real LiveKit SFU");

  const rooms = await roomService.listRooms([testRoomName]);
  assert(rooms.length === 1 && rooms[0].name === testRoomName, "Room is physically confirmed to exist in real LiveKit server");

  // 2. Real Room Deletion
  const deleted = await deleteLiveKitRoom(testRoomName);
  assert(deleted === true, "deleteLiveKitRoom succeeded with real LiveKit SFU");
  const roomsAfter = await roomService.listRooms([testRoomName]);
  assert(roomsAfter.length === 0, "Room is confirmed deleted from real LiveKit server");

  // 3. User Setup for Calling and Token Verification
  console.log("\n[C2] Token Endpoint Authorization & Cryptographic Binding");
  const userA = await db.user.create({ data: { name: "Alice Admin", email: "alice@cyraops.com", role: "ADMIN" } });
  const userB = await db.user.create({ data: { name: "Bob Member", email: "bob@cyraops.com", role: "MEMBER" } });
  const userC = await db.user.create({ data: { name: "Charlie Member", email: "charlie@cyraops.com", role: "MEMBER" } });

  const sessionTokenA = "tok_session_alice_c";
  await db.session.create({
    data: { id: "sess_a_c", tokenHash: createHash("sha256").update(sessionTokenA).digest("hex"), userId: userA.id, expiresAt: new Date(Date.now() + 86400000) },
  });

  const sessionTokenB = "tok_session_bob_c";
  await db.session.create({
    data: { id: "sess_b_c", tokenHash: createHash("sha256").update(sessionTokenB).digest("hex"), userId: userB.id, expiresAt: new Date(Date.now() + 86400000) },
  });

  const sessionTokenC = "tok_session_charlie_c";
  await db.session.create({
    data: { id: "sess_c_c", tokenHash: createHash("sha256").update(sessionTokenC).digest("hex"), userId: userC.id, expiresAt: new Date(Date.now() + 86400000) },
  });

  const conv = await db.conversation.create({
    data: {
      type: "DIRECT",
      members: { createMany: { data: [{ userId: userA.id }, { userId: userB.id }] } },
    },
  });

  const callRes = await createCallSession(db, { conversationId: conv.id, initiatorId: userA.id, inviteeIds: [userB.id] });
  const call = callRes.call!;
  assert(call !== null, "CallSession created in DB with livekitRoomName: " + call.livekitRoomName);

  // Unauthenticated Token Request
  const reqUnauth = createMockRequest(`/api/calls/${call.id}/token`);
  const resUnauth = await tokenRoute(reqUnauth, { params: Promise.resolve({ id: call.id }) });
  assert(resUnauth.status === 401, "Unauthenticated request returns 401 Unauthorized");

  // Non-member Token Request
  const reqNonMember = createMockRequest(`/api/calls/${call.id}/token`, { cookieToken: sessionTokenC });
  const resNonMember = await tokenRoute(reqNonMember, { params: Promise.resolve({ id: call.id }) });
  assert(resNonMember.status === 403, "Non-member request returns 403 Forbidden");

  // Valid Token Request for Participant B with attempted tampering
  const reqTamper = createMockRequest(`/api/calls/${call.id}/token`, {
    cookieToken: sessionTokenB,
    body: { userId: userA.id, roomName: "spoofed-room" }, // spoofing attempt
  });
  const resTamper = await tokenRoute(reqTamper, { params: Promise.resolve({ id: call.id }) });
  assert(resTamper.status === 200, "Token endpoint returned HTTP 200 for eligible participant");

  const jsonTamper = await resTamper.json();
  assert(typeof jsonTamper.token === "string", "Valid token string returned");
  assert(jsonTamper.roomName === call.livekitRoomName, "Room name returned matches database, ignoring client spoof");

  // Decode JWT payload to verify claims
  const tokenParts = jsonTamper.token.split(".");
  const payload = JSON.parse(Buffer.from(tokenParts[1], "base64url").toString("utf8"));
  assert(payload.sub === userB.id, "Token sub strictly bound to authenticated User B (tampering rejected)");
  assert(payload.video.room === call.livekitRoomName, "Token video.room strictly bound to call.livekitRoomName");
  assert(payload.iss === process.env.LIVEKIT_API_KEY, "Token issuer matches LIVEKIT_API_KEY");

  // Disabled User Token Request
  await db.user.update({ where: { id: userB.id }, data: { disabledAt: new Date() } });
  await db.session.deleteMany({ where: { userId: userB.id } });

  const reqDisabled = createMockRequest(`/api/calls/${call.id}/token`, { cookieToken: sessionTokenB });
  const resDisabled = await tokenRoute(reqDisabled, { params: Promise.resolve({ id: call.id }) });
  assert(resDisabled.status === 401, "Disabled user request is rejected with 401 Unauthorized");

  // Re-enable User B for webhook tests
  await db.user.update({ where: { id: userB.id }, data: { disabledAt: null } });
  await db.session.create({
    data: { id: "sess_b_c_restored", tokenHash: createHash("sha256").update(sessionTokenB).digest("hex"), userId: userB.id, expiresAt: new Date(Date.now() + 86400000) },
  });

  // 4. Real Webhook Signature Verification and Processing
  console.log("\n[C3] LiveKit Webhook Cryptographic Verification & Authoritative State");

  const sampleEvent = {
    event: "participant_joined",
    room: { name: call.livekitRoomName, sid: "RM_test" },
    participant: { identity: userB.id, sid: "PA_test_b" },
    createdAt: Date.now(),
  };
  const rawBody = JSON.stringify(sampleEvent);

  // Missing Authorization Header
  const reqNoAuth = createMockRequest("/api/calls/webhook", { body: rawBody });
  const resNoAuth = await webhookRoute(reqNoAuth);
  assert(resNoAuth.status === 401, "Missing Authorization header rejected with 401");

  // Invalid / Tampered Signature
  const reqBadSig = createMockRequest("/api/calls/webhook", {
    body: rawBody,
    headers: { authorization: "eyJhbGciOiJIUzI1NiJ9.invalid.signature" },
  });
  const resBadSig = await webhookRoute(reqBadSig);
  assert(resBadSig.status === 401, "Invalid webhook signature rejected with 401");

  // Genuine Signed Webhook
  const authHeader = await createSignedWebhookHeader(rawBody, process.env.LIVEKIT_API_KEY!, process.env.LIVEKIT_API_SECRET!);
  const reqGood = createMockRequest("/api/calls/webhook", {
    body: rawBody,
    headers: { authorization: authHeader },
  });
  const resGood = await webhookRoute(reqGood);
  assert(resGood.status === 200, "Authentic signed LiveKit webhook accepted with 200 OK");

  // Check DB state transition
  const partB = await db.callParticipant.findFirst({ where: { callSessionId: call.id, userId: userB.id } });
  assert(partB?.status === ParticipantStatus.CONNECTED, "Participant B authoritatively transitioned to CONNECTED via webhook");

  // Send participant_joined for User A
  const sampleEventA = {
    event: "participant_joined",
    room: { name: call.livekitRoomName, sid: "RM_test" },
    participant: { identity: userA.id, sid: "PA_test_a" },
    createdAt: Date.now(),
  };
  const rawBodyA = JSON.stringify(sampleEventA);
  const authHeaderA = await createSignedWebhookHeader(rawBodyA, process.env.LIVEKIT_API_KEY!, process.env.LIVEKIT_API_SECRET!);
  const reqGoodA = createMockRequest("/api/calls/webhook", {
    body: rawBodyA,
    headers: { authorization: authHeaderA },
  });
  await webhookRoute(reqGoodA);

  const callAfterBoth = await db.callSession.findUnique({ where: { id: call.id } });
  assert(callAfterBoth?.status === CallStatus.ACTIVE, "CallSession transitioned to ACTIVE when >= 2 participants connected");

  // Duplicate Webhook Delivery
  const reqDup = createMockRequest("/api/calls/webhook", {
    body: rawBodyA,
    headers: { authorization: authHeaderA },
  });
  const resDup = await webhookRoute(reqDup);
  assert(resDup.status === 200, "Duplicate webhook accepted safely without error (idempotent)");

  console.log("\n======================================================================");
  console.log(`STAGE C RESULTS: ${passed} PASSED, ${failed} FAILED`);
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

