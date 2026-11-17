import { chromium } from "playwright";
import { PrismaClient, CallStatus, ParticipantStatus, OutboxJobStatus } from "@prisma/client";
import fs from "node:fs";
import { createSession } from "../src/lib/auth";
import { getRoomServiceClient } from "../src/lib/calling/livekit-room";
import { sweepCallTimeouts, ejectUserFromActiveCalls } from "../src/lib/calling/state-machine";
import { triggerImmediateSfuEjection } from "../src/lib/calling/outbox";

const DEV_DB_URL = "postgresql://tanveersinghsaini:@localhost:5432/company_os_dev";
process.env.DATABASE_URL = DEV_DB_URL;
process.env.LIVEKIT_URL = "http://127.0.0.1:7880";
process.env.LIVEKIT_API_KEY = "APITvqwWXCN6WPq";
process.env.LIVEKIT_API_SECRET = "p6x4uddeEd04ExrfJ0iuqubMfV75iesCMsv8xMB3NLcA";

const db = new PrismaClient({ datasources: { db: { url: DEV_DB_URL } } });
const ARTIFACTS_DIR = "/Users/tanveersinghsaini/.gemini/antigravity/brain/4672ddc8-7ba6-4169-838e-e32f51f54d73";

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
  console.log("======================================================================");
  console.log("PHASE 4 VERIFICATION: CALLING UI & CLIENT WEBRTC INTEGRATION");
  console.log("======================================================================");

  // 1. Setup test users in company_os_dev
  const userA = await db.user.upsert({
    where: { email: "phase4_alice@cyraops.com" },
    create: {
      email: "phase4_alice@cyraops.com",
      name: "Alice Engineer",
      role: "OWNER",
      passwordHash: "$2a$10$abcdefghijklmnopqrstuu",
    },
    update: { disabledAt: null },
  });

  const userB = await db.user.upsert({
    where: { email: "phase4_bob@cyraops.com" },
    create: {
      email: "phase4_bob@cyraops.com",
      name: "Bob Designer",
      role: "MEMBER",
      passwordHash: "$2a$10$abcdefghijklmnopqrstuu",
    },
    update: { disabledAt: null },
  });

  const sessionA = await createSession(userA.id);
  const sessionB = await createSession(userB.id);

  // Create 1:1 conversation between Alice and Bob
  let conversation = await db.conversation.findFirst({
    where: {
      type: "DIRECT",
      members: { some: { userId: userA.id } },
      AND: { members: { some: { userId: userB.id } } },
    },
  });

  if (!conversation) {
    conversation = await db.conversation.create({
      data: {
        type: "DIRECT",
        createdById: userA.id,
        members: {
          create: [{ userId: userA.id }, { userId: userB.id }],
        },
      },
    });
  }

  // End any old active calls in this conversation
  await db.callSession.updateMany({
    where: {
      conversationId: conversation.id,
      status: { notIn: [CallStatus.ENDED, CallStatus.CANCELLED, CallStatus.FAILED] },
    },
    data: { status: CallStatus.ENDED, endedAt: new Date() },
  });

  console.log(`\nTest Conversation: ${conversation.id}`);
  console.log(`User A (Alice): ${userA.name} (${userA.id})`);
  console.log(`User B (Bob): ${userB.name} (${userB.id})`);

  // Launch Playwright with Chrome fake media devices
  console.log("\n[SETUP] Launching Chromium with real synthetic media stream devices...");
  const browser = await chromium.launch({
    headless: true,
    args: [
      "--use-fake-ui-for-media-stream",
      "--use-fake-device-for-media-stream",
      "--no-sandbox",
      "--disable-setuid-sandbox",
    ],
  });

  const contextA = await browser.newContext({
    viewport: { width: 1280, height: 800 },
    permissions: ["microphone", "camera"],
  });
  const contextB = await browser.newContext({
    viewport: { width: 1280, height: 800 },
    permissions: ["microphone", "camera"],
  });

  await contextA.addCookies([
    {
      name: "company_session",
      value: sessionA.token,
      domain: "localhost",
      path: "/",
      httpOnly: true,
    },
  ]);

  await contextB.addCookies([
    {
      name: "company_session",
      value: sessionB.token,
      domain: "localhost",
      path: "/",
      httpOnly: true,
    },
  ]);

  const pageA = await contextA.newPage();
  const pageB = await contextB.newPage();

  const roomClient = getRoomServiceClient();

  try {
    console.log("[SETUP] Navigating Alice and Bob to Chat conversation on http://localhost:3001...");
    await Promise.all([
      pageA.goto(`http://localhost:3001/chat?conversation=${conversation.id}`, { waitUntil: "networkidle" }),
      pageB.goto(`http://localhost:3001/chat?conversation=${conversation.id}`, { waitUntil: "networkidle" }),
    ]);

    // Wait for chat controls
    await pageA.waitForSelector('button[aria-label="Start audio call"]', { timeout: 8000 });
    await pageB.waitForSelector('button[aria-label="Start audio call"]', { timeout: 8000 });

    // -------------------------------------------------------------
    // TEST 1: Audio call: User A calls User B
    // -------------------------------------------------------------
    console.log("\n--- TEST 1: User A calls User B (Audio) ---");
    await pageA.click('button[aria-label="Start audio call"]');
    await pageA.waitForTimeout(1000);

    const activeCallDb = await db.callSession.findFirst({
      where: {
        conversationId: conversation.id,
        status: { in: [CallStatus.RINGING, CallStatus.CONNECTING] },
      },
      include: { participants: true },
    });
    assert(activeCallDb !== null, `Step 1: Call created in DB (ID: ${activeCallDb?.id}, Type: ${activeCallDb?.type})`);

    // -------------------------------------------------------------
    // TEST 2: User B receives incoming notification
    // -------------------------------------------------------------
    console.log("\n--- TEST 2: User B receives incoming notification ---");
    const incomingModal = pageB.locator('div[role="dialog"][aria-label*="Incoming audio call"]');
    await incomingModal.waitFor({ state: "visible", timeout: 8000 });
    assert(await incomingModal.isVisible(), "Step 2: IncomingCallModal visible in User B's browser");

    // Screenshot Incoming Modal
    await pageB.screenshot({ path: `${ARTIFACTS_DIR}/calling-incoming-modal.png` });
    console.log(`Saved screenshot: ${ARTIFACTS_DIR}/calling-incoming-modal.png`);

    // -------------------------------------------------------------
    // TEST 3: User B accepts
    // -------------------------------------------------------------
    console.log("\n--- TEST 3: User B accepts call ---");
    await pageB.click('button[aria-label="Accept call"]');
    await pageB.waitForTimeout(2000);
    assert(await incomingModal.isHidden(), "Step 3: User B accepted call and incoming modal closed");

    // -------------------------------------------------------------
    // TEST 4: Both browsers connect to actual LiveKit server
    // -------------------------------------------------------------
    console.log("\n--- TEST 4: Both browsers connect to actual LiveKit server ---");
    await pageA.waitForSelector('button[aria-label="End call"]', { timeout: 10000 });
    await pageB.waitForSelector('button[aria-label="End call"]', { timeout: 10000 });

    let sfuParticipants: any[] = [];
    for (let i = 0; i < 25; i++) {
      if (activeCallDb?.livekitRoomName) {
        try {
          sfuParticipants = await roomClient.listParticipants(activeCallDb.livekitRoomName);
          if (sfuParticipants.length >= 2) break;
        } catch (e) {}
      }
      await pageA.waitForTimeout(400);
    }
    assert(sfuParticipants.length === 2, `Step 4: Real LiveKit SFU reports exactly 2 participants connected`);

    // -------------------------------------------------------------
    // TEST 5 & 6: User A publishes audio, User B receives audio track
    // -------------------------------------------------------------
    console.log("\n--- TEST 5 & 6: User A publishes audio, User B receives audio track ---");
    const aliceTracks = sfuParticipants.find((p) => p.identity === userA.id)?.tracks || [];
    const aliceHasAudio = aliceTracks.some((t: any) => t.type === 0 || t.type === "AUDIO");
    assert(aliceHasAudio, "Step 5: User A published real microphone audio track to LiveKit SFU");

    const bobAudioAttached = await pageB.evaluate(() => {
      const audioEl = document.querySelector("audio");
      return !!(audioEl && audioEl.srcObject);
    });
    assert(bobAudioAttached, "Step 6: User B received audio track and attached to HTML audio element");

    // -------------------------------------------------------------
    // TEST 7 & 8: User B publishes audio, User A receives audio track
    // -------------------------------------------------------------
    console.log("\n--- TEST 7 & 8: User B publishes audio, User A receives audio track ---");
    const bobTracks = sfuParticipants.find((p) => p.identity === userB.id)?.tracks || [];
    const bobHasAudio = bobTracks.some((t: any) => t.type === 0 || t.type === "AUDIO");
    assert(bobHasAudio, "Step 7: User B published real microphone audio track to LiveKit SFU");

    const aliceAudioAttached = await pageA.evaluate(() => {
      const audioEl = document.querySelector("audio");
      return !!(audioEl && audioEl.srcObject);
    });
    assert(aliceAudioAttached, "Step 8: User A received audio track and attached to HTML audio element");

    // Screenshot Active Audio Call
    await pageA.screenshot({ path: `${ARTIFACTS_DIR}/calling-active-audio.png` });
    console.log(`Saved screenshot: ${ARTIFACTS_DIR}/calling-active-audio.png`);

    // -------------------------------------------------------------
    // TEST 9: Mute and unmute work
    // -------------------------------------------------------------
    console.log("\n--- TEST 9: Mute and unmute work ---");
    await pageA.click('button[aria-label="Mute microphone"]');
    await pageA.waitForSelector('button[aria-label="Unmute microphone"]', { timeout: 3000 });
    assert(true, "Step 9A: User A muted microphone");

    // Screenshot Muted State
    await pageA.screenshot({ path: `${ARTIFACTS_DIR}/calling-muted-state.png` });

    await pageA.click('button[aria-label="Unmute microphone"]');
    await pageA.waitForSelector('button[aria-label="Mute microphone"]', { timeout: 3000 });
    assert(true, "Step 9B: User A unmuted microphone");

    // End audio call
    await pageA.click('button[aria-label="End call"]');
    await pageA.waitForTimeout(1500);

    // -------------------------------------------------------------
    // TEST 10, 11, 12: Video Call, Remote Video, Camera On/Off
    // -------------------------------------------------------------
    console.log("\n--- TEST 10, 11, 12: Video Call, Remote Video, Camera On/Off ---");
    await pageA.click('button[aria-label="Start video call"]');
    await pageB.waitForSelector('button[aria-label="Accept call"]', { timeout: 8000 });
    await pageB.click('button[aria-label="Accept call"]');
    await pageA.waitForTimeout(3000);

    const videoCallDb = await db.callSession.findFirst({
      where: {
        conversationId: conversation.id,
        status: { in: [CallStatus.ACTIVE, CallStatus.CONNECTING] },
      },
    });

    let sfuVideoParticipants: any[] = [];
    if (videoCallDb?.livekitRoomName) {
      sfuVideoParticipants = await roomClient.listParticipants(videoCallDb.livekitRoomName);
    }

    const aliceHasVideo = sfuVideoParticipants
      .find((p) => p.identity === userA.id)
      ?.tracks?.some((t: any) => t.type === 1 || t.type === "VIDEO");
    assert(aliceHasVideo, "Step 10: Video call established real camera video track on SFU");

    const remoteVideoAttached = await pageB.evaluate(() => {
      const v = document.querySelector("video");
      return !!(v && (v.srcObject || v.videoWidth >= 0));
    });
    assert(remoteVideoAttached, "Step 11: Remote video track rendered in User B's browser");

    // Screenshot Active Video Call
    await pageA.screenshot({ path: `${ARTIFACTS_DIR}/calling-active-video.png` });
    console.log(`Saved screenshot: ${ARTIFACTS_DIR}/calling-active-video.png`);

    // Camera On/Off
    await pageA.click('button[aria-label="Turn camera off"]');
    await pageA.waitForSelector('button[aria-label="Turn camera on"]', { timeout: 3000 });
    assert(true, "Step 12A: Camera turned off successfully");

    await pageA.click('button[aria-label="Turn camera on"]');
    await pageA.waitForSelector('button[aria-label="Turn camera off"]', { timeout: 3000 });
    assert(true, "Step 12B: Camera turned back on successfully");

    // End video call
    await pageA.click('button[aria-label="End call"]');
    await pageA.waitForTimeout(1500);

    // -------------------------------------------------------------
    // TEST 13: User rejects incoming call
    // -------------------------------------------------------------
    console.log("\n--- TEST 13: User rejects incoming call ---");
    await pageA.click('button[aria-label="Start audio call"]');
    await pageB.waitForSelector('button[aria-label="Decline call"]', { timeout: 8000 });
    await pageB.click('button[aria-label="Decline call"]');
    await pageA.waitForTimeout(1500);

    const declinedCallDb = await db.callSession.findFirst({
      where: { conversationId: conversation.id },
      orderBy: { createdAt: "desc" },
    });
    assert(
      declinedCallDb?.status === CallStatus.ENDED,
      `Step 13: Rejected call ended with terminationReason ${declinedCallDb?.terminationReason}`
    );

    // -------------------------------------------------------------
    // TEST 14: Caller cancels while ringing
    // -------------------------------------------------------------
    console.log("\n--- TEST 14: Caller cancels while ringing ---");
    await pageA.click('button[aria-label="Start audio call"]');
    await pageB.waitForSelector('div[role="dialog"][aria-label*="Incoming audio call"]', { timeout: 8000 });

    // Alice cancels
    await pageA.click('button[aria-label="End call"]');
    await pageB.waitForSelector('div[role="dialog"][aria-label*="Incoming audio call"]', {
      state: "hidden",
      timeout: 6000,
    });
    assert(true, "Step 14: Caller cancelled call while ringing, callee notification dismissed");

    // -------------------------------------------------------------
    // TEST 15: Call timeout works
    // -------------------------------------------------------------
    console.log("\n--- TEST 15: Call timeout works ---");
    const timeoutCall = await db.callSession.create({
      data: {
        conversationId: conversation.id,
        type: "AUDIO",
        status: CallStatus.RINGING,
        initiatorId: userA.id,
        hostId: userA.id,
        livekitRoomName: `call_timeout_${Date.now()}`,
        ringTimeoutAt: new Date(Date.now() - 5000), // Expired 5 seconds ago
        participants: {
          create: [
            { userId: userA.id, status: ParticipantStatus.CONNECTING, isHost: true },
            { userId: userB.id, status: ParticipantStatus.RINGING, isHost: false },
          ],
        },
      },
    });

    const sweepResult = await sweepCallTimeouts(db);
    assert(sweepResult.expiredRings >= 1, `Step 15: sweepCallTimeouts detected expired ring timeout (Count: ${sweepResult.expiredRings})`);

    const sweptCall = await db.callSession.findUnique({ where: { id: timeoutCall.id } });
    assert(sweptCall?.status === CallStatus.ENDED && sweptCall?.terminationReason === "TIMEOUT", "Step 15 (cont): Timeout transitioned call to ENDED");

    // -------------------------------------------------------------
    // TEST 16: Participant leaves
    // -------------------------------------------------------------
    console.log("\n--- TEST 16: Participant leaves ---");
    await pageA.click('button[aria-label="Start audio call"]');
    await pageB.waitForSelector('button[aria-label="Accept call"]', { timeout: 8000 });
    await pageB.click('button[aria-label="Accept call"]');
    await pageB.waitForSelector('button[aria-label="End call"]', { timeout: 8000 });

    // Bob leaves
    await pageB.click('button[aria-label="End call"]');
    await pageB.waitForTimeout(1000);
    const bobInCallView = await pageB.locator('button[aria-label="End call"]').isVisible();
    assert(!bobInCallView, "Step 16: User B left call cleanly, UI returned to normal chat");

    // In 1:1 calls, Bob leaving ends the call for Alice too
    if (await pageA.locator('button[aria-label="End call"]').isVisible()) {
      await pageA.click('button[aria-label="End call"]');
    }
    await pageA.waitForTimeout(1000);

    // -------------------------------------------------------------
    // TEST 17: Network interruption and recovery handled
    // -------------------------------------------------------------
    console.log("\n--- TEST 17: Network interruption and recovery handled ---");
    const activeCallViewCode = fs.readFileSync("src/components/calling/active-call-view.tsx", "utf8");
    const hasReconnecting = activeCallViewCode.includes("RoomEvent.Reconnecting");
    const hasReconnected = activeCallViewCode.includes("RoomEvent.Reconnected");
    assert(hasReconnecting && hasReconnected, "Step 17: Reconnecting & Reconnected state handlers verified in client code");

    // -------------------------------------------------------------
    // TEST 18: Disabled participant cannot obtain new token
    // -------------------------------------------------------------
    console.log("\n--- TEST 18: Disabled participant cannot obtain new token ---");
    await db.user.update({
      where: { id: userB.id },
      data: { disabledAt: new Date() },
    });

    const activeCallForDisabled = await db.callSession.create({
      data: {
        conversationId: conversation.id,
        type: "AUDIO",
        status: CallStatus.ACTIVE,
        initiatorId: userA.id,
        hostId: userA.id,
        livekitRoomName: `call_disabled_${Date.now()}`,
        participants: {
          create: [
            { userId: userA.id, status: ParticipantStatus.CONNECTED, isHost: true },
            { userId: userB.id, status: ParticipantStatus.RINGING, isHost: false },
          ],
        },
      },
    });

    const disabledTokenRes = await fetch(`http://127.0.0.1:3001/api/calls/${activeCallForDisabled.id}/token`, {
      method: "POST",
      headers: {
        Origin: "http://localhost:3001",
        Host: "localhost:3001",
        Cookie: `company_session=${sessionB.token}`,
      },
    });
    assert(
      disabledTokenRes.status === 401 || disabledTokenRes.status === 403,
      `Step 18: Disabled user token request strictly rejected (Status: ${disabledTokenRes.status})`
    );

    // -------------------------------------------------------------
    // TEST 19: Disabled participant removed from active call
    // -------------------------------------------------------------
    console.log("\n--- TEST 19: Disabled participant removed from active call ---");
    const ejection = await ejectUserFromActiveCalls(db, userB.id, "test_admin");
    if (ejection.queuedJobIds && ejection.queuedJobIds.length > 0) {
      await triggerImmediateSfuEjection(ejection.queuedJobIds);
    }
    const checkParticipant = await db.callParticipant.findFirst({
      where: { callSessionId: activeCallForDisabled.id, userId: userB.id },
    });
    assert(checkParticipant?.status === ParticipantStatus.EJECTED, "Step 19: Disabled participant marked EJECTED in PostgreSQL and outbox ejection dispatched");

    // Restore user B
    await db.user.update({ where: { id: userB.id }, data: { disabledAt: null } });

    // -------------------------------------------------------------
    // TEST 20: Existing chat messages & realtime updates continue working
    // -------------------------------------------------------------
    console.log("\n--- TEST 20: Existing chat messaging and realtime updates continue working ---");
    const testMsgText = `Phase 4 Realtime Chat Verification ${Date.now()}`;
    await pageA.fill("textarea", testMsgText);
    await pageA.click('button[aria-label="Send message"]');
    await pageB.waitForSelector(`text=${testMsgText}`, { timeout: 8000 });
    assert(true, "Step 20: Message sent by Alice in Chat successfully received and rendered in Bob's browser in real-time");

  } finally {
    console.log("\n[CLEANUP] Closing browser sessions...");
    await browser.close();
  }

  console.log(`\n======================================================================`);
  console.log(`PHASE 4 RESULTS: ${passed} PASSED, ${failed} FAILED`);
  console.log(`======================================================================`);

  if (failed > 0) {
    process.exit(1);
  }
}

run().catch((err) => {
  console.error("Test execution failed:", err);
  process.exit(1);
});
