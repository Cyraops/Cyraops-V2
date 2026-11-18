/** Fetch the compiled bot-workspace client chunk from the running dev server. */
import { chromium } from "playwright";

const BASE = "http://127.0.0.1:3003";
const browser = await chromium.launch({ channel: "chrome", headless: true });
try {
  const context = await browser.newContext();
  const page = await context.newPage();
  await page.goto(`${BASE}/login`, { waitUntil: "domcontentloaded" });
  await page.fill('input[name="email"]', "tanveer@cyraops.com");
  await page.fill('input[name="password"]', "CyraOps-dev-2026");
  await Promise.all([page.waitForURL(/dashboard/, { timeout: 30000 }), page.click('button:has-text("Sign in")')]);
  await page.goto(`${BASE}/ai`, { waitUntil: "networkidle", timeout: 60000 });
  const entries = await page.evaluate(() =>
    performance.getEntriesByType("resource").map((e) => e.name)
  );
  let found = null;
  for (const url of entries) {
    if (!url.includes("_next") && !url.includes("chunk") && !url.includes("app")) continue;
    try {
      const res = await page.evaluate(async (u) => (await fetch(u)).text(), url);
      if (res.includes("HarnessToolTimeline")) {
        found = { url, text: res };
        break;
      }
    } catch {
      /* not JS */
    }
  }
  if (!found) {
    console.log("[chunk] HarnessToolTimeline chunk not found among", entries.length, "resources");
    for (const url of entries) if (/bot|workspace|ai\//.test(url)) console.log("  ", url);
  } else {
    const text = found.text;
    const idx = text.indexOf("HarnessToolTimeline");
    console.log("[chunk] url:", found.url, "len:", text.length);
    console.log("[chunk] around render site:\n", text.slice(Math.max(0, idx - 300), idx + 900));
  }
} finally {
  await browser.close();
}
