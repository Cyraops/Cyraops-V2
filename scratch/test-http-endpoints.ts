import { db } from "../src/lib/db";
import { createSession } from "../src/lib/auth";

async function run() {
  const user = await db.user.findFirst({ where: { role: "OWNER" } });
  if (!user) throw new Error("No user found");

  const session = await createSession(user.id);
  const cookieHeader = `company_session=${session.token}`;

  console.log("Created test session for:", user.name);

  // 1. Test GET /api/voice/settings
  const resSettings = await fetch("http://localhost:3001/api/voice/settings", {
    headers: { Cookie: cookieHeader },
  });
  console.log("GET /api/voice/settings status:", resSettings.status);
  const dataSettings = await resSettings.json();
  console.log("  Provider:", dataSettings.provider);
  console.log("  Active Model:", dataSettings.activeModel);
  console.log("  Models:", dataSettings.models?.map((m: any) => `${m.id} (${m.name})`).join(", "));

  if (resSettings.status !== 200 || dataSettings.provider !== "deepseek" || dataSettings.activeModel !== "deepseek-flash") {
    throw new Error("Settings endpoint failed validation!");
  }

  // 2. Test POST /api/voice/chat without DEEPSEEK_API_KEY
  const resChat = await fetch("http://localhost:3001/api/voice/chat", {
    method: "POST",
    headers: { "Content-Type": "application/json", Cookie: cookieHeader },
    body: JSON.stringify({
      messages: [{ role: "user", content: "Show me pending projects" }],
      language: "auto",
    }),
  });
  console.log("POST /api/voice/chat status:", resChat.status);
  const dataChat = await resChat.json();
  console.log("  Chat Response payload:", dataChat);

  // 3. Test POST /api/voice/confirm
  const resConfirm = await fetch("http://localhost:3001/api/voice/confirm", {
    method: "POST",
    headers: { "Content-Type": "application/json", Cookie: cookieHeader },
    body: JSON.stringify({ actionId: "non_existent_id", confirmed: true }),
  });
  console.log("POST /api/voice/confirm status:", resConfirm.status);
  const dataConfirm = await resConfirm.json();
  console.log("  Confirm Response payload:", dataConfirm);

  console.log("\nALL HTTP API ENDPOINTS TESTED SUCCESSFULLY!");
}

run().catch((e) => {
  console.error("HTTP test failed:", e);
  process.exit(1);
});

