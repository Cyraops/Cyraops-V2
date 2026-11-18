/** Full-structure dump of the last assistant message after a harness turn. */
import { chromium } from "playwright";
import fs from "node:fs";

const BASE = "http://127.0.0.1:3003";
const OUT = `${new URL("./", import.meta.url).pathname}tier1-dom-dump-full.html`;

const browser = await chromium.launch({ channel: "chrome", headless: true });
try {
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await context.newPage();
  await page.goto(`${BASE}/login`, { waitUntil: "domcontentloaded" });
  await page.fill('input[name="email"]', "tanveer@cyraops.com");
  await page.fill('input[name="password"]', "CyraOps-dev-2026");
  await Promise.all([page.waitForURL(/dashboard/, { timeout: 30000 }), page.click('button:has-text("Sign in")')]);
  await page.goto(`${BASE}/ai`, { waitUntil: "domcontentloaded" });
  await page.waitForSelector('button[aria-label="End voice chat"]', { timeout: 30000 });
  await page.click('button[aria-label="End voice chat"]');
  await page.waitForSelector('textarea[placeholder^="Message"]', { timeout: 30000 });
  await page.click('button[aria-label="New chat"]');
  await page.waitForTimeout(1500);
  const composer = page.locator('textarea[placeholder^="Message"]');
  await composer.fill("list the open tickets");
  await composer.press("Enter");
  await page.waitForSelector('button[aria-label="Send"]', { timeout: 240000 });
  await page.waitForTimeout(1500);

  const info = await page.evaluate(() => {
    const container = [...document.querySelectorAll("div")].find(
      (el) => el.classList.contains("soft-scrollbar") && !el.getAttribute("role")
    );
    const rows = [...(container?.querySelectorAll(".cy-rise") ?? [])].map((el) => el.parentElement).filter(Boolean);
    const result = [];
    for (const row of rows) {
      const details = [...row.querySelectorAll("details")];
      result.push({
        details: details.length,
        summaries: details.map((d) => d.querySelector("summary")?.textContent?.replace(/\s+/g, " ").trim()),
        // which element is the parent of each details?
        parents: details.map((d) => ({
          parentClass: d.parentElement?.className ?? "",
          insideMinW0: Boolean(d.closest(".min-w-0")),
        })),
      });
    }
    return {
      result,
      lastRowHtml: rows.length ? rows[rows.length - 1].outerHTML : "(no rows)",
    };
  });
  console.log("[dom] per-row details:", JSON.stringify(info.result, null, 2));
  fs.writeFileSync(OUT, info.lastRowHtml);
  console.log("[dom] full last-row html written to", OUT, "len", info.lastRowHtml.length);
} finally {
  await browser.close();
}
