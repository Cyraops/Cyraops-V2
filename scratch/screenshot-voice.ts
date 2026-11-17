import { chromium } from "playwright";
import { db } from "../src/lib/db";
import { createSession } from "../src/lib/auth";

async function takeScreenshots() {
  const user = await db.user.findFirst({ where: { role: "OWNER" } });
  if (!user) throw new Error("No user found");

  const session = await createSession(user.id);
  console.log("Created session for user:", user.name);

  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    viewport: { width: 1440, height: 900 },
  });

  await context.addCookies([
    {
      name: "company_session",
      value: session.token,
      domain: "localhost",
      path: "/",
      httpOnly: true,
      secure: false,
      sameSite: "Lax",
    },
  ]);

  const page = await context.newPage();
  console.log("Navigating to http://localhost:3001/dashboard ...");
  await page.goto("http://localhost:3001/dashboard", { waitUntil: "networkidle" });

  // Wait for header to render
  await page.waitForSelector("header");
  await page.waitForTimeout(1000);

  // 1. Screenshot of Top Navigation showing Voice Assistant Button
  await page.screenshot({
    path: "/Users/tanveersinghsaini/.gemini/antigravity/brain/4672ddc8-7ba6-4169-838e-e32f51f54d73/cyraops-voice-topnav-button.png",
  });
  console.log("✓ Saved top navigation screenshot: cyraops-voice-topnav-button.png");

  // Click on the 3D Cyraops Voice Assistant button
  console.log("Clicking Voice Assistant button...");
  const voiceBtn = page.locator('button[aria-label="Cyraops Voice Assistant"]');
  await voiceBtn.click();
  await page.waitForTimeout(1200);

  // 2. Screenshot of Voice Assistant Overlay
  await page.screenshot({
    path: "/Users/tanveersinghsaini/.gemini/antigravity/brain/4672ddc8-7ba6-4169-838e-e32f51f54d73/cyraops-voice-assistant-overlay.png",
  });
  console.log("✓ Saved voice assistant overlay screenshot: cyraops-voice-assistant-overlay.png");

  await browser.close();
}

takeScreenshots().catch((e) => {
  console.error("Screenshot capture failed:", e);
  process.exit(1);
});

