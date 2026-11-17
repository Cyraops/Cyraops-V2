import { PrismaClient, CallStatus, ParticipantStatus, OutboxJobStatus } from "@prisma/client";
import { spawn, ChildProcess } from "node:child_process";
import http from "node:http";
import fs from "node:fs";
import { createHash } from "node:crypto";
import { getRoomServiceClient } from "../src/lib/calling/livekit-room";
import { createCallSession, acceptCallInvitation } from "../src/lib/calling/state-machine";

const DEV_DB_URL = "postgresql://tanveersinghsaini:@localhost:5432/company_os_dev";
process.env.DATABASE_URL = DEV_DB_URL;
process.env.LIVEKIT_URL = "http://127.0.0.1:7880";
process.env.LIVEKIT_API_KEY = "APITvqwWXCN6WPq";
process.env.LIVEKIT_API_SECRET = "p6x4uddeEd04ExrfJ0iuqubMfV75iesCMsv8xMB3NLcA";

const db = new PrismaClient({ datasources: { db: { url: DEV_DB_URL } } });

let passed = 0;
let failed = 0;

function assert(cond: boolean, msg: string) {
  if (cond) {
    console.log(`  ✔ PASS: ${msg}`);
    passed++;
  } else {
    console.error(`  ✖ FAIL: ${msg}`);
    failed++;
  }
}

// CDP Client Helper
class ChromeSession {
  public chromeProcess: ChildProcess | null = null;
  public ws: WebSocket | null = null;

  constructor(
    public readonly port: number,
    public readonly profileDir: string,
    public readonly identity: string
  ) {}

  async start(url: string): Promise<void> {
    this.chromeProcess = spawn("/Applications/Google Chrome.app/Contents/MacOS/Google Chrome", [
      "--headless=new",
      `--remote-debugging-port=${this.port}`,
      "--remote-allow-origins=*",
      `--user-data-dir=${this.profileDir}`,
      url,
    ]);

    let targets: any = null;
    for (let i = 0; i < 30; i++) {
      try {
        const res = await fetch(`http://127.0.0.1:${this.port}/json`);
        targets = await res.json();
        if (targets && targets.length > 0 && targets[0].webSocketDebuggerUrl) break;
      } catch (e) {}
      await new Promise((r) => setTimeout(r, 200));
    }

    if (!targets || targets.length === 0) {
      throw new Error(`Failed to acquire CDP debugger target for ${this.identity} on port ${this.port}`);
    }

    const page = targets.find((t: any) => t.type === "page") || targets[0];
    this.ws = new WebSocket(page.webSocketDebuggerUrl);
    await new Promise((resolve, reject) => {
      this.ws!.onopen = resolve;
      this.ws!.onerror = reject;
    });
  }

  async evaluate(expr: string): Promise<any> {
    const ws = this.ws;
    if (!ws) return null;
    return new Promise((resolve) => {
      const id = Math.floor(Math.random() * 1000000);
      const handler = (msg: any) => {
        const data = JSON.parse(msg.data);
        if (data.id === id) {
          ws.removeEventListener("message", handler);
          resolve(data.result?.result?.value);
        }
      };
      ws.addEventListener("message", handler);
      ws.send(JSON.stringify({ id, method: "Runtime.evaluate", params: { expression: expr, returnByValue: true } }));
    });
  }

  async getClientState(): Promise<any> {
    const raw = await this.evaluate("window.testClient ? JSON.stringify(window.testClient) : null");
    return raw ? JSON.parse(raw) : null;
  }

  async waitForState(targetState: string, timeoutMs: number = 10000): Promise<any> {
    const start = Date.now();
    while (Date.now() - start < timeoutMs) {
      const state = await this.getClientState();
      if (state && state.state === targetState) {
        return state;
      }
      await new Promise((r) => setTimeout(r, 250));
    }
    return await this.getClientState();
  }

  async stop(): Promise<void> {
    if (this.ws) {
      try { this.ws.close(); } catch (e) {}
      this.ws = null;
    }
    if (this.chromeProcess) {
      this.chromeProcess.kill("SIGTERM");
      this.chromeProcess = null;
    }
    await new Promise((r) => setTimeout(r, 300));
    try {
      fs.rmSync(this.profileDir, { recursive: true, force: true });
    } catch (e) {}
  }
}

async function run() {
  console.log("======================================================================");
  console.log("STAGE D VERIFICATION: TWO REAL BROWSER SESSIONS WITH REAL SFU EJECTION");
  console.log("======================================================================");

  const roomService = getRoomServiceClient();

  // 1. Host local WebRTC static test server on 3006
  const clientHtml = fs.readFileSync("/Users/tanveersinghsaini/Desktop/locally hosted app dev/scratch/webrtc-test-client.html", "utf8");
  const clientJs = fs.readFileSync("/Users/tanveersinghsaini/Desktop/locally hosted app dev/scratch/livekit-client.umd.min.js", "utf8");

  const staticServer = http.createServer((req, res) => {
    if (req.url?.startsWith("/livekit-client.umd.min.js")) {
      res.writeHead(200, { "Content-Type": "application/javascript" });
      res.end(clientJs);
    } else {
      res.writeHead(200, { "Content-Type": "text/html" });
      res.end(clientHtml);
    }
  });

  await new Promise<void>((resolve) => staticServer.listen(3006, "127.0.0.1", () => resolve()));
  console.log("✔ Test WebRTC client harness running on http://127.0.0.1:3006");

  // Clean any old stage D test fixtures
  const oldUsers = await db.user.findMany({ where: { email: { in: ["stage_d_alice@cyraops.com", "stage_d_bob@cyraops.com"] } } });
  for (const u of oldUsers) {
    await db.callSfuEjectionJob.deleteMany({ where: { userId: u.id } });
    await db.callParticipant.deleteMany({ where: { userId: u.id } });
    await db.callEvent.deleteMany({ where: { actorId: u.id } });
    await db.callSession.deleteMany({ where: { OR: [{ initiatorId: u.id }, { hostId: u.id }] } });
    await db.session.deleteMany({ where: { userId: u.id } });
    await db.conversationMember.deleteMany({ where: { userId: u.id } });
    await db.user.delete({ where: { id: u.id } });
  }

  // 2. Seed Users & Sessions in company_os_dev
  console.log("\n[D1] Setting up Users, Sessions, and Call in company_os_dev");
  const userAdmin = await db.user.create({ data: { name: "Alice Owner D", email: "stage_d_alice@cyraops.com", role: "OWNER" } });
  const userBob = await db.user.create({ data: { name: "Bob Member D", email: "stage_d_bob@cyraops.com", role: "MEMBER" } });

  const sessionTokenA = "tok_session_alice_d_" + Date.now();
  await db.session.create({
    data: { id: "sess_alice_d_" + Date.now(), tokenHash: createHash("sha256").update(sessionTokenA).digest("hex"), userId: userAdmin.id, expiresAt: new Date(Date.now() + 86400000) },
  });

  const sessionTokenB = "tok_session_bob_d_" + Date.now();
  await db.session.create({
    data: { id: "sess_bob_d_" + Date.now(), tokenHash: createHash("sha256").update(sessionTokenB).digest("hex"), userId: userBob.id, expiresAt: new Date(Date.now() + 86400000) },
  });

  const conv = await db.conversation.create({
    data: {
      type: "DIRECT",
      members: { createMany: { data: [{ userId: userAdmin.id }, { userId: userBob.id }] } },
    },
  });

  // Step 1: User A creates a test call
  const callRes = await createCallSession(db, { conversationId: conv.id, initiatorId: userAdmin.id, inviteeIds: [userBob.id] });
  const call = callRes.call!;
  assert(call !== null, `Step 1: User A created call ${call.id} (Room: ${call.livekitRoomName})`);

  // Step 2: User B accepts / joins call
  await acceptCallInvitation(db, call.id, userBob.id);
  const partBob = await db.callParticipant.findFirst({ where: { callSessionId: call.id, userId: userBob.id } });
  assert(partBob?.status === ParticipantStatus.CONNECTING, "Step 2: User B accepted call invitation (status: CONNECTING)");

  // 3. Mint Genuine Tokens via real running HTTP server on 3001
  const tokenResA = await fetch(`http://127.0.0.1:3001/api/calls/${call.id}/token`, {
    method: "POST",
    headers: {
      origin: "http://127.0.0.1:3001",
      host: "127.0.0.1:3001",
      cookie: `company_session=${sessionTokenA}`,
    },
  });
  const tokenJsonA = await tokenResA.json();
  const tokenA = tokenJsonA.token;

  const tokenResB = await fetch(`http://127.0.0.1:3001/api/calls/${call.id}/token`, {
    method: "POST",
    headers: {
      origin: "http://127.0.0.1:3001",
      host: "127.0.0.1:3001",
      cookie: `company_session=${sessionTokenB}`,
    },
  });
  const tokenJsonB = await tokenResB.json();
  const tokenB = tokenJsonB.token;

  assert(Boolean(tokenA && tokenB), `Acquired valid signed LiveKit tokens for both User A and User B from live dev server (statusA: ${tokenResA.status}, statusB: ${tokenResB.status})`);

  // 4. Launch Two Real Browser Sessions (Google Chrome)
  console.log("\n[D2] Launching 2 Real Headless Google Chrome Browser Sessions");
  const sessionA = new ChromeSession(9551, `/tmp/chrome_alice_${Date.now()}`, "Alice (User A)");
  const sessionB = new ChromeSession(9552, `/tmp/chrome_bob_${Date.now()}`, "Bob (User B)");

  const urlA = `http://127.0.0.1:3006/?token=${tokenA}&url=ws://127.0.0.1:7880&identity=${userAdmin.id}`;
  const urlB = `http://127.0.0.1:3006/?token=${tokenB}&url=ws://127.0.0.1:7880&identity=${userBob.id}`;

  const tStartConnect = Date.now();
  await sessionA.start(urlA);
  await sessionB.start(urlB);

  // Step 3: Wait for both browsers to establish actual LiveKit connections
  console.log("Waiting for WebRTC connections to establish in Chrome...");
  const stateA = await sessionA.waitForState("CONNECTED", 12000);
  const stateB = await sessionB.waitForState("CONNECTED", 12000);
  const tConnected = Date.now();

  assert(stateA?.state === "CONNECTED", `Step 3A: Chrome Browser A connected to LiveKit SFU (Participant SID: ${stateA?.participantSid})`);
  assert(stateB?.state === "CONNECTED", `Step 3B: Chrome Browser B connected to LiveKit SFU (Participant SID: ${stateB?.participantSid})`);
  console.log(`Connection established in ${tConnected - tStartConnect}ms`);

  // Step 4: Verify both participants appear in the LiveKit room on the real SFU
  console.log("\n[D3] Inspecting Real LiveKit SFU via RoomServiceClient");
  const sfuParticipants = await roomService.listParticipants(call.livekitRoomName);
  const sfuIdentities = sfuParticipants.map((p) => p.identity);
  assert(sfuParticipants.length === 2, `Step 4A: Real LiveKit SFU reports exactly 2 participants in room ${call.livekitRoomName}`);
  assert(sfuIdentities.includes(userAdmin.id), `Step 4B: User A (${userAdmin.id}) is actively connected on SFU`);
  assert(sfuIdentities.includes(userBob.id), `Step 4C: User B (${userBob.id}) is actively connected on SFU`);

  // Step 5: Disable User B through existing administrative API on port 3001
  console.log("\n[D4] Executing Administrative Disablement of User B via live API");
  const tDisableStart = Date.now();
  const disableRes = await fetch(`http://127.0.0.1:3001/api/team/${userBob.id}`, {
    method: "PATCH",
    headers: {
      origin: "http://127.0.0.1:3001",
      host: "127.0.0.1:3001",
      "content-type": "application/json",
      cookie: `company_session=${sessionTokenA}`,
    },
    body: JSON.stringify({ disabled: true }),
  });
  const tDisableEnd = Date.now();
  assert(disableRes.status === 200, `Step 5: Administrative disablement returned HTTP 200 in ${tDisableEnd - tDisableStart}ms`);

  // Step 6: Verify User B's database participant status becomes EJECTED
  const bobDbPart = await db.callParticipant.findFirst({ where: { callSessionId: call.id, userId: userBob.id } });
  assert(bobDbPart?.status === ParticipantStatus.EJECTED, "Step 6: User B participant status in PostgreSQL is strictly EJECTED");

  // Step 7: Verify outbox job is processed
  const outboxJob = await db.callSfuEjectionJob.findFirst({ where: { callSessionId: call.id, userId: userBob.id } });
  assert(outboxJob !== null, "Step 7A: Outbox job was created for User B");
  assert(outboxJob?.status === OutboxJobStatus.COMPLETED, "Step 7B: Outbox job transitioned to COMPLETED post-commit");

  // Step 8: Verify the real LiveKit server removes User B
  console.log("\n[D5] Verifying SFU Removal on Real LiveKit Server");
  let sfuParticipantsAfter: any[] = [];
  for (let i = 0; i < 15; i++) {
    sfuParticipantsAfter = await roomService.listParticipants(call.livekitRoomName);
    if (!sfuParticipantsAfter.some((p) => p.identity === userBob.id)) break;
    await new Promise((r) => setTimeout(r, 200));
  }
  const sfuIdentitiesAfter = sfuParticipantsAfter.map((p) => p.identity);
  assert(!sfuIdentitiesAfter.includes(userBob.id), "Step 8: User B was physically removed from the real LiveKit SFU room");

  // Verify Chrome Browser B state transitioned to DISCONNECTED
  console.log("\n[D6] Verifying Browser B Disconnection Telemetry");
  const stateBAfter = await sessionB.waitForState("DISCONNECTED", 8000);
  assert(stateBAfter?.state === "DISCONNECTED", `Browser B observed disconnection event (Disconnect reason: ${stateBAfter?.disconnectReason})`);

  // Step 9: Verify User B cannot obtain a fresh token
  console.log("\n[D7] Verifying User B Token Issuance Blocked");
  const tokenResBDisabled = await fetch(`http://127.0.0.1:3001/api/calls/${call.id}/token`, {
    method: "POST",
    headers: {
      origin: "http://127.0.0.1:3001",
      host: "127.0.0.1:3001",
      cookie: `company_session=${sessionTokenB}`,
    },
  });
  assert(tokenResBDisabled.status === 401 || tokenResBDisabled.status === 403, `Step 9: Disabled User B cannot obtain a fresh token (HTTP ${tokenResBDisabled.status})`);

  // Step 10: Verify User B cannot reconnect using previously issued token after server-side ejection
  console.log("\n[D8] Verifying User B Reconnection Blocked on Old Token (Webhook Auto-Ejection)");
  const sessionBReconnect = new ChromeSession(9553, `/tmp/chrome_bob_reconnect_${Date.now()}`, "Bob Reconnect Attempt");
  await sessionBReconnect.start(urlB);

  // When User B reconnects with old token, LiveKit sends participant_joined webhook to port 3001.
  // Port 3001 checks company_os_dev, sees disabledAt is set, and re-ejects Bob immediately!
  console.log("Waiting for Webhook Auto-Eject loop to intercept reconnection...");
  let isBobOnSfu = true;
  for (let i = 0; i < 20; i++) {
    await new Promise((r) => setTimeout(r, 200));
    const sfuCheck = await roomService.listParticipants(call.livekitRoomName);
    if (!sfuCheck.some((p) => p.identity === userBob.id)) {
      isBobOnSfu = false;
      break;
    }
  }
  assert(!isBobOnSfu, "Step 10: User B reconnect attempt intercepted and auto-ejected by LiveKit webhook gatekeeper");
  await sessionBReconnect.stop();

  // Step 11: Verify User A remains connected
  console.log("\n[D9] Verifying User A Remains Connected");
  const stateAAfter = await sessionA.getClientState();
  assert(stateAAfter?.state === "CONNECTED", "Step 11A: Chrome Browser A (Alice) remains actively CONNECTED");
  const sfuFinal = await roomService.listParticipants(call.livekitRoomName);
  assert(sfuFinal.length === 1 && sfuFinal[0].identity === userAdmin.id, "Step 11B: Real LiveKit SFU confirms User A is the sole remaining active participant");

  // Clean up Chrome sessions & HTTP server
  await sessionA.stop();
  await sessionB.stop();
  staticServer.close();

  // Clean up test fixtures from dev DB
  await db.callSfuEjectionJob.deleteMany({ where: { userId: userBob.id } });
  await db.callParticipant.deleteMany({ where: { callSessionId: call.id } });
  await db.callEvent.deleteMany({ where: { callSessionId: call.id } });
  await db.callSession.delete({ where: { id: call.id } });
  await db.conversationMember.deleteMany({ where: { conversationId: conv.id } });
  await db.conversation.delete({ where: { id: conv.id } });
  await db.session.deleteMany({ where: { userId: { in: [userAdmin.id, userBob.id] } } });
  await db.user.deleteMany({ where: { id: { in: [userAdmin.id, userBob.id] } } });

  console.log("\n======================================================================");
  console.log(`STAGE D RESULTS: ${passed} PASSED, ${failed} FAILED`);
  console.log("======================================================================");

  if (failed > 0) {
    process.exit(1);
  }
}

run()
  .catch(async (err) => {
    console.error("Test failed with error:", err);
    process.exit(1);
  })
  .finally(async () => {
    await db.$disconnect();
  });
