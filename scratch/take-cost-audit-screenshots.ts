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
  await page.waitForTimeout(2000);

  const brainDir = "/Users/tanveersinghsaini/.gemini/antigravity/brain/4672ddc8-7ba6-4169-838e-e32f51f54d73";

  // Overview Screenshot
  const overviewPath = `${brainDir}/cost-audit-overview-inr.png`;
  await page.screenshot({ path: overviewPath, fullPage: true });
  console.log("Saved overview screenshot to:", overviewPath);

  // Switch to Expenses Tab
  await page.getByRole("button", { name: "Expenses" }).click();
  await page.waitForTimeout(1000);
  const expensesPath = `${brainDir}/cost-audit-expenses-inr.png`;
  await page.screenshot({ path: expensesPath, fullPage: true });
  console.log("Saved expenses screenshot to:", expensesPath);

  // Switch to Investments Tab
  await page.getByRole("button", { name: "Investments" }).click();
  await page.waitForTimeout(1000);
  const investmentsPath = `${brainDir}/cost-audit-investments-inr.png`;
  await page.screenshot({ path: investmentsPath, fullPage: true });
  console.log("Saved investments screenshot to:", investmentsPath);

  await browser.close();
  console.log("All screenshots taken successfully!");
}

main().catch((err) => {
  console.error("Screenshot capture failed:", err);
  process.exit(1);
});

