import { chromium } from "playwright";
const b = await chromium.launch();
const p = await b.newPage({ viewport: { width: 1440, height: 900 } });
const go = async (h) => { await p.goto("http://127.0.0.1:3100/#"+h, { waitUntil: "domcontentloaded" }); await p.waitForTimeout(600); };

await go("/");
const navLabels = await p.$$eval(".nav-links .nav-link", els => els.map(e => e.textContent.trim().replace(/\s*$/,"")));
console.log("nav (top-level):", navLabels.join(" | "));

await go("/catalogue");
console.log("catalogue: filter =", await p.locator(".cat-filter").count(), "| selective flags =", await p.locator(".cat-flag").count(), "| jump anchors =", await p.locator(".subnav a").count());

await go("/about/how");
const subnav = await p.$$eval(".subnav a, .subnav-current", els => els.map(e => e.textContent.trim() + (e.className.includes("current") ? "[current]" : "")));
console.log("about subnav:", subnav.join(" | "));

// footer: Solutions column should list all 10, no duplicate About/Company
const footerSol = await p.$$eval(".footer-col", cols => cols.map(c => c.querySelector("h4")?.textContent + ":" + c.querySelectorAll("a").length).join("  "));
console.log("footer columns (label:links):", footerSol);

await go("/solutions");
console.log("axis page h1:", await p.locator("h1").first().textContent());

await b.close();
