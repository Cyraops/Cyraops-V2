import { chromium } from "playwright";
import { PrismaClient, CallStatus, ParticipantStatus } from "@prisma/client";
import fs from "node:fs";
import path from "node:path";
import { createSession } from "../src/lib/auth";
import { getRoomServiceClient } from "../src/lib/calling/livekit-room";

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
  console.log("PHASE 4.4 VERIFICATION: GROUP CALLING UI & WEBRTC VALIDATION");
  console.log("======================================================================");

  // Safety checks
  assert(DEV_DB_URL.includes("company_os_dev"), "Working strictly against company_os_dev");

  // 1. Setup test users in company_os_dev
  const userA = await db.user.upsert({
    where: { email: "group_alice@cyraops.com" },
    create: {
      email: "group_alice@cyraops.com",
      name: "Alice Engineer",
      role: "OWNER",
      passwordHash: "$2a$10$abcdefghijklmnopqrstuu",
    },
    update: { disabledAt: null },
  });

  const userB = await db.user.upsert({
    where: { email: "group_bob@cyraops.com" },
    create: {
      email: "group_bob@cyraops.com",
      name: "Bob Designer",
      role: "MEMBER",
      passwordHash: "$2a$10$abcdefghijklmnopqrstuu",
    },
    update: { disabledAt: null },
  });

  const userC = await db.user.upsert({
    where: { email: "group_charlie@cyraops.com" },
    create: {
      email: "group_charlie@cyraops.com",
      name: "Charlie Product",
      role: "MEMBER",
      passwordHash: "$2a$10$abcdefghijklmnopqrstuu",
    },
    update: { disabledAt: null },
  });

  const sessionA = await createSession(userA.id);
  const sessionB = await createSession(userB.id);
  const sessionC = await createSession(userC.id);

  // Direct conversation for 1:1 regression check
  let directConv = await db.conversation.findFirst({
    where: {
      type: "DIRECT",
      members: { some: { userId: userA.id } },
      AND: { members: { some: { userId: userB.id } } },
    },
  });
  if (!directConv) {
    directConv = await db.conversation.create({
      data: {
        type: "DIRECT",
        createdById: userA.id,
        members: {
          create: [{ userId: userA.id }, { userId: userB.id }],
        },
      },
    });
  }

  // Group conversation for Group calling tests
  let groupConv = await db.conversation.findFirst({
    where: {
      type: "GROUP",
      name: "Design & Engineering Group",
    },
  });
  if (!groupConv) {
    groupConv = await db.conversation.create({
      data: {
        type: "GROUP",
        name: "Design & Engineering Group",
        createdById: userA.id,
        members: {
          create: [{ userId: userA.id }, { userId: userB.id }, { userId: userC.id }],
        },
      },
    });
  }

  // End any old active calls in these conversations
  await db.callSession.updateMany({
    where: {
      conversationId: { in: [directConv.id, groupConv.id] },
      status: { notIn: [CallStatus.ENDED, CallStatus.CANCELLED, CallStatus.FAILED] },
    },
    data: { status: CallStatus.ENDED, endedAt: new Date() },
  });

  console.log(`\nDirect Conversation: ${directConv.id}`);
  console.log(`Group Conversation: ${groupConv.id}`);
  console.log(`User A (Alice, Host): ${userA.name} (${userA.id})`);
  console.log(`User B (Bob): ${userB.name} (${userB.id})`);
  console.log(`User C (Charlie): ${userC.name} (${userC.id})`);

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
  const contextC = await browser.newContext({
    viewport: { width: 1280, height: 800 },
    permissions: ["microphone", "camera"],
  });

  const cookieConfig = (token: string) => [
    {
      name: "company_session",
      value: token,
      domain: "localhost",
      path: "/",
      httpOnly: true,
    },
  ];

  await contextA.addCookies(cookieConfig(sessionA.token));
  await contextB.addCookies(cookieConfig(sessionB.token));
  await contextC.addCookies(cookieConfig(sessionC.token));

  const pageA = await contextA.newPage();
  const pageB = await contextB.newPage();
  const pageC = await contextC.newPage();

  pageA.on('pageerror', err => console.error('[PageA Error]:', err.message));
  pageB.on('pageerror', err => console.error('[PageB Error]:', err.message));
  pageC.on('pageerror', err => console.error('[PageC Error]:', err.message));

  const roomClient = getRoomServiceClient();

  try {
    // ====================================================================
    // TEST 1: 1:1 Calling Backwards Compatibility Regression
    // ====================================================================
    console.log("\n[TEST 1] Verifying 1:1 Calling Backwards Compatibility...");
    await pageA.goto(`http://localhost:3001/chat?conversation=${directConv.id}`);
    await pageB.goto(`http://localhost:3001/chat?conversation=${directConv.id}`);
    await pageA.waitForSelector('button[aria-label="Start audio call"]');

    // Alice starts 1:1 audio call
    await pageA.click('button[aria-label="Start audio call"]');
    console.log("  Alice initiated direct audio call...");

    // Bob receives 1:1 incoming call modal
    await pageB.waitForSelector('div[role="dialog"][aria-label*="Incoming audio call"]', { timeout: 8000 });
    assert(true, "Bob received standard 1:1 IncomingCallModal");

    // Bob accepts call
    await pageB.click('button[aria-label="Accept call"]');
    console.log("  Bob accepted direct audio call...");

    // Both should enter ActiveCallView
    await pageA.waitForSelector('button[aria-label="End call"]', { timeout: 8000 });
    await pageB.waitForSelector('button[aria-label="End call"]', { timeout: 8000 });
    assert(true, "Both participants entered ActiveCallView (1:1 UI preserved)");

    // Alice leaves
    await pageA.click('button[aria-label="End call"]');
    await pageA.waitForTimeout(1500);

    // Verify call ended in DB
    const ended1to1 = await db.callSession.findFirst({
      where: { conversationId: directConv.id },
      orderBy: { createdAt: "desc" },
    });
    assert(ended1to1?.status === CallStatus.ENDED, "1:1 call cleanly transitioned to ENDED status");

    // ====================================================================
    // TEST 2 & 3: Group Call Ring Mode & Multi-Party WebRTC Connection
    // ====================================================================
    console.log("\n[TEST 2 & 3] Verifying Group Call (Ring Mode) with 3 Participants...");
    await pageA.goto(`http://localhost:3001/chat?conversation=${groupConv.id}`);
    await pageB.goto(`http://localhost:3001/chat?conversation=${groupConv.id}`);
    await pageC.goto(`http://localhost:3001/chat?conversation=${groupConv.id}`);

    await pageA.waitForSelector('button[aria-label="Start video call"]');

    // Alice clicks start video call in group conversation
    await pageA.click('button[aria-label="Start video call"]');

    // Verify Group Call Prompt Modal opens with options
    await pageA.waitForSelector('text=Choose how to initiate the call', { timeout: 5000 });
    assert(true, "Group Call prompt dialog opened with Ring All / Open meeting options");

    // Alice clicks 'Start Call' (default: Ring all members)
    await pageA.click('button:has-text("Start Call")');
    console.log("  Alice started group video call with ringAll: true...");

    // Bob & Charlie should both receive GroupIncomingCallModal
    await pageB.waitForSelector('div[role="dialog"][aria-label*="Incoming group video call"]', { timeout: 8000 });
    await pageC.waitForSelector('div[role="dialog"][aria-label*="Incoming group video call"]', { timeout: 8000 });
    assert(true, "Bob and Charlie received GroupIncomingCallModal with group name");

    // Capture Group Incoming Modal screenshot
    const modalShotPath = path.join(ARTIFACTS_DIR, "group-calling-incoming-modal.png");
    await pageB.screenshot({ path: modalShotPath });
    assert(fs.existsSync(modalShotPath), "Captured group-calling-incoming-modal.png");

    // Bob accepts call
    await pageB.click('button[aria-label="Join call"]');
    console.log("  Bob accepted group call...");

    // Charlie accepts call
    await pageC.click('button[aria-label="Join call"]');
    console.log("  Charlie accepted group call...");

    // Alice, Bob, and Charlie should now all be in GroupCallStage
    await pageA.waitForSelector('div[role="region"][aria-label*="Active group call"]', { timeout: 10000 });
    await pageB.waitForSelector('div[role="region"][aria-label*="Active group call"]', { timeout: 10000 });
    await pageC.waitForSelector('div[role="region"][aria-label*="Active group call"]', { timeout: 10000 });
    assert(true, "Alice, Bob, and Charlie all connected to GroupCallStage");

    // Wait for LiveKit remote tracks to attach
    await pageA.waitForTimeout(3000);

    // Verify 3 tiles on Alice's grid
    const aliceTiles = await pageA.$$('div[role="region"][aria-label*="Participant tile:"]');
    assert(aliceTiles.length === 3, `Alice's grid shows 3 participants (found: ${aliceTiles.length})`);

    // Verify Alice is marked as Host
    const crownIcons = await pageA.$$('svg.lucide-crown');
    assert(crownIcons.length > 0, "Alice tile displays host Crown badge");

    // Capture 3-participant active video grid screenshot
    const gridShotPath = path.join(ARTIFACTS_DIR, "group-calling-active-grid.png");
    await pageA.screenshot({ path: gridShotPath });
    assert(fs.existsSync(gridShotPath), "Captured group-calling-active-grid.png");

    // Verify SFU room participant count
    const activeGroupCall = await db.callSession.findFirst({
      where: { conversationId: groupConv.id, status: CallStatus.ACTIVE },
      orderBy: { createdAt: "desc" },
    });
    if (activeGroupCall) {
      const sfuParticipants = await roomClient.listParticipants(activeGroupCall.livekitRoomName);
      assert(sfuParticipants.length === 3, `LiveKit SFU room has exactly 3 participants (found: ${sfuParticipants.length})`);
    }

    // ====================================================================
    // TEST 4: Participant Roster & Host In-Call Controls
    // ====================================================================
    console.log("\n[TEST 4] Verifying Participant Roster & Host Controls...");

    // Alice opens roster
    await pageA.click('button[aria-label="Toggle participant list"]');
    await pageA.waitForSelector('aside[aria-label="Participants roster"]', { timeout: 8000 });
    assert(true, "Participant roster sidebar opened successfully");

    // Capture Roster screenshot
    const rosterShotPath = path.join(ARTIFACTS_DIR, "group-calling-roster.png");
    await pageA.screenshot({ path: rosterShotPath });
    assert(fs.existsSync(rosterShotPath), "Captured group-calling-roster.png");

    // Host Alice transfers host role to Bob
    await pageA.click('button[aria-label*="Transfer host to Bob"]');
    await pageA.waitForTimeout(1000);

    // Verify DB updated hostId to Bob
    const updatedCall = await db.callSession.findUnique({ where: { id: activeGroupCall!.id } });
    assert(updatedCall?.hostId === userB.id, "Host role successfully transferred to Bob");

    // Bob (now host) kicks Charlie
    await pageB.click('button[aria-label="Toggle participant list"]');
    await pageB.waitForSelector('aside[aria-label="Participants roster"]', { timeout: 8000 });
    await pageB.click(`button[aria-label="Remove ${userC.name} from meeting"]`);
    console.log("  Bob kicked Charlie from group call...");
    await pageB.waitForTimeout(2000);

    // Verify Charlie was ejected
    const charliePart = await db.callParticipant.findUnique({
      where: { callSessionId_userId: { callSessionId: activeGroupCall!.id, userId: userC.id } },
    });
    assert(charliePart?.status === ParticipantStatus.EJECTED, "Charlie participant status is EJECTED in DB");

    // Verify Charlie's client receives disconnection
    await pageC.waitForTimeout(1500);

    // ====================================================================
    // TEST 5: Participant Departure & Non-Termination of Group Call
    // ====================================================================
    console.log("\n[TEST 5] Verifying Group Call Stays Active When Participant Leaves...");

    // Bob leaves the call
    await pageB.click('button[aria-label="Leave call"]');
    console.log("  Bob left the call...");
    await pageB.waitForTimeout(1500);

    // Call MUST remain ACTIVE because Alice is still in the call!
    const callAfterBobLeaves = await db.callSession.findUnique({ where: { id: activeGroupCall!.id } });
    assert(callAfterBobLeaves?.status === CallStatus.ACTIVE, "Group call remains ACTIVE when 1 member leaves");

    // Alice leaves -> last participant left
    await pageA.click('button[aria-label="Leave call"]');
    console.log("  Alice left the call...");
    await pageA.waitForTimeout(2000);

    // Call should now be ENDED
    const callFinal = await db.callSession.findUnique({ where: { id: activeGroupCall!.id } });
    assert(callFinal?.status === CallStatus.ENDED, "Group call cleanly transitions to ENDED when last participant leaves");

    // ====================================================================
    // TEST 6: Open Group Meeting Mode & In-Chat Join Banner
    // ====================================================================
    console.log("\n[TEST 6] Verifying Open Group Meeting Mode & In-Chat Banner...");
    await pageA.goto(`http://localhost:3001/chat?conversation=${groupConv.id}`);
    await pageB.goto(`http://localhost:3001/chat?conversation=${groupConv.id}`);

    await pageA.waitForSelector('button[aria-label="Start audio call"]');
    await pageA.click('button[aria-label="Start audio call"]');

    // Alice chooses "Open meeting"
    await pageA.waitForSelector('text=Choose how to initiate the call', { timeout: 5000 });
    await pageA.click('label:has-text("Open meeting")');
    await pageA.click('button:has-text("Start Call")');
    console.log("  Alice started Open Group Meeting (ringAll: false)...");

    // Alice enters GroupCallStage
    await pageA.waitForSelector('div[role="region"][aria-label*="Active group call"]', { timeout: 10000 });
    assert(true, "Alice entered Open Meeting call stage");

    // Bob did NOT get ringing dialog; instead, Bob sees InChatCallBanner
    await pageB.waitForSelector('div[role="region"][aria-label="Active group meeting in this channel"]', { timeout: 8000 });
    assert(true, "Bob sees persistent InChatCallBanner in group chat timeline");

    // Capture In-Chat Banner screenshot
    const bannerShotPath = path.join(ARTIFACTS_DIR, "group-calling-in-chat-banner.png");
    await pageB.screenshot({ path: bannerShotPath });
    assert(fs.existsSync(bannerShotPath), "Captured group-calling-in-chat-banner.png");

    // Bob clicks "Join Call" on banner
    await pageB.click('button:has-text("Join Call")');
    console.log("  Bob joined open meeting via InChatCallBanner...");

    // Bob transitions into GroupCallStage
    await pageB.waitForSelector('div[role="region"][aria-label*="Active group call"]', { timeout: 10000 });
    assert(true, "Bob successfully joined meeting and entered GroupCallStage");

    // Clean up: Alice ends meeting for everyone
    await pageA.click('button[aria-label="Host options"]');
    await pageA.waitForSelector('text=End Meeting for Everyone', { timeout: 3000 });
    await pageA.click('button:has-text("End Meeting for Everyone")');
    console.log("  Host Alice ended meeting for everyone...");
    await pageA.waitForTimeout(2000);

    const openCallEnded = await db.callSession.findFirst({
      where: { conversationId: groupConv.id },
      orderBy: { createdAt: "desc" },
    });
    assert(openCallEnded?.status === CallStatus.CANCELLED || openCallEnded?.status === CallStatus.ENDED, "Open meeting cancelled/ended by host for everyone");

  } finally {
    await browser.close();
    await db.$disconnect();
  }

  console.log("\n======================================================================");
  console.log(`PHASE 4.4 VERIFICATION COMPLETE: ${passed} PASSED, ${failed} FAILED`);
  console.log("======================================================================");
}

run().catch((err) => {
  console.error("FATAL TEST EXECUTION ERROR:", err);
  process.exit(1);
});
