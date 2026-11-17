/**
 * Cyraops computer service.
 *
 * Runs headless Chromium on a dedicated VM so Cyraops bots can browse the web.
 * Every destination is checked against private/loopback/metadata ranges, both
 * before navigation and on each subresource request, so the service cannot be
 * used to reach internal networks.
 *
 * Auth: bearer token (COMPUTER_TOKEN). Network: only Cyraops' outbound IPs are
 * allowed through the NSG.
 */
const express = require("express");
const dns = require("node:dns").promises;
const net = require("node:net");
const { chromium } = require("playwright");

const PORT = Number(process.env.PORT || 8787);
const TOKEN = (process.env.COMPUTER_TOKEN || "").trim();
const IDLE_MS = Number(process.env.SESSION_IDLE_MS || 15 * 60 * 1000);
const MAX_TEXT = 20000;
const USER_AGENT =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36 CyraopsBot/1.0";

if (!TOKEN || TOKEN.length < 24) {
  console.error("[computer] COMPUTER_TOKEN must be set and at least 24 chars");
  process.exit(1);
}

const app = express();
app.use(express.json({ limit: "1mb" }));

app.use((req, res, next) => {
  const auth = req.headers.authorization || "";
  if (auth !== `Bearer ${TOKEN}`) return res.status(401).json({ error: "unauthorized" });
  next();
});

function isPrivateAddress(address) {
  const clean = String(address || "").toLowerCase().replace(/^\[|\]$/g, "");
  if (!clean) return true;
  if (clean === "::1" || clean === "::") return true;
  if (clean.startsWith("fe80") || clean.startsWith("fc") || clean.startsWith("fd")) return true;
  const v4 = clean.startsWith("::ffff:") ? clean.slice(7) : clean;
  const parts = v4.split(".");
  if (parts.length !== 4) return false;
  const [a, b] = parts.map(Number);
  if ([a, b].some((n) => Number.isNaN(n))) return true;
  if (a === 0 || a === 10 || a === 127) return true;
  if (a === 169 && b === 254) return true;
  if (a === 172 && b >= 16 && b <= 31) return true;
  if (a === 192 && b === 168) return true;
  if (a === 100 && b >= 64 && b <= 127) return true;
  return false;
}

async function isPublicUrl(rawUrl) {
  let parsed;
  try {
    parsed = new URL(rawUrl);
  } catch {
    return false;
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return false;
  const host = parsed.hostname.toLowerCase();
  if (host === "localhost" || host.endsWith(".localhost") || host.endsWith(".local") || host.endsWith(".internal")) {
    return false;
  }
  try {
    const records = net.isIP(host) ? [{ address: host }] : await dns.lookup(host, { all: true });
    if (!records.length) return false;
    return records.every((record) => !isPrivateAddress(record.address));
  } catch {
    return false;
  }
}

let browserPromise = null;
async function getBrowser() {
  if (!browserPromise) {
    browserPromise = chromium.launch({
      headless: true,
      args: ["--no-sandbox", "--disable-setuid-sandbox", "--disable-dev-shm-usage", "--disable-gpu"],
    });
  }
  return browserPromise;
}

const sessions = new Map();

async function getSession(key) {
  const existing = sessions.get(key);
  if (existing) {
    existing.lastUsed = Date.now();
    return existing;
  }

  const browser = await getBrowser();
  const context = await browser.newContext({
    viewport: { width: 1280, height: 800 },
    userAgent: USER_AGENT,
    ignoreHTTPSErrors: true,
  });

  await context.route("**/*", async (route) => {
    const url = route.request().url();
    if (url.startsWith("data:") || url.startsWith("about:") || url.startsWith("blob:")) {
      return route.continue();
    }
    const allowed = await isPublicUrl(url);
    if (!allowed) {
      console.warn("[computer] blocked request", url);
      return route.abort("blockedbyclient");
    }
    return route.continue();
  });

  const page = await context.newPage();
  const session = { context, page, lastUsed: Date.now() };
  sessions.set(key, session);
  return session;
}

async function destroySession(key) {
  const session = sessions.get(key);
  if (!session) return false;
  sessions.delete(key);
  try {
    await session.context.close();
  } catch {
    // already gone
  }
  return true;
}

app.get("/health", async (_req, res) => {
  res.json({ ok: true, sessions: sessions.size, browser: "chromium", uptimeSeconds: Math.round(process.uptime()) });
});

app.post("/act", async (req, res) => {
  const { key, action, url, selector, text, deltaY, x, y } = req.body || {};
  if (!key || typeof key !== "string" || !action) {
    return res.status(400).json({ error: "key and action are required" });
  }

  try {
    const session = await getSession(key);
    const page = session.page;

    switch (action) {
      case "navigate": {
        if (!url || !(await isPublicUrl(url))) return res.status(400).json({ error: "Destination blocked or invalid" });
        await page.goto(url, { waitUntil: "domcontentloaded", timeout: 25000 });
        await page.waitForTimeout(400);
        session.lastUsed = Date.now();
        return res.json({ ok: true, url: page.url(), title: await page.title() });
      }
      case "extract": {
        const content = await page.evaluate((limit) => {
          const text = document.body ? document.body.innerText : "";
          return text.replace(/\s+\n/g, "\n").slice(0, limit);
        }, MAX_TEXT);
        session.lastUsed = Date.now();
        return res.json({ ok: true, url: page.url(), title: await page.title(), text: content });
      }
      case "click": {
        if (!selector) return res.status(400).json({ error: "selector is required" });
        await page.click(selector, { timeout: 10000 });
        session.lastUsed = Date.now();
        return res.json({ ok: true, url: page.url(), title: await page.title() });
      }
      case "type": {
        if (!selector) return res.status(400).json({ error: "selector is required" });
        await page.fill(selector, text || "");
        session.lastUsed = Date.now();
        return res.json({ ok: true, url: page.url() });
      }
      case "back": {
        await page.goBack({ timeout: 15000 }).catch(() => null);
        session.lastUsed = Date.now();
        return res.json({ ok: true, url: page.url(), title: await page.title() });
      }
      case "scroll": {
        await page.mouse.wheel(0, Number(deltaY) || 600);
        session.lastUsed = Date.now();
        return res.json({ ok: true, url: page.url() });
      }
      case "clickAt": {
        const px = Number(x);
        const py = Number(y);
        if (!Number.isFinite(px) || !Number.isFinite(py)) {
          return res.status(400).json({ error: "x and y are required" });
        }
        const size = page.viewportSize() || { width: 1280, height: 800 };
        await page.mouse.click(
          Math.max(0, Math.min(size.width - 1, px)),
          Math.max(0, Math.min(size.height - 1, py))
        );
        session.lastUsed = Date.now();
        await page.waitForTimeout(250);
        return res.json({ ok: true, url: page.url(), title: await page.title() });
      }
      case "key": {
        if (!text) return res.status(400).json({ error: "text is required" });
        await page.keyboard.press(String(text));
        session.lastUsed = Date.now();
        await page.waitForTimeout(120);
        return res.json({ ok: true, url: page.url() });
      }
      case "typeText": {
        await page.keyboard.type(String(text || ""));
        session.lastUsed = Date.now();
        return res.json({ ok: true, url: page.url() });
      }
      case "screenshot": {
        const buffer = await page.screenshot({ type: "jpeg", quality: 70 });
        session.lastUsed = Date.now();
        const size = page.viewportSize() || { width: 1280, height: 800 };
        return res.json({
          ok: true,
          url: page.url(),
          title: await page.title(),
          imageBase64: buffer.toString("base64"),
          contentType: "image/jpeg",
          width: size.width,
          height: size.height,
        });
      }
      default:
        return res.status(400).json({ error: `unknown action "${action}"` });
    }
  } catch (err) {
    console.error("[computer] action failed:", err?.message || err);
    return res.status(500).json({ error: String(err?.message || err) });
  }
});

app.delete("/session/:key", async (req, res) => {
  const destroyed = await destroySession(req.params.key);
  res.json({ ok: true, destroyed });
});

setInterval(() => {
  const now = Date.now();
  for (const [key, session] of sessions.entries()) {
    if (now - session.lastUsed > IDLE_MS) {
      console.log("[computer] closing idle session", key);
      void destroySession(key);
    }
  }
}, 60_000);

app.listen(PORT, "0.0.0.0", () => {
  console.log(`[computer] listening on ${PORT}`);
});
