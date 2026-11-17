import { db } from "../src/lib/db";
import { createSession } from "../src/lib/auth";

async function main() {
  console.log("=== STEP 1: ROUTE INVENTORY AND STATUS CODE AUDIT ===");

  const user = await db.user.findFirst({ where: { role: "OWNER" } });
  if (!user) throw new Error("No owner found in dev database");

  const { token } = await createSession(user.id);
  const cookieHeader = `company_session=${token}`;

  const routes = [
    // Web Pages
    { path: "/", type: "PAGE", expectAuth: true },
    { path: "/login", type: "PAGE", expectAuth: false },
    { path: "/setup", type: "PAGE", expectAuth: false },
    { path: "/dashboard", type: "PAGE", expectAuth: true },
    { path: "/ai", type: "PAGE", expectAuth: true },
    { path: "/ai/tasks", type: "PAGE", expectAuth: true },
    { path: "/ai/admin", type: "PAGE", expectAuth: true },
    { path: "/ai/agents", type: "PAGE", expectAuth: true },
    { path: "/ai/skills", type: "PAGE", expectAuth: true },
    { path: "/ai/approvals", type: "PAGE", expectAuth: true },
    { path: "/projects", type: "PAGE", expectAuth: true },
    { path: "/chat", type: "PAGE", expectAuth: true },
    { path: "/email", type: "PAGE", expectAuth: true },
    { path: "/calendar", type: "PAGE", expectAuth: true },
    { path: "/activity", type: "PAGE", expectAuth: true },
    { path: "/website", type: "PAGE", expectAuth: true },
    { path: "/cost", type: "PAGE", expectAuth: true },
    { path: "/team", type: "PAGE", expectAuth: true },
    { path: "/settings", type: "PAGE", expectAuth: true },

    // API Routes (GET)
    { path: "/api/health", type: "API", expectAuth: false },
    { path: "/api/auth/me", type: "API", expectAuth: true },
    { path: "/api/workspace", type: "API", expectAuth: true },
    { path: "/api/dashboard", type: "API", expectAuth: true },
    { path: "/api/projects", type: "API", expectAuth: true },
    { path: "/api/tasks", type: "API", expectAuth: true },
    { path: "/api/conversations", type: "API", expectAuth: true },
    { path: "/api/calendar", type: "API", expectAuth: true },
    { path: "/api/activity", type: "API", expectAuth: true },
    { path: "/api/presence", type: "API", expectAuth: true },
    { path: "/api/team", type: "API", expectAuth: true },
    { path: "/api/notifications", type: "API", expectAuth: true },
    { path: "/api/files", type: "API", expectAuth: true },
    { path: "/api/search?q=test", type: "API", expectAuth: true },
    { path: "/api/cost/dashboard", type: "API", expectAuth: true },
    { path: "/api/cost/expenses", type: "API", expectAuth: true },
    { path: "/api/cost/investments", type: "API", expectAuth: true },
    { path: "/api/cost/recurring", type: "API", expectAuth: true },
    { path: "/api/cost/invoices", type: "API", expectAuth: true },
    { path: "/api/cost/audit", type: "API", expectAuth: true },
    { path: "/api/cost/categories", type: "API", expectAuth: true },
    { path: "/api/email", type: "API", expectAuth: true },
    { path: "/api/voice/settings", type: "API", expectAuth: true },
    { path: "/api/ai/conversations", type: "API", expectAuth: true },
    { path: "/api/ai/agents", type: "API", expectAuth: true },
    { path: "/api/ai/skills", type: "API", expectAuth: true },
    { path: "/api/ai/approvals", type: "API", expectAuth: true },
    { path: "/api/ai/tasks", type: "API", expectAuth: true },
    { path: "/api/ai/admin", type: "API", expectAuth: true },
  ];

  const results: any[] = [];

  for (const r of routes) {
    const url = `http://localhost:3001${r.path}`;

    // 1. Unauthenticated test
    const unauthRes = await fetch(url, { redirect: "manual" });
    const unauthStatus = unauthRes.status;

    // 2. Authenticated test
    const authRes = await fetch(url, {
      headers: { cookie: cookieHeader },
      redirect: "manual",
    });
    const authStatus = authRes.status;
    let authContentType = authRes.headers.get("content-type") || "";

    results.push({
      path: r.path,
      type: r.type,
      unauthStatus,
      authStatus,
      authContentType,
      pass:
        r.type === "PAGE"
          ? (authStatus === 200 || authStatus === 307 || authStatus === 302)
          : (authStatus === 200),
    });
  }

  console.table(results);
  const failed = results.filter((r) => !r.pass);
  console.log(`Inventory: Total ${results.length} routes audited. Passed: ${results.length - failed.length}, Failed: ${failed.length}`);
  if (failed.length > 0) {
    console.log("Failed routes:", failed);
  }
}

main().catch(console.error);

