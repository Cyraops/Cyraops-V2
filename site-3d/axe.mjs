import { chromium } from "playwright";
const browser = await chromium.launch();
const out = {};
for (const [name, viewport] of [["home-d", { width: 1440, height: 900 }], ["detail-d", { width: 1440, height: 900 }], ["home-m", { width: 390, height: 844 }]]) {
  const page = await browser.newPage({ viewport, isMobile: name.endsWith("-m") });
  await page.goto(name.startsWith("detail") ? "http://127.0.0.1:3100/#/solutions/assistant-workspace" : "http://127.0.0.1:3100/", { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(1500);
  try {
    await page.addScriptTag({ url: "https://cdn.jsdelivr.net/npm/axe-core@4.10.2/axe.min.js" });
    const res = await page.evaluate(async () => {
      const r = await window.axe.run(document, { runOnly: { type: "tag", values: ["wcag2a", "wcag2aa"] } });
      return r.violations.map((v) => ({ id: v.id, impact: v.impact, nodes: v.nodes.length, help: v.help }));
    });
    out[name] = res;
  } catch (e) { out[name] = [{ id: "axe-load-failed", impact: null, nodes: 0, help: String(e).slice(0, 120) }]; }
  await page.close();
}
await browser.close();
console.log(JSON.stringify(out, null, 2));
