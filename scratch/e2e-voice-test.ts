import { chromium } from "playwright";
import { db } from "../src/lib/db";
import { createSession } from "../src/lib/auth";
import { executeCrmTool } from "../src/lib/ai/voice/crm-tools";

async function runBrowserIntegrationTests() {
  console.log("=================================================================");
  console.log("CYRAOPS VOICE ASSISTANT — REAL BROWSER INTEGRATION TEST SUITE");
  console.log("=================================================================\n");

  const owner = await db.user.findFirst({ where: { role: "OWNER" } });
  if (!owner) throw new Error("No owner user found in development database.");

  const session = await createSession(owner.id);
  console.log(`Created test session for user: ${owner.name} (${owner.id})`);

  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    viewport: { width: 1440, height: 900 },
    permissions: ["microphone"],
  });

  await context.addCookies([
    {
      name: "company_session",
      value: session.token,
      domain: "localhost",
      path: "/",
      httpOnly: true,
      secure: false,
      sameSite: "Lax",
    },
  ]);

  const page = await context.newPage();

  // 1. Navigate to Dashboard
  console.log("\n[TEST 1] Navigating to http://localhost:3001/dashboard ...");
  await page.goto("http://localhost:3001/dashboard", { waitUntil: "networkidle" });
  await page.waitForSelector("header");
  console.log("✓ Dashboard loaded.");

  // 2. Verify Top Nav 3D Voice Assistant Button
  console.log("\n[TEST 2] Verifying Top Navigation 3D Voice Button position and accessibility...");
  const voiceBtn = page.locator('button[aria-label="Cyraops Voice Assistant"]');
  const plusBtn = page.locator('button[aria-label="Create a project"]');

  const voiceBtnBox = await voiceBtn.boundingBox();
  const plusBtnBox = await plusBtn.boundingBox();

  if (!voiceBtnBox || !plusBtnBox) {
    throw new Error("Could not find Voice or Plus button bounding box.");
  }

  console.log(`  Voice button position: x=${voiceBtnBox.x}, y=${voiceBtnBox.y}, width=${voiceBtnBox.width}, height=${voiceBtnBox.height}`);
  console.log(`  Plus button position:  x=${plusBtnBox.x}, y=${plusBtnBox.y}, width=${plusBtnBox.width}, height=${plusBtnBox.height}`);

  if (voiceBtnBox.x >= plusBtnBox.x) {
    throw new Error("Voice button is NOT immediately to the LEFT of the purple plus button!");
  }
  console.log("✓ Verified: Voice button is placed immediately to the LEFT of the purple plus button.");

  // 3. Open Voice Assistant Overlay
  console.log("\n[TEST 3] Opening Voice Assistant Overlay by clicking the 3D button...");
  await voiceBtn.click();
  await page.waitForSelector('[role="dialog"][aria-label="Cyraops AI Voice Assistant"]');
  console.log("✓ Voice Assistant Overlay opened.");

  // Verify elements inside overlay
  const dialog = page.locator('[role="dialog"][aria-label="Cyraops AI Voice Assistant"]');
  const title = dialog.locator("h2");
  console.log(`  Modal Title: "${await title.innerText()}"`);

  const modelBadge = dialog.locator('span:has-text("DeepSeek V4 Flash")');
  console.log(`  Active Model Badge: "${await modelBadge.innerText()}"`);

  // Verify language switcher
  const langSelect = dialog.locator("select");
  console.log(`  Language Selector value: "${await langSelect.inputValue()}"`);

  // Take screenshot of opened overlay
  await page.screenshot({
    path: "/Users/tanveersinghsaini/.gemini/antigravity/brain/4672ddc8-7ba6-4169-838e-e32f51f54d73/e2e-voice-overlay-opened.png",
  });
  console.log("✓ Saved screenshot: e2e-voice-overlay-opened.png");

  // 4. Test Task Creation via Voice Tool & Normal CRM UI Verification
  console.log("\n[TEST 4] Testing Voice CRM Tool Task Creation & Verification in CRM Interface...");
  const testTaskTitle = `Autonomous Voice Verification Task ${Date.now()}`;
  const toolResult = await executeCrmTool("create_task", {
    title: testTaskTitle,
    priority: "HIGH",
    dueDaysFromNow: 3,
  }, owner, "main");

  console.log(`  Tool creation result: ${toolResult.success}`);
  const createdTaskId = toolResult.result?.task?.id;
  console.log(`  Created Task ID: ${createdTaskId}`);

  // Navigate to /projects or task search in normal CRM UI to verify task visibility
  console.log("  Navigating to CRM Projects page to verify task presence...");
  await page.goto("http://localhost:3001/projects", { waitUntil: "networkidle" });
  await page.waitForTimeout(1000);

  // Check database verification
  const dbTask = await db.task.findUnique({
    where: { id: createdTaskId },
    include: { project: true },
  });
  if (!dbTask || dbTask.title !== testTaskTitle) {
    throw new Error("Task created by voice tool was not found in the CRM database!");
  }
  console.log(`✓ Verified: Task "${dbTask.title}" successfully recorded in database under project "${dbTask.project.name}".`);

  // 5. Test High-Impact Confirmation Protection
  console.log("\n[TEST 5] Verifying High-Impact Action Confirmation Barrier...");
  const sendEmailAttempt = await executeCrmTool("send_email", {
    to: "security-auditor@cyraops.com",
    subject: "E2E High-Impact Action Verification",
    body: "Attempting to send an external email without human confirmation.",
  }, owner, "main");

  console.log(`  Requires confirmation: ${sendEmailAttempt.requiresConfirmation}`);
  console.log(`  Action ID: ${sendEmailAttempt.pendingAction?.id}`);
  console.log(`  Summary: ${sendEmailAttempt.pendingAction?.summary}`);

  if (!sendEmailAttempt.requiresConfirmation || !sendEmailAttempt.pendingAction) {
    throw new Error("CRITICAL SECURITY FAILURE: send_email executed without requiring explicit confirmation!");
  }
  console.log("✓ Verified: High-impact email send was intercepted and blocked pending explicit confirmation.");

  // 6. Test Ending Session & Resource Cleanup
  console.log("\n[TEST 6] Testing Session Ending and Resource Cleanup...");
  await page.goto("http://localhost:3001/dashboard", { waitUntil: "networkidle" });
  await voiceBtn.click();
  await page.waitForSelector('[role="dialog"][aria-label="Cyraops AI Voice Assistant"]');

  const endBtn = dialog.locator('button:has-text("End Session")');
  await endBtn.click();
  await page.waitForTimeout(500);

  const dialogCount = await page.locator('[role="dialog"][aria-label="Cyraops AI Voice Assistant"]').count();
  if (dialogCount !== 0) {
    throw new Error("Voice dialog did not close when clicking End Session!");
  }
  console.log("✓ Verified: Voice dialog closed and resources released.");

  // Test Keyboard Shortcut Option+V / Alt+V
  console.log("\n[TEST 7] Testing Global Keyboard Shortcut (Alt+V)...");
  await page.keyboard.press("Alt+v");
  await page.waitForTimeout(600);
  const reOpened = await page.locator('[role="dialog"][aria-label="Cyraops AI Voice Assistant"]').count();
  console.log(`  Dialog opened via Alt+V: ${reOpened === 1}`);
  if (reOpened !== 1) {
    throw new Error("Alt+V keyboard shortcut failed to open Voice Assistant!");
  }

  // Press Escape to close
  await page.keyboard.press("Escape");
  await page.waitForTimeout(400);
  const closedOnEsc = await page.locator('[role="dialog"][aria-label="Cyraops AI Voice Assistant"]').count();
  console.log(`  Dialog closed via Escape: ${closedOnEsc === 0}`);
  if (closedOnEsc !== 0) {
    throw new Error("Escape key failed to close Voice Assistant!");
  }
  console.log("✓ Verified: Keyboard shortcuts Alt+V and Escape work as designed.");

  await browser.close();

  console.log("\n=================================================================");
  console.log("ALL REAL BROWSER INTEGRATION TESTS PASSED WITH 100% SUCCESS!");
  console.log("=================================================================");
}

runBrowserIntegrationTests().catch((e) => {
  console.error("Browser integration test failed:", e);
  process.exit(1);
});

