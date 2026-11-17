import { chromium } from "playwright";
import { db } from "../src/lib/db";
import { createSession } from "../src/lib/auth";

const ARTIFACT_DIR = "/Users/tanveersinghsaini/.gemini/antigravity/brain/4672ddc8-7ba6-4169-838e-e32f51f54d73";

const VIEWPORTS = [
  { name: "desktop", width: 1440, height: 900 },
  { name: "laptop", width: 1280, height: 800 },
  { name: "tablet", width: 768, height: 1024 },
  { name: "mobile", width: 390, height: 844 },
];

const PAGES_TO_TEST = [
  { name: "dashboard", path: "/dashboard" },
  { name: "bot", path: "/ai" },
  { name: "projects", path: "/projects" },
  { name: "chat", path: "/chat" },
  { name: "email", path: "/email" },
  { name: "calendar", path: "/calendar" },
  { name: "activity", path: "/activity" },
  { name: "website", path: "/website" },
  { name: "cost", path: "/cost" },
  { name: "team", path: "/team" },
  { name: "settings", path: "/settings" },
];

async function main() {
  console.log("=== STARTING PLAYWRIGHT VIEWPORT & UI USABILITY AUDIT ===");

  const user = await db.user.findFirst({ where: { role: "OWNER" } });
  if (!user) throw new Error("Owner user not found");

  const { token } = await createSession(user.id);

  const browser = await chromium.launch({ headless: true });

  const consoleLogs: Record<string, string[]> = {};
  const consoleErrors: Record<string, string[]> = {};
  const networkErrors: Record<string, string[]> = {};
  const layoutIssues: any[] = [];

  for (const vp of VIEWPORTS) {
    console.log(`\n--- Testing Viewport: ${vp.name} (${vp.width}x${vp.height}) ---`);

    const context = await browser.newContext({
      viewport: { width: vp.width, height: vp.height },
      deviceScaleFactor: 1,
    });

    await context.addCookies([
      {
        name: "company_session",
        value: token,
        domain: "localhost",
        path: "/",
        httpOnly: true,
        secure: false,
        sameSite: "Lax",
      },
    ]);

    const page = await context.newPage();

    page.on("console", (msg) => {
      const type = msg.type();
      const text = msg.text();
      const key = `${vp.name}:${page.url()}`;
      if (!consoleLogs[key]) consoleLogs[key] = [];
      consoleLogs[key].push(`[${type}] ${text}`);
      if (type === "error") {
        if (!consoleErrors[key]) consoleErrors[key] = [];
        consoleErrors[key].push(text);
      }
    });

    page.on("pageerror", (err) => {
      const key = `${vp.name}:${page.url()}`;
      if (!consoleErrors[key]) consoleErrors[key] = [];
      consoleErrors[key].push(`[PageError] ${err.message}`);
    });

    page.on("response", (res) => {
      if (res.status() >= 400) {
        const key = `${vp.name}:${page.url()}`;
        if (!networkErrors[key]) networkErrors[key] = [];
        networkErrors[key].push(`${res.status()} ${res.request().method()} ${res.url()}`);
      }
    });

    for (const p of PAGES_TO_TEST) {
      const targetUrl = `http://localhost:3001${p.path}`;
      const startMs = Date.now();
      try {
        await page.goto(targetUrl, { waitUntil: "networkidle", timeout: 15000 });
      } catch (err: any) {
        console.warn(`Timeout/navigation warning for ${p.path}: ${err.message}`);
      }
      const loadTimeMs = Date.now() - startMs;

      // Small delay for DOM/state settling
      await page.waitForTimeout(1000);

      // Check horizontal overflow
      const scrollWidth = await page.evaluate(() => document.documentElement.scrollWidth);
      const clientWidth = await page.evaluate(() => document.documentElement.clientWidth);
      const hasHorizontalOverflow = scrollWidth > clientWidth;

      if (hasHorizontalOverflow) {
        layoutIssues.push({
          viewport: vp.name,
          page: p.name,
          scrollWidth,
          clientWidth,
          overflow: scrollWidth - clientWidth,
        });
      }

      // Capture screenshots for representative screens
      const shouldScreenshot =
        vp.name === "desktop" ||
        (vp.name === "laptop" && p.name === "dashboard") ||
        (vp.name === "tablet" && (p.name === "dashboard" || p.name === "projects")) ||
        (vp.name === "mobile" && (p.name === "dashboard" || p.name === "chat"));

      if (shouldScreenshot) {
        const screenshotPath = `${ARTIFACT_DIR}/audit-${vp.name}-${p.name}.png`;
        await page.screenshot({ path: screenshotPath, fullPage: true });
        console.log(`Saved screenshot: audit-${vp.name}-${p.name}.png (Load: ${loadTimeMs}ms, Overflow: ${hasHorizontalOverflow})`);
      } else {
        console.log(`Checked ${p.name} on ${vp.name}: Load: ${loadTimeMs}ms, Overflow: ${hasHorizontalOverflow}`);
      }
    }

    // On mobile, test opening mobile sidebar navigation
    if (vp.name === "mobile") {
      try {
        await page.goto("http://localhost:3001/dashboard", { waitUntil: "networkidle" });
        const menuBtn = page.getByRole("button", { name: "Open menu" });
        if (await menuBtn.isVisible()) {
          await menuBtn.click();
          await page.waitForTimeout(500);
          await page.screenshot({ path: `${ARTIFACT_DIR}/audit-mobile-nav.png` });
          console.log("Saved screenshot: audit-mobile-nav.png");
        }
      } catch (e: any) {
        console.warn("Mobile menu test notice:", e.message);
      }
    }

    await context.close();
  }

  await browser.close();

  console.log("\n=== CONSOLE ERRORS DETECTED ===");
  console.log(JSON.stringify(consoleErrors, null, 2));

  console.log("\n=== NETWORK ERRORS DETECTED ===");
  console.log(JSON.stringify(networkErrors, null, 2));

  console.log("\n=== LAYOUT HORIZONTAL OVERFLOW DETECTED ===");
  console.table(layoutIssues);

  console.log("\nPlaywright Viewport Audit Completed Successfully!");
}

main().catch(console.error);

