import { chromium } from "playwright";

const BASE = "http://127.0.0.1:3100";
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
const errors = [];
page.on("pageerror", (e) => errors.push("PAGEERROR " + String(e).slice(0,200)));
page.on("console", (m) => { if (m.type() === "error") errors.push("CONSOLE " + m.text().slice(0,200)); });

// HOME
await page.goto(BASE + "/#/", { waitUntil: "domcontentloaded" });
await page.waitForTimeout(1200);

const home = await page.evaluate(() => {
  const q = (s) => document.querySelector(s);
  const rect = (s) => { const el = q(s); if (!el) return null; const r = el.getBoundingClientRect(); return { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height), right: Math.round(r.right) }; };
  const hero = q(".hero");
  const heroR = hero ? hero.getBoundingClientRect() : null;
  const metaRows = [...document.querySelectorAll(".hero-meta-row")].map(el => { const r = el.getBoundingClientRect(); return { w: Math.round(r.width), h: Math.round(r.height), x: Math.round(r.x), text: el.textContent.trim().slice(0,30) }; });
  return {
    docScrollW: document.documentElement.scrollWidth,
    innerW: window.innerWidth,
    heroRect: heroR ? { w: Math.round(heroR.width), h: Math.round(heroR.height) } : null,
    metaRect: rect(".hero-meta"),
    metaRows,
    menuBtn: rect(".menu-btn"),
    contactBtn: rect(".nav-cta .btn-primary"),
    heroTitleH: rect(".hero-title")?.h,
    heroFallbackVisible: !!q(".hero-fallback"),
    heroCanvas: !!q(".hero-canvas canvas"),
  };
});

// Open the menu sheet
await page.click(".menu-btn");
await page.waitForTimeout(400);
const sheet = await page.evaluate(() => {
  const close = document.querySelector(".sheet-close");
  const cr = close.getBoundingClientRect();
  const triggers = [...document.querySelectorAll(".sheet-trigger")].map(el => { const r = el.getBoundingClientRect(); return { text: el.textContent.trim(), y: Math.round(r.y), h: Math.round(r.height), w: Math.round(r.width) }; });
  const sheetEl = document.querySelector(".sheet");
  const sr = sheetEl.getBoundingClientRect();
  const scroll = document.querySelector(".sheet-scroll");
  const scr = scroll.getBoundingClientRect();
  const ss = scroll.scrollHeight, ch = scroll.clientHeight;
  return {
    closeRect: { x: Math.round(cr.x), y: Math.round(cr.y), w: Math.round(cr.width), h: Math.round(cr.height) },
    closeComputedPadding: getComputedStyle(close).padding,
    closeFontSize: getComputedStyle(close).fontSize,
    triggerCount: triggers.length,
    triggers,
    sheetRect: { w: Math.round(sr.width), h: Math.round(sr.height) },
    scrollRect: { y: Math.round(scr.y), h: Math.round(ch) },
    scrollContentH: ss,
    scrollable: ss > ch,
  };
});

// Expand first accordion
await page.click(".sheet-trigger");
await page.waitForTimeout(300);
const expanded = await page.evaluate(() => {
  const links = [...document.querySelectorAll(".sheet-links a")];
  const lr = links.map(a => { const r = a.getBoundingClientRect(); return { text: a.textContent.trim(), y: Math.round(r.y), h: Math.round(r.height), w: Math.round(r.width) }; });
  const firstTrigger = document.querySelector(".sheet-trigger");
  const fr = firstTrigger.getBoundingClientRect();
  return { linkCount: links.length, links: lr.slice(0,6), firstTriggerBottom: Math.round(fr.bottom), plusSign: firstTrigger.textContent.trim().slice(-1) };
});

// body locked?
const bodyLocked = await page.evaluate(() => document.body.classList.contains("is-locked"));

// Navigate to detail via sheet link (first link)
await page.click(".sheet-links a");
await page.waitForTimeout(700);
const detail = await page.evaluate(() => {
  return {
    hash: location.hash,
    sheetGone: !document.querySelector(".sheet"),
    docScrollW: document.documentElement.scrollWidth,
    innerW: window.innerWidth,
    h1: (document.querySelector("h1")||{}).textContent,
    scrollY: window.scrollY,
    crumbsW: (() => { const c = document.querySelector(".crumbs"); const r = c.getBoundingClientRect(); return Math.round(r.width); })(),
  };
});

console.log(JSON.stringify({ home, sheet, expanded, bodyLocked, detail, errors }, null, 2));
await browser.close();
