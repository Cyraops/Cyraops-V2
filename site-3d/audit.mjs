// Production-readiness crawl: every route, every link, every viewport.
import { chromium } from "playwright";
import fs from "node:fs";

const BASE = "http://127.0.0.1:3100";
const catalog = JSON.parse(fs.readFileSync("src/data/catalog.json", "utf8"));
const slug = (v) => v.toLowerCase().replace(/&/g, "and").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");

const routes = new Set(["/", "/catalogue", "/contact", "/about", "/about/how", "/about/engagement", "/about/faq"]);
for (const axis of catalog.axes) {
  routes.add(`/${axis.axis}`);
  for (const item of axis.items) routes.add(`/${axis.axis}/${slug(item.name)}`);
}

const browser = await chromium.launch();
const problems = [];
const seenLinks = new Set();
const titles = new Map();

const viewports = [
  { name: "desktop", width: 1440, height: 900 },
  { name: "mobile", width: 390, height: 844 },
];

for (const vp of viewports) {
  const page = await browser.newPage({ viewport: { width: vp.width, height: vp.height }, isMobile: vp.name === "mobile", hasTouch: vp.name === "mobile" });
  const consoleErrors = [];
  page.on("console", (m) => { if (m.type() === "error") consoleErrors.push(m.text().slice(0, 160)); });
  page.on("pageerror", (e) => consoleErrors.push("PAGEERROR " + String(e).slice(0, 160)));
  page.on("requestfailed", (r) => consoleErrors.push("REQFAIL " + r.url().slice(0, 120)));

  for (const route of routes) {
    consoleErrors.length = 0;
    await page.goto(`${BASE}/#${route}`, { waitUntil: "domcontentloaded", timeout: 20000 }).catch(() => {});
    await page.waitForTimeout(180);

    const info = await page.evaluate(() => {
      const doc = document.documentElement;
      const overflow = doc.scrollWidth - window.innerWidth;
      const wide = [...document.querySelectorAll("body *")]
        .filter((el) => {
          const r = el.getBoundingClientRect();
          return r.width > 0 && r.right > window.innerWidth + 2 && getComputedStyle(el).position !== "fixed";
        })
        .slice(0, 3)
        .map((el) => `${el.tagName.toLowerCase()}.${(el.className || "").toString().split(" ")[0]}`);
      return {
        title: document.title,
        h1: [...document.querySelectorAll("h1")].map((h) => h.textContent.trim().slice(0, 70)),
        h2count: document.querySelectorAll("h2").length,
        overflow,
        wide,
        imgsBroken: [...document.images].filter((i) => !i.complete || i.naturalWidth === 0).length,
        emptyAnchors: [...document.querySelectorAll("a")].filter((a) => !a.textContent.trim() && !a.getAttribute("aria-label")).length,
        links: [...document.querySelectorAll('a[href^="#/"]')].map((a) => a.getAttribute("href").slice(1)),
        buttons: [...document.querySelectorAll("button")].filter((b) => !b.textContent.trim() && !b.getAttribute("aria-label")).length,
      };
    });

    if (consoleErrors.length) problems.push({ vp: vp.name, route, kind: "console", detail: [...new Set(consoleErrors)].slice(0, 3) });
    if (info.overflow > 2) problems.push({ vp: vp.name, route, kind: "overflow", detail: `${info.overflow}px, culprits: ${info.wide.join(", ")}` });
    if (info.h1.length !== 1) problems.push({ vp: vp.name, route, kind: "h1", detail: `found ${info.h1.length}: ${JSON.stringify(info.h1)}` });
    if (info.imgsBroken) problems.push({ vp: vp.name, route, kind: "images", detail: info.imgsBroken });
    if (info.emptyAnchors || info.buttons) problems.push({ vp: vp.name, route, kind: "unlabelled", detail: `anchors ${info.emptyAnchors}, buttons ${info.buttons}` });
    if (!info.title || info.title.trim().length < 5) problems.push({ vp: vp.name, route, kind: "title", detail: info.title });

    titles.set(route, info.title);
    for (const link of info.links) seenLinks.add(link);
  }
  await page.close();
}

// Every internal link must resolve to a route we actually render.
const missing = [...seenLinks].filter((l) => !routes.has(l.split("?")[0]));

// Keyboard: open the first menu by keyboard, confirm Escape closes it.
const kb = await browser.newPage({ viewport: { width: 1440, height: 900 } });
await kb.goto(BASE, { waitUntil: "domcontentloaded" });
for (let i = 0; i < 9; i += 1) {
  await kb.keyboard.press("Tab");
  const tag = await kb.evaluate(() => (document.activeElement) ? document.activeElement.className : "");
  if (String(tag).includes("nav-link")) break;
}
await kb.keyboard.press("Enter");
await kb.waitForTimeout(400);
const opened = await kb.locator(".mega").count();
await kb.keyboard.press("Escape");
await kb.waitForTimeout(300);
const closed = await kb.locator(".mega").count();
if (opened !== 1) problems.push({ vp: "desktop", route: "/", kind: "keyboard", detail: "Enter did not open the mega menu" });
if (closed !== 0) problems.push({ vp: "desktop", route: "/", kind: "keyboard", detail: "Escape did not close the mega menu" });
await kb.close();
await browser.close();

console.log(`routes: ${routes.size} | viewports: ${viewports.length} | links seen: ${seenLinks.size}`);
console.log(`missing link targets: ${missing.length}`);
missing.slice(0, 20).forEach((m) => console.log("  MISSING", m));
const byKind = {};
for (const p of problems) byKind[p.kind] = (byKind[p.kind] ?? 0) + 1;
console.log("problems by kind:", JSON.stringify(byKind));
for (const p of problems.slice(0, 40)) console.log(`  [${p.kind}] ${p.vp} ${p.route} :: ${JSON.stringify(p.detail)}`);
fs.writeFileSync("/tmp/audit.json", JSON.stringify({ problems, missing, titles: [...titles] }, null, 2));
