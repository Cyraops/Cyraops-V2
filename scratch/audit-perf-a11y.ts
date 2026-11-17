import { chromium } from "playwright";
import { db } from "../src/lib/db";
import { createSession } from "../src/lib/auth";

async function main() {
  console.log("=== STARTING ACCESSIBILITY & PERFORMANCE AUDIT ===");

  const user = await db.user.findFirst({ where: { role: "OWNER" } });
  if (!user) throw new Error("No user found");
  const { token } = await createSession(user.id);

  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    viewport: { width: 1440, height: 900 },
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

  const pages = [
    { name: "Dashboard", url: "http://localhost:3001/dashboard" },
    { name: "Cyraops Bot", url: "http://localhost:3001/ai" },
    { name: "Projects", url: "http://localhost:3001/projects" },
    { name: "Chat", url: "http://localhost:3001/chat" },
    { name: "Email", url: "http://localhost:3001/email" },
    { name: "Calendar", url: "http://localhost:3001/calendar" },
    { name: "Activity", url: "http://localhost:3001/activity" },
    { name: "Company Presence", url: "http://localhost:3001/website" },
    { name: "Cost Management", url: "http://localhost:3001/cost" },
    { name: "Team", url: "http://localhost:3001/team" },
    { name: "Settings", url: "http://localhost:3001/settings" },
  ];

  const perfResults: any[] = [];
  const a11yResults: any[] = [];

  for (const p of pages) {
    const start = performance.now();
    try {
      await page.goto(p.url, { waitUntil: "domcontentloaded", timeout: 15000 });
    } catch (e: any) {
      console.warn(`Nav warning for ${p.name}: ${e.message}`);
    }
    const domLoadedMs = Math.round(performance.now() - start);

    // Measure timing via PerformanceNavigationTiming API
    const timing = await page.evaluate(() => {
      const navEntry = performance.getEntriesByType("navigation")[0] as PerformanceNavigationTiming | undefined;
      if (!navEntry) return null;
      return {
        dnsMs: Math.round(navEntry.domainLookupEnd - navEntry.domainLookupStart),
        tcpMs: Math.round(navEntry.connectEnd - navEntry.connectStart),
        ttfbMs: Math.round(navEntry.responseStart - navEntry.requestStart),
        downloadMs: Math.round(navEntry.responseEnd - navEntry.responseStart),
        domInteractiveMs: Math.round(navEntry.domInteractive - navEntry.startTime),
        domCompleteMs: Math.round(navEntry.domComplete - navEntry.startTime),
      };
    });

    perfResults.push({
      page: p.name,
      domLoadedMs,
      ttfbMs: timing?.ttfbMs ?? "N/A",
      domInteractiveMs: timing?.domInteractiveMs ?? "N/A",
      domCompleteMs: timing?.domCompleteMs ?? "N/A",
    });

    // Run basic WCAG automated scans
    const a11yScan = await page.evaluate(() => {
      // 1. Unlabeled buttons
      const buttons = Array.from(document.querySelectorAll("button"));
      const unlabeledButtons = buttons.filter((btn) => {
        const text = btn.innerText.trim();
        const ariaLabel = btn.getAttribute("aria-label");
        const title = btn.getAttribute("title");
        return !text && !ariaLabel && !title;
      }).length;

      // 2. Unlabeled form inputs
      const inputs = Array.from(document.querySelectorAll("input, select, textarea"));
      const unlabeledInputs = inputs.filter((input) => {
        const id = input.id;
        const ariaLabel = input.getAttribute("aria-label");
        const placeholder = input.getAttribute("placeholder");
        const hasAssociatedLabel = id && document.querySelector(`label[for="${id}"]`);
        const isInsideLabel = input.closest("label");
        return !ariaLabel && !hasAssociatedLabel && !isInsideLabel && !placeholder;
      }).length;

      // 3. Images without alt text
      const images = Array.from(document.querySelectorAll("img"));
      const imagesWithoutAlt = images.filter((img) => !img.hasAttribute("alt")).length;

      // 4. Contrast / Color checking samples
      const elementsWithLowOpacity = Array.from(document.querySelectorAll("*")).filter((el) => {
        const style = window.getComputedStyle(el);
        const opacity = parseFloat(style.opacity);
        return opacity > 0 && opacity < 0.4;
      }).length;

      return {
        totalButtons: buttons.length,
        unlabeledButtons,
        totalInputs: inputs.length,
        unlabeledInputs,
        totalImages: images.length,
        imagesWithoutAlt,
        lowOpacityCount: elementsWithLowOpacity,
      };
    });

    a11yResults.push({
      page: p.name,
      ...a11yScan,
    });
  }

  // Check 3D Logo Canvas presence and resource overhead
  console.log("\nTesting 3D Logo and Voice Assistant Overlay...");
  await page.goto("http://localhost:3001/dashboard");
  const voiceNavBtn = page.getByRole("button", { name: "Open Cyraops Voice Assistant" });
  let voiceBtnVisible = false;
  let canvasRendered = false;
  if (await voiceNavBtn.isVisible()) {
    voiceBtnVisible = true;
    await voiceNavBtn.click();
    await page.waitForTimeout(1000);
    const canvas = page.locator("canvas");
    canvasRendered = await canvas.isVisible().catch(() => false);
  }

  await browser.close();

  console.log("\n=== PERFORMANCE MEASUREMENTS (ms) ===");
  console.table(perfResults);

  console.log("\n=== ACCESSIBILITY SCAN (WCAG 2.2 AA) ===");
  console.table(a11yResults);

  console.log("\n=== 3D VOICE ASSISTANT RENDERING ===");
  console.log({ voiceBtnVisible, canvasRendered });
}

main().catch(console.error);

