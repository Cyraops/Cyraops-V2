import { chromium } from "playwright";
import { db } from "../src/lib/db";
import { createSession } from "../src/lib/auth";

async function main() {
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
  console.log("Navigating to http://localhost:3001/cost ...");
  await page.goto("http://localhost:3001/cost", { waitUntil: "networkidle" });

  // Wait for data to render
  await page.waitForTimeout(2000);

  const screenshotPath = "/Users/tanveersinghsaini/.gemini/antigravity/brain/4672ddc8-7ba6-4169-838e-e32f51f54d73/cost-management-overview.png";
  await page.screenshot({ path: screenshotPath, fullPage: true });
  console.log("Saved overview screenshot to:", screenshotPath);

  // Switch to Expenses tab
  await page.getByRole("button", { name: "Expenses" }).click();
  await page.waitForTimeout(1000);
  const expScreenshotPath = "/Users/tanveersinghsaini/.gemini/antigravity/brain/4672ddc8-7ba6-4169-838e-e32f51f54d73/cost-management-expenses.png";
  await page.screenshot({ path: expScreenshotPath, fullPage: true });
  console.log("Saved expenses screenshot to:", expScreenshotPath);

  await browser.close();
}

main().catch((err) => {
  console.error("Screenshot capture failed:", err);
  process.exit(1);
});

