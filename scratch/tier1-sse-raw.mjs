/**
 * scratch/tier1-sse-raw.mjs — capture the RAW SSE of one harness turn against
 * the running dev server (HARNESS_BOT=native), without the UI, and ANSWER any
 * question that streams (proving the full /api/harness/answer loop). Used to
 * isolate whether { type: "question" } payloads stream at all.
 */

import { chromium } from "playwright";

const BASE = process.env.BASE_URL || "http://127.0.0.1:3003";
const OWNER_EMAIL = "tanveer@cyraops.com";
const OWNER_PASSWORD = "CyraOps-dev-2026";
const ANSWER = process.env.ANSWER || "seed-task-billing";
const PROMPT = process.argv[2] || "Use the ask_user tool to ask me which ticket to update, then report my answer.";

const browser = await chromium.launch({ channel: "chrome", headless: true });
try {
  const context = await browser.newContext();
  const page = await context.newPage();
  await page.goto(`${BASE}/login`, { waitUntil: "domcontentloaded" });
  await page.fill('input[name="email"]', OWNER_EMAIL);
  await page.fill('input[name="password"]', OWNER_PASSWORD);
  await Promise.all([
    page.waitForURL(/dashboard/, { timeout: 30000 }),
    page.click('button:has-text("Sign in")'),
  ]);
  const cookies = await context.cookies();
  const cookieHeader = cookies.map((c) => `${c.name}=${c.value}`).join("; ");

  const response = await fetch(`${BASE}/api/assistant/chat/stream`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Origin: BASE,
      Cookie: cookieHeader,
    },
    body: JSON.stringify({ content: PROMPT }),
  });
  console.log("[sse] status:", response.status);
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let answered = false;
  const payloads = [];
  const started = Date.now();
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const parts = buffer.split("\n\n");
    buffer = parts.pop() || "";
    for (const part of parts) {
      const line = part.trim();
      if (!line.startsWith("data:")) continue;
      let payload;
      try {
        payload = JSON.parse(line.slice(5).trim());
      } catch {
        continue;
      }
      payloads.push(payload);
      if (payload.type === "token" || payload.type === "text") continue;
      console.log(`[sse +${((Date.now() - started) / 1000).toFixed(1)}s]`, JSON.stringify(payload).slice(0, 500));
      if (payload.type === "question" && !answered) {
        answered = true;
        console.log(`[sse] answering "${ANSWER}" via /api/harness/answer`);
        const answerResponse = await fetch(`${BASE}/api/harness/answer`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Origin: BASE,
            Cookie: cookieHeader,
          },
          body: JSON.stringify({ questionId: payload.questionId, answer: ANSWER }),
        });
        console.log("[sse] answer status:", answerResponse.status, JSON.stringify(await answerResponse.json().catch(() => ({}))));
      }
    }
  }
  console.log("[sse] question payload present:", payloads.some((p) => p.type === "question"));
  console.log("[sse] payload type counts:", payloads.reduce((acc, p) => {
    acc[p.type] = (acc[p.type] ?? 0) + 1;
    return acc;
  }, {}));
  const donePayload = payloads.find((p) => p.type === "done");
  console.log("[sse] done payload:", JSON.stringify(donePayload, null, 2)?.slice(0, 800));
} finally {
  await browser.close();
}
