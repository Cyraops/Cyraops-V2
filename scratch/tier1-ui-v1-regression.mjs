/**
 * scratch/tier1-ui-v1-regression.mjs — real-Chrome Playwright check that a
 * plain V1-engine turn (DEFAULT env, HARNESS_BOT unset) shows NO new UI
 * captions: no usage caption, no harness tools line. The pre-existing V1
 * behavior (reply, optional ToolActivity) stays intact.
 */

import { chromium } from "playwright";

const BASE = process.env.BASE_URL || "http://127.0.0.1:3003";
const OWNER_EMAIL = "tanveer@cyraops.com";
const OWNER_PASSWORD = "CyraOps-dev-2026";

const browser = await chromium.launch({ channel: "chrome", headless: true });
try {
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await context.newPage();
  const consoleErrors = [];
  page.on("console", (msg) => {
    if (msg.type() === "error") consoleErrors.push(msg.text());
  });

  await page.goto(`${BASE}/login`, { waitUntil: "domcontentloaded" });
  await page.fill('input[name="email"]', OWNER_EMAIL);
  await page.fill('input[name="password"]', OWNER_PASSWORD);
  await Promise.all([
    page.waitForURL(/dashboard/, { timeout: 30000 }),
    page.click('button:has-text("Sign in")'),
  ]);
  console.log("[v1] PASS login");

  await page.goto(`${BASE}/ai`, { waitUntil: "domcontentloaded" });
  await page.waitForSelector('button[aria-label="End voice chat"]', { timeout: 30000 });
  await page.click('button[aria-label="End voice chat"]');
  await page.waitForSelector('textarea[placeholder^="Message"]', { timeout: 30000 });

  await page.click('button[aria-label="New chat"]');
  await page.waitForTimeout(1500);

  const composer = page.locator('textarea[placeholder^="Message"]');
  await composer.fill("Say hello in one short sentence.");
  await composer.press("Enter");

  // wait for the turn to finish (Send button returns)
  await page.waitForSelector('button[aria-label="Send"]', { timeout: 240000 });
  await page.waitForTimeout(1500);

  const usageCaptions = await page.locator("p", { hasText: /tokens · \$/ }).count();
  const harnessToolsLines = await page.locator("details summary", { hasText: /tool/ }).count();
  const transcript = await page.evaluate(() => {
    const container = document.querySelector(".soft-scrollbar");
    return container ? container.textContent.replace(/\s+/g, " ").trim() : "";
  });
  const replied = transcript.length > 20;

  console.log(`[v1] ${replied ? "PASS" : "FAIL"} reply-arrived — transcript: "${transcript.slice(0, 160)}"`);
  console.log(`[v1] ${usageCaptions === 0 ? "PASS" : "FAIL"} no-usage-caption — captions found: ${usageCaptions}`);
  console.log(`[v1] ${harnessToolsLines === 0 ? "PASS" : "FAIL"} no-harness-tools-line — lines found: ${harnessToolsLines}`);
  console.log("[v1] console errors:", JSON.stringify(consoleErrors.slice(0, 5)));
  await page.screenshot({ path: `${new URL("./", import.meta.url).pathname}tier1-c-v1-default.png`, fullPage: false });
} finally {
  await browser.close();
}
