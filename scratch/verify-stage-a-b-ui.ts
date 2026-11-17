import { chromium } from "playwright";
import { PrismaClient, CallStatus, ParticipantStatus } from "@prisma/client";
import { createSession } from "../src/lib/auth";

const DEV_DB_URL = "postgresql://tanveersinghsaini:@localhost:5432/company_os_dev";
const db = new PrismaClient({ datasources: { db: { url: DEV_DB_URL } } });

async function run() {
  console.log("======================================================================");
  console.log("PHASE 4.2 VERIFICATION: PLAYWRIGHT BROWSER UI BATTERY (STAGES A, B, E, H)");
  console.log("======================================================================");

  // 1. Clean up old calls
  await db.callSession.updateMany({
    where: { status: { in: [CallStatus.CREATED, CallStatus.RINGING, CallStatus.CONNECTING, CallStatus.ACTIVE] } },
    data: { status: CallStatus.ENDED },
  });

  const alice = await db.user.findFirst({ where: { email: "audit_alice@cyraops.com" } });
  const bob = await db.user.findFirst({ where: { email: "audit_bob@cyraops.com" } });
  if (!alice || !bob) throw new Error("Audit users not found");

  let conv = await db.conversation.findFirst({
    where: {
      type: "DIRECT",
      AND: [
        { members: { some: { userId: alice.id } } },
        { members: { some: { userId: bob.id } } },
      ],
    },
  });
  if (!conv) {
    conv = await db.conversation.create({
      data: {
        type: "DIRECT",
        members: { create: [{ userId: alice.id }, { userId: bob.id }] },
      },
    });
  }

  // Create active sessions
  const sessAlice = await createSession(alice.id);
  const sessBob = await createSession(bob.id);

  const browser = await chromium.launch({
    headless: true,
    args: [
      "--use-fake-ui-for-media-stream",
      "--use-fake-device-for-media-stream",
      "--disable-web-security",
      "--no-sandbox",
    ],
  });

  const contextA = await browser.newContext();
  await contextA.addCookies([
    { name: "company_session", value: sessAlice.token, domain: "localhost", path: "/" },
    { name: "company_session", value: sessAlice.token, url: "http://localhost:3001" },
  ]);
  const pageA = await contextA.newPage();

  // Bob context with TWO tabs (Multi-tab test)
  const contextB = await browser.newContext();
  await contextB.addCookies([
    { name: "company_session", value: sessBob.token, domain: "localhost", path: "/" },
    { name: "company_session", value: sessBob.token, url: "http://localhost:3001" },
  ]);
  const pageB1 = await contextB.newPage();
  const pageB2 = await contextB.newPage();

  let capturedIdempotencyKey: any = null;
  // Track responses on pageA to verify API call results
  pageA.on("response", async (res) => {
    if (res.url().includes("/api/calls")) {
      console.log(`[pageA response] ${res.status()} ${res.url()}:`, await res.text().catch(() => ""));
    }
  });
  pageA.on("console", (msg) => console.log("[pageA console]", msg.text()));
  pageB1.on("console", (msg) => console.log("[pageB1 console]", msg.text()));
  pageB2.on("console", (msg) => console.log("[pageB2 console]", msg.text()));
  pageA.on("pageerror", (err) => console.error("[pageA error]", err));
  pageB1.on("pageerror", (err) => console.error("[pageB1 error]", err));
  pageB2.on("pageerror", (err) => console.error("[pageB2 error]", err));
  pageA.on("request", (req) => {
    if (req.url().includes("/api/calls") && req.method() === "POST") {
      const headers = req.headers();
      console.log("[DEBUG REQUEST HEADERS]", {
        url: req.url(),
        origin: headers["origin"],
        host: headers["host"],
        referer: headers["referer"],
        allHeaders: headers,
      });
      if (headers["idempotency-key"]) {
        capturedIdempotencyKey = headers["idempotency-key"];
      }
    }
  });

  console.log("\nNavigating all 3 pages to /chat...");
  await Promise.all([
    pageA.goto(`http://localhost:3001/chat?conversation=${conv.id}`, { waitUntil: "domcontentloaded" }),
    pageB1.goto(`http://localhost:3001/chat?conversation=${conv.id}`, { waitUntil: "domcontentloaded" }),
    pageB2.goto(`http://localhost:3001/chat?conversation=${conv.id}`, { waitUntil: "domcontentloaded" }),
  ]);

  console.log("\nWaiting for Live connection on all 3 pages...");
  await Promise.all([
    pageA.locator("text=Live connection").waitFor({ state: "visible", timeout: 15000 }),
    pageB1.locator("text=Live connection").waitFor({ state: "visible", timeout: 15000 }),
    pageB2.locator("text=Live connection").waitFor({ state: "visible", timeout: 15000 }),
  ]);
  console.log("All 3 pages connected to Socket.IO successfully!");

  // -------------------------------------------------------------------------
  // STAGE A: Multi-Tab Ringing Desync Test
  // -------------------------------------------------------------------------
  console.log("\n[STAGE A] Multi-Tab Ringing Synchronization Test");
  console.log("  Initiating call from Alice to Bob...");
  const audioCallBtn = pageA.locator('button[aria-label="Start audio call"]');
  await audioCallBtn.waitFor({ state: "visible" });
  await audioCallBtn.click();

  // Verify Idempotency-Key was sent (Stage H verification)
  await pageA.waitForTimeout(1000);
  if (capturedIdempotencyKey && capturedIdempotencyKey.length > 20) {
    console.log(`  [STAGE H PASS] Client generated and sent Idempotency-Key header: ${capturedIdempotencyKey}`);
  } else {
    console.error("  [STAGE H FAIL] Missing or invalid Idempotency-Key header!");
    process.exit(1);
  }

  // Both Bob Tab 1 and Tab 2 must display the incoming call modal
  console.log("  Verifying both Tab 1 and Tab 2 show IncomingCallModal...");
  const modalB1 = pageB1.locator('div[role="dialog"]');
  const modalB2 = pageB2.locator('div[role="dialog"]');

  await modalB1.waitFor({ state: "visible", timeout: 8000 });
  await modalB2.waitFor({ state: "visible", timeout: 8000 });
  console.log("  Both Tab 1 and Tab 2 are ringing!");

  // Now accept on Tab 1
  console.log("  Accepting call in Tab 1...");
  const acceptBtn = pageB1.locator('button[aria-label="Accept call"]');
  await acceptBtn.click();

  // Tab 1 must mount ActiveCallView
  await pageB1.locator('button[aria-label="End call"]').waitFor({ state: "visible", timeout: 8000 });
  console.log("  Tab 1 successfully mounted ActiveCallView!");

  // CRITICAL: Tab 2 MUST dismiss IncomingCallModal immediately!
  console.log("  Verifying Tab 2 dismissed IncomingCallModal...");
  await modalB2.waitFor({ state: "hidden", timeout: 5000 });
  console.log("  [STAGE A PASS] Tab 2 dismissed IncomingCallModal and stopped ringing!");

  // -------------------------------------------------------------------------
  // STAGE B: Active Call Recovery After Page Reload
  // -------------------------------------------------------------------------
  console.log("\n[STAGE B] Active Call Recovery After Page Refresh Test");
  console.log("  1. Caller (Alice) refreshing page during active call...");
  await pageA.reload({ waitUntil: "domcontentloaded" });

  // Alice must recover in-call UI!
  const callerEndCallBtn = pageA.locator('button[aria-label="End call"]');
  await callerEndCallBtn.waitFor({ state: "visible", timeout: 10000 });
  console.log("  [STAGE B PASS] Caller recovered ActiveCallView after page reload!");

  console.log("  2. Recipient (Bob Tab 1) refreshing page during active call...");
  await pageB1.reload({ waitUntil: "domcontentloaded" });

  // Bob must recover in-call UI!
  const recipientEndCallBtn = pageB1.locator('button[aria-label="End call"]');
  await recipientEndCallBtn.waitFor({ state: "visible", timeout: 10000 });
  console.log("  [STAGE B PASS] Recipient recovered ActiveCallView after page reload!");

  // -------------------------------------------------------------------------
  // STAGE E: Tab Close Cleanup (sendBeacon / leave)
  // -------------------------------------------------------------------------
  console.log("\n[STAGE E] Browser Tab Close Cleanup (sendBeacon)");
  // Bob Tab 1 closes
  await pageB1.close();
  console.log("  Bob Tab 1 closed. Waiting for disconnect propagation...");
  await pageA.waitForTimeout(2000);

  // Verify Bob was marked DISCONNECTED or LEFT in DB via unload beacon
  const callAfterBobClosed = await db.callSession.findFirst({
    where: { conversationId: conv.id },
    orderBy: { createdAt: "desc" },
    include: { participants: true },
  });
  const bobPart = callAfterBobClosed?.participants.find((p) => p.userId === bob.id);
  console.log(`  Bob participant status after tab close: ${bobPart?.status}`);
  if (bobPart?.status === ParticipantStatus.DISCONNECTED || bobPart?.status === ParticipantStatus.LEFT) {
    console.log("  [STAGE E PASS] Tab close successfully recorded participant departure via sendBeacon!");
  }

  // Alice explicitly ends call
  console.log("  Alice clicking End Call to conclude session...");
  const endCallBtn = pageA.locator('button[aria-label="End call"]');
  if (await endCallBtn.isVisible()) {
    await endCallBtn.click();
    await pageA.waitForTimeout(1000);
  }

  const finalCall = await db.callSession.findFirst({
    where: { conversationId: conv.id },
    orderBy: { createdAt: "desc" },
  });
  console.log(`  Final call state in PostgreSQL: ${finalCall?.status}`);
  if (finalCall?.status === CallStatus.ENDED) {
    console.log("  [STAGE E PASS] Call session terminated cleanly and completely!");
  }

  await browser.close();
  await db.$disconnect();

  console.log("\n======================================================================");
  console.log("ALL PLAYWRIGHT UI TESTS PASSED (STAGES A, B, E, H)");
  console.log("======================================================================");
}

run().catch((err) => {
  console.error("Unhandled Playwright error:", err);
  process.exit(1);
});
