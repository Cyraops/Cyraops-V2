import { db } from "../src/lib/db";
import { createSession } from "../src/lib/auth";

async function main() {
  console.log("=== STARTING ROLE-BASED ACCESS CONTROL (RBAC) AUDIT ===");

  const owner = await db.user.findFirst({ where: { role: "OWNER" } });
  if (!owner) throw new Error("No owner found");

  let member = await db.user.findFirst({ where: { role: "MEMBER" } });
  if (!member) {
    member = await db.user.create({
      data: {
        name: "Temporary Audit Member",
        role: "MEMBER",
      },
    });
  }

  // Create temporary ADMIN user if not present
  let admin = await db.user.findFirst({ where: { role: "ADMIN" } });
  let createdTempAdmin = false;
  if (!admin) {
    admin = await db.user.create({
      data: {
        name: "Temporary Audit Admin",
        role: "ADMIN",
      },
    });
    createdTempAdmin = true;
  }

  const { token: ownerToken } = await createSession(owner.id);
  const { token: memberToken } = await createSession(member.id);
  const { token: adminToken } = await createSession(admin.id);

  const baseUrl = "http://localhost:3001";

  const endpointsToTest = [
    { method: "GET", path: "/api/auth/me", name: "Current User Profile" },
    { method: "GET", path: "/api/dashboard", name: "Command Center Dashboard" },
    { method: "GET", path: "/api/projects", name: "List Projects" },
    { method: "GET", path: "/api/cost/dashboard", name: "Cost Dashboard" },
    { method: "GET", path: "/api/cost/investments", name: "Cap Table & Equity Investments" },
    { method: "GET", path: "/api/cost/audit", name: "Cost Audit Logs" },
    { method: "GET", path: "/api/cost/reports/export?type=investments", name: "Export Cap Table Report" },
    { method: "GET", path: "/api/team", name: "List Team Profiles" },
    { method: "POST", path: "/api/team", name: "Create Team Member", body: { name: "Probe", role: "MEMBER" } },
    { method: "PATCH", path: "/api/workspace", name: "Update Workspace Settings", body: { name: "Cyraops" } },
  ];

  const results: any[] = [];

  for (const ep of endpointsToTest) {
    // 1. Unauthenticated
    const unauthRes = await fetch(`${baseUrl}${ep.path}`, {
      method: ep.method,
      headers: ep.body ? { "Content-Type": "application/json", origin: baseUrl } : { origin: baseUrl },
      body: ep.body ? JSON.stringify(ep.body) : undefined,
    });

    // 2. Member
    const memberRes = await fetch(`${baseUrl}${ep.path}`, {
      method: ep.method,
      headers: {
        cookie: `company_session=${memberToken}`,
        origin: baseUrl,
        ...(ep.body ? { "Content-Type": "application/json" } : {}),
      },
      body: ep.body ? JSON.stringify(ep.body) : undefined,
    });

    // 3. Admin
    const adminRes = await fetch(`${baseUrl}${ep.path}`, {
      method: ep.method,
      headers: {
        cookie: `company_session=${adminToken}`,
        origin: baseUrl,
        ...(ep.body ? { "Content-Type": "application/json" } : {}),
      },
      body: ep.body ? JSON.stringify(ep.body) : undefined,
    });

    // 4. Owner
    const ownerRes = await fetch(`${baseUrl}${ep.path}`, {
      method: ep.method,
      headers: {
        cookie: `company_session=${ownerToken}`,
        origin: baseUrl,
        ...(ep.body ? { "Content-Type": "application/json" } : {}),
      },
      body: ep.body ? JSON.stringify(ep.body) : undefined,
    });

    results.push({
      feature: ep.name,
      method: ep.method,
      path: ep.path,
      unauthenticated: unauthRes.status,
      member: memberRes.status,
      admin: adminRes.status,
      owner: ownerRes.status,
    });
  }

  // Clean up disposable probe user if created in POST /api/team
  const probe = await db.user.findFirst({ where: { name: "Probe" } });
  if (probe) await db.user.delete({ where: { id: probe.id } });

  // Clean up temp admin if created
  if (createdTempAdmin && admin) {
    await db.session.deleteMany({ where: { userId: admin.id } });
    await db.user.delete({ where: { id: admin.id } });
  }

  console.table(results);
}

main().catch(console.error);

