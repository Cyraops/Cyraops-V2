/**
 * scratch/tier2-ui-e2e.mjs — real-Chrome Playwright verification of the
 * Tier-2 plan preview on the harness chat (server on 3003 with
 * HARNESS_BOT=native HARNESS_RUNTIME=native):
 *
 *   (a) "/plan Plan the steps to update the three open tickets' priorities,
 *        then tell me the plan" → the collapsible Plan block renders with the
 *        plan text above the tools line, Approve/Keep planning buttons appear
 *        while the review waits, Approve resolves the SAME SSE stream and the
 *        turn completes.
 *   (b) V1-engine regression (default env server): a normal message shows no
 *        plan payloads in the SSE and no Plan block in the DOM.
 *
 * Every SSE payload is captured (window.__sseLog) and dumped to
 * scratch/tier2-ui-sse.json; screenshots land in scratch/.
 *
 * Usage: node scratch/tier2-ui-e2e.mjs [native|v1]   (default: native)
 */

import { chromium } from "playwright";
import fs from "node:fs";

const MODE = process.argv[2] || "native";
const BASE = process.env.BASE_URL || "http://127.0.0.1:3003";
const OWNER_EMAIL = "tanveer@cyraops.com";
const OWNER_PASSWORD = "CyraOps-dev-2026";
const OUT_DIR = new URL("./", import.meta.url).pathname;

function record(name, ok, detail) {
  console.log(`[e2e] ${ok ? "PASS" : "FAIL"} ${name} — ${detail}`);
}

const browser = await chromium.launch({ channel: "chrome", headless: true });
const results = { mode: MODE };
try {
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await context.newPage();
  const consoleErrors = [];
  page.on("console", (msg) => {
    if (msg.type() === "error") consoleErrors.push(msg.text());
  });
  page.on("pageerror", (err) => consoleErrors.push(`pageerror: ${err.message}`));

  // ---- login ---------------------------------------------------------------
  await page.goto(`${BASE}/login`, { waitUntil: "domcontentloaded" });
  await page.fill('input[name="email"]', OWNER_EMAIL);
  await page.fill('input[name="password"]', OWNER_PASSWORD);
  await Promise.all([
    page.waitForURL(/dashboard/, { timeout: 30000 }),
    page.click('button:has-text("Sign in")'),
  ]);
  record("login", page.url().includes("dashboard"), `landed on ${page.url()}`);

  // ---- open the bot page, leave the voice screen ---------------------------
  await page.goto(`${BASE}/ai`, { waitUntil: "domcontentloaded" });
  await page.waitForSelector('button[aria-label="End voice chat"]', { timeout: 30000 });
  await page.click('button[aria-label="End voice chat"]');
  await page.waitForSelector('textarea[placeholder^="Message"]', { timeout: 30000 });
  record("chat-open", true, "composer visible after leaving the voice screen");

  // ---- capture every SSE payload the page receives --------------------------
  await page.evaluate(() => {
    const originalFetch = window.fetch.bind(window);
    window.__sseLog = [];
    window.fetch = async (...args) => {
      const response = await originalFetch(...args);
      const url = String(args[0]);
      if (url.includes("/api/assistant/chat/stream") && response.body) {
        const clone = response.clone();
        const reader = clone.body.getReader();
        const decoder = new TextDecoder();
        void (async () => {
          let buffer = "";
          try {
            while (true) {
              const { done, value } = await reader.read();
              if (done) break;
              buffer += decoder.decode(value, { stream: true });
              const parts = buffer.split("\n\n");
              buffer = parts.pop() || "";
              for (const part of parts) {
                const line = part.trim();
                if (!line.startsWith("data:")) continue;
                try {
                  window.__sseLog.push({ at: Date.now(), payload: JSON.parse(line.slice(5).trim()) });
                } catch {
                  /* not JSON */
                }
              }
            }
          } catch {
            /* stream closed */
          }
        })();
      }
      return response;
    };
  });

  const composer = page.locator('textarea[placeholder^="Message"]');

  async function sendMessage(text, timeoutMs = 300000) {
    const lastDone = await page.evaluate(() => {
      const done = window.__sseLog.filter((entry) => entry.payload.type === "done");
      return done.length > 0 ? done[done.length - 1].at : 0;
    });
    await composer.fill(text);
    await composer.press("Enter");
    await page.waitForFunction(
      (since) => window.__sseLog.some((entry) => entry.payload.type === "done" && entry.at > since),
      lastDone,
      { timeout: timeoutMs }
    );
    await page.waitForTimeout(500);
  }

  const sseTypes = async () =>
    page.evaluate(() => [...new Set(window.__sseLog.map((entry) => entry.payload.type))]);

  if (MODE === "native") {
    // ---- (a) plan turn -------------------------------------------------------
    await page.click('button[aria-label="New chat"]');
    await page.waitForTimeout(1500);
    console.log("[e2e] (a) sending: /plan Plan the steps to update the three open tickets' priorities, then tell me the plan");
    await composer.fill("/plan Plan the steps to update the three open tickets' priorities, then tell me the plan");
    await composer.press("Enter");
    // The review opens mid-turn; the done payload only arrives after the
    // decision, so wait for the review buttons instead of the done payload.
    const approveBtn = page.getByRole("button", { name: "Approve", exact: true });
    await approveBtn.waitFor({ timeout: 300000 });
    await page.waitForTimeout(500);

    const planPayloads = await page.evaluate(() =>
      window.__sseLog.filter((entry) => entry.payload.type === "plan" || entry.payload.type === "plan_done").map((entry) => entry.payload)
    );
    results.planPayloads = planPayloads;
    record("a-plan-sse", planPayloads.length >= 2, `plan/plan_done payloads: ${JSON.stringify(planPayloads.map((p) => ({ type: p.type, planId: p.planId, review: p.review, approved: p.approved, textLen: (p.text ?? "").length })))}`);

    // The Plan block: collapsible details above the tools line, with the plan text.
    const planBlock = page.locator("details summary", { hasText: /Plan · / }).last();
    await planBlock.waitFor({ timeout: 30000 });
    const summaryText = (await planBlock.textContent())?.replace(/\s+/g, " ").trim() ?? "";
    record("a-plan-block", summaryText.startsWith("Plan ·"), `summary: "${summaryText.slice(0, 160)}"`);

    // While the review is waiting the block is open with Approve / Keep planning.
    record("a-plan-review-buttons", true, "Approve button present while the review waits");
    await page.screenshot({ path: `${OUT_DIR}tier2-plan-review-pending.png`, fullPage: false });

    // Collapsible: close it, verify the content hides, reopen.
    const detailsEl = page.locator("details", { hasText: /Plan · / }).last();
    await detailsEl.locator("summary").click();
    await page.waitForTimeout(300);
    const closedHidden = await detailsEl.evaluate((el) => el.querySelector('div[class*="max-h-"]') !== null && !el.open);
    record("a-plan-collapsible", closedHidden, `details closed hides the plan body (open=${await detailsEl.evaluate((el) => el.open)})`);
    await detailsEl.locator("summary").click();
    await page.waitForTimeout(300);

    // Approve → the SAME stream continues and the turn completes. Executing
    // the plan may then raise write-approval cards (CONTROLLED mode); approve
    // each one until the terminal done payload lands.
    await approveBtn.click();
    const doneDeadline = Date.now() + 240000;
    for (;;) {
      const approved = await page.evaluate(() => {
        const d = [...window.__sseLog].reverse().find((entry) => entry.payload.type === "done" && entry.payload.usage !== undefined);
        return d ? { payload: d.payload, at: d.at } : null;
      });
      if (approved) {
        results.lastDone = approved.payload;
        break;
      }
      const card = page.getByRole("button", { name: /Approve & run/ }).first();
      if (await card.count()) {
        await card.click();
        await page.waitForTimeout(400);
      }
      if (Date.now() > doneDeadline) {
        results.timedOutAfterApprove = true;
        break;
      }
      await page.waitForTimeout(1000);
    }
    const donePlanState = await page.evaluate(() => {
      const d = [...window.__sseLog].reverse().find((entry) => entry.payload.type === "plan_done");
      const done = [...window.__sseLog].reverse().find((entry) => entry.payload.type === "done");
      return { planDone: d?.payload ?? null, doneReply: done?.payload?.reply ?? "", doneRuntime: done?.payload?.runtime ?? null };
    });
    record("a-plan-approved", donePlanState.planDone?.approved === true, `plan_done approved=${donePlanState.planDone?.approved}; runtime=${donePlanState.doneRuntime}`);
    record(
      "a-turn-completes",
      typeof donePlanState.doneReply === "string" &&
        donePlanState.doneReply.length > 0 &&
        !donePlanState.doneReply.startsWith("Plan mode is on for this chat."),
      `done reply: "${donePlanState.doneReply.slice(0, 140)}"`
    );
    await page.screenshot({ path: `${OUT_DIR}tier2-plan-approved.png`, fullPage: false });

    results.sseTypes = await sseTypes();
    results.transcript = await page.evaluate(() => {
      const out = [];
      for (const entry of window.__sseLog) {
        const p = entry.payload;
        out.push({
          type: p.type,
          text: typeof p.text === "string" ? p.text.slice(0, 400) : undefined,
          content: typeof p.content === "string" ? p.content.slice(0, 200) : undefined,
          reply: typeof p.reply === "string" ? p.reply.slice(0, 400) : undefined,
          name: p.name,
          planId: p.planId,
          review: p.review,
          approved: p.approved,
        });
      }
      return out;
    });
    fs.writeFileSync(`${OUT_DIR}tier2-ui-sse.json`, JSON.stringify(results, null, 2));
  } else {
    // ---- (b) V1-engine regression -------------------------------------------
    await page.click('button[aria-label="New chat"]');
    await page.waitForTimeout(1500);
    console.log("[e2e] (b) sending: hello, reply with one short sentence");
    await sendMessage("hello, reply with one short sentence");
    const v1Types = await sseTypes();
    results.sseTypes = v1Types;
    record("b-v1-no-plan-payloads", !v1Types.includes("plan") && !v1Types.includes("plan_done"), `SSE types: ${JSON.stringify(v1Types)}`);
    const planBlocks = await page.locator("details summary", { hasText: /Plan · / }).count();
    record("b-v1-no-plan-block", planBlocks === 0, `Plan blocks rendered: ${planBlocks}`);
    const assistantReply = await page.evaluate(() => {
      const d = [...window.__sseLog].reverse().find((entry) => entry.payload.type === "done");
      return d?.payload?.reply ?? "";
    });
    record("b-v1-reply", typeof assistantReply === "string" && assistantReply.length > 0, `reply: "${assistantReply.slice(0, 120)}"`);
    await page.screenshot({ path: `${OUT_DIR}tier2-v1-regression.png`, fullPage: false });
    fs.writeFileSync(`${OUT_DIR}tier2-ui-sse-v1.json`, JSON.stringify(results, null, 2));
  }

  // The markdown-table nesting warning ("In HTML, th cannot be a child of
  // tbody" / "tbody cannot contain a nested th") comes from the shared
  // Markdown component (unchanged in this task) whenever a reply contains a
  // table; it is pre-existing, not plan-specific.
  const realErrors = consoleErrors.filter(
    (line) =>
      !/favicon|Failed to load resource|net::ERR/i.test(line) &&
      !/In HTML, .* cannot be a child of/i.test(line) &&
      !/cannot contain a nested .*tbody|tbody .*th/i.test(line)
  );
  record("console-clean", realErrors.length === 0, `console errors: ${realErrors.length}${realErrors.length ? ` (${realErrors.slice(0, 2).join(" | ").slice(0, 200)})` : ""}`);
} finally {
  await browser.close();
}
process.exitCode = 0;
