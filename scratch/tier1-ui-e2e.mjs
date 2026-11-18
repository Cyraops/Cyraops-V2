/**
 * scratch/tier1-ui-e2e.mjs — real-Chrome Playwright verification of the three
 * Tier-1 UI gaps on the harness chat (server must run with HARNESS_BOT=native
 * HARNESS_RUNTIME=native on 3003):
 *
 *   (a) "list the open tickets" → the collapsible tools line (cyraops_list_tickets,
 *       per-tool statuses on expand) and the muted usage caption.
 *   (b) "Use the ask_user tool to ask me which ticket to update, then report my
 *       answer." → the inline question card appears; typing an answer resumes
 *       the SAME SSE stream and the reply reflects the answer.
 *
 * Every SSE payload the page receives is captured (window.__sseLog via a fetch
 * patch) and dumped to scratch/tier1-ui-sse.json for the report. Transcript
 * evidence and screenshots land in scratch/.
 *
 * Usage (dev server on 3003, default env):
 *   node scratch/tier1-ui-e2e.mjs
 */

import { chromium } from "playwright";
import fs from "node:fs";

const BASE = process.env.BASE_URL || "http://127.0.0.1:3003";
const OWNER_EMAIL = "tanveer@cyraops.com";
const OWNER_PASSWORD = "CyraOps-dev-2026";
const OUT_DIR = new URL("./", import.meta.url).pathname;
const sseLogs = [];
const transcript = [];

function record(name, ok, detail) {
  console.log(`[e2e] ${ok ? "PASS" : "FAIL"} ${name} — ${detail}`);
}

const browser = await chromium.launch({ channel: "chrome", headless: true });
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

  async function sendMessage(text) {
    const lastDone = await page.evaluate(() => {
      const done = window.__sseLog.filter((entry) => entry.payload.type === "done");
      return done.length > 0 ? done[done.length - 1].at : 0;
    });
    await composer.fill(text);
    await composer.press("Enter");
    await page.waitForFunction(
      (since) => window.__sseLog.some((entry) => entry.payload.type === "done" && entry.at > since),
      lastDone,
      { timeout: 240000 }
    );
    await page.waitForSelector('button[aria-label="Send"]', { timeout: 60000 });
  }

  // ---- (a) tools line + usage caption ----------------------------------------
  await page.click('button[aria-label="New chat"]');
  await page.waitForTimeout(1500);
  console.log("[e2e] (a) asking: list the open tickets");
  await sendMessage("list the open tickets");

  const toolsLine = page.locator("details summary", { hasText: /tool/ }).last();
  await toolsLine.waitFor({ timeout: 30000 });
  const toolsText = (await toolsLine.textContent())?.replace(/\s+/g, " ").trim() ?? "";
  const toolsOk = toolsText.includes("cyraops_list_tickets");
  record("a-tools-line", toolsOk, `collapsed summary: "${toolsText}"`);

  // expand: per-tool rows with statuses + truncated results
  await toolsLine.click();
  await page.waitForSelector("details[open]", { timeout: 10000 });
  const expanded = await page.evaluate(() => {
    const details = [...document.querySelectorAll("details[open]")].at(-1);
    return details ? details.textContent.replace(/\s+/g, " ").trim() : "";
  });
  const expandedOk = expanded.includes("cyraops_list_tickets") && /completed|error/.test(expanded);
  record("a-tools-expand", expandedOk, `expanded rows: "${expanded.slice(0, 220)}"`);
  await page.screenshot({ path: `${OUT_DIR}tier1-a-tools-expanded.png`, fullPage: false });

  // collapse again
  await page.locator("details[open] summary", { hasText: /tool/ }).last().click();
  const stillOpen = await page.locator("details[open]", { hasText: /tool/ }).count();
  record("a-tools-collapse", stillOpen === 0, `details[open] with tools line after collapse: ${stillOpen}`);

  // usage caption under the assistant message
  const caption = page.locator("p", { hasText: /tokens · \$/ }).last();
  await caption.waitFor({ timeout: 30000 });
  const captionText = (await caption.textContent())?.trim() ?? "";
  record("a-usage-caption", /^[\d.]+k? tokens · \$/.test(captionText), `caption: "${captionText}"`);
  await page.screenshot({ path: `${OUT_DIR}tier1-a-usage.png`, fullPage: false });

  // ---- (b) ask-user inline question -----------------------------------------
  await page.click('button[aria-label="New chat"]');
  await page.waitForTimeout(1500);
  console.log("[e2e] (b) asking: use the ask_user tool …");
  // The question card is TRANSIENT: it appears mid-turn and is cleared when the
  // done payload lands, so the answer must be typed while the turn is open.
  await composer.fill("Use the ask_user tool to ask me which ticket to update, then report my answer.");
  await composer.press("Enter");

  const questionInput = page.locator('input[placeholder="Type your answer…"]');
  await questionInput.waitFor({ timeout: 240000 });
  const questionText = await page.evaluate(() => {
    const box = document.querySelector('input[placeholder="Type your answer…"]')?.closest("div.cy-rise");
    return box ? box.textContent.replace(/\s+/g, " ").trim() : "";
  });
  record("b-question-card", questionText.length > 0, `inline question: "${questionText.slice(0, 160)}"`);
  await page.screenshot({ path: `${OUT_DIR}tier1-b-question.png`, fullPage: false });

  await questionInput.fill("seed-task-billing");
  await page.click('button:has-text("Answer")');
  record("b-answer-posted", true, "typed seed-task-billing and clicked Answer");

  // The same SSE stream resumes: the turn finishes with the reply reflecting
  // the answer.
  await page.waitForSelector('button[aria-label="Send"]', { timeout: 240000 });
  await page.waitForTimeout(1200);

  const transcriptText = await page.evaluate(() => {
    const container = document.querySelector(".soft-scrollbar");
    return container ? container.textContent.replace(/\s+/g, " ").trim() : "";
  });
  const reflects = /seed-task-billing/.test(transcriptText);
  record("b-reply-reflects", reflects, `final reply mentions the answer${reflects ? "" : `; transcript: "${transcriptText.slice(0, 300)}"`}`);
  await page.screenshot({ path: `${OUT_DIR}tier1-b-final.png`, fullPage: false });

  // collect evidence
  const payloads = await page.evaluate(() => window.__sseLog.map((entry) => entry.payload));
  sseLogs.push(...payloads);
  transcript.push({
    phase: "a+b",
    text: transcriptText,
  });

  const questionPayloads = payloads.filter((p) => p.type === "question" || p.type === "question_done");
  console.log("[e2e] question payloads:", JSON.stringify(questionPayloads, null, 2));
  const donePayloads = payloads.filter((p) => p.type === "done");
  console.log("[e2e] done payloads:", JSON.stringify(donePayloads.map((p) => ({ usage: p.usage, toolCallsUsed: p.toolCallsUsed, runtime: p.runtime })), null, 2));
  const toolPayloads = payloads.filter((p) => p.type === "tool" || p.type === "tool_done");
  console.log("[e2e] tool payloads (first 6):", JSON.stringify(toolPayloads.slice(0, 6), null, 2));

  record("b-question-sse", questionPayloads.some((p) => p.type === "question"), "question SSE observed");
  record("a-done-usage-sse", donePayloads.some((p) => p.usage), "done payload carried usage");
  record("a-done-tools-sse", donePayloads.some((p) => Array.isArray(p.toolCallsUsed) && p.toolCallsUsed.length > 0), "done payload carried toolCallsUsed");

  console.log("[e2e] console errors:", JSON.stringify(consoleErrors.slice(0, 10)));
  fs.writeFileSync(`${OUT_DIR}tier1-ui-sse.json`, JSON.stringify(payloads, null, 2));
  fs.writeFileSync(`${OUT_DIR}tier1-ui-transcript.json`, JSON.stringify(transcript, null, 2));
  console.log("[e2e] evidence written to scratch/tier1-ui-sse.json + scratch/tier1-ui-transcript.json");
} catch (error) {
  console.error("[e2e] FAILED:", error?.message);
  try {
    const payloads = await page.evaluate(() => window.__sseLog?.map((entry) => entry.payload) ?? []);
    const transcriptText = await page.evaluate(() => {
      const container = document.querySelector(".soft-scrollbar");
      return container ? container.textContent.replace(/\s+/g, " ").trim() : "";
    });
    fs.writeFileSync(`${OUT_DIR}tier1-ui-sse.json`, JSON.stringify(payloads, null, 2));
    fs.writeFileSync(`${OUT_DIR}tier1-ui-transcript.json`, JSON.stringify({ text: transcriptText }, null, 2));
    await page.screenshot({ path: `${OUT_DIR}tier1-ui-failure.png`, fullPage: false });
    console.log("[e2e] failure evidence dumped");
  } catch {
    console.log("[e2e] could not dump failure evidence");
  }
} finally {
  await browser.close();
}
