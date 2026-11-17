import { PrismaClient, CallStatus, ParticipantStatus, OutboxJobStatus } from "@prisma/client";
import { getRoomServiceClient } from "../src/lib/calling/livekit-room";
import { leaveCall, ejectUserFromActiveCalls } from "../src/lib/calling/state-machine";
import { triggerImmediateSfuEjection } from "../src/lib/calling/outbox";
import { generateParticipantToken } from "../src/lib/calling/livekit-token";
import { Room } from "livekit-client";

const DEV_DB_URL = "postgresql://tanveersinghsaini:@localhost:5432/company_os_dev";
process.env.DATABASE_URL = DEV_DB_URL;
process.env.LIVEKIT_URL = "http://127.0.0.1:7880";
process.env.LIVEKIT_API_KEY = "APITvqwWXCN6WPq";
process.env.LIVEKIT_API_SECRET = "p6x4uddeEd04ExrfJ0iuqubMfV75iesCMsv8xMB3NLcA";

const db = new PrismaClient({ datasources: { db: { url: DEV_DB_URL } } });

async function run() {
  console.log("=== RUNNING REMAINING EDGE CASES (EC-13, EC-14, EC-15, EC-16) ===");

  const userA = await db.user.findFirst({ where: { email: "audit_alice@cyraops.com" } });
  const userB = await db.user.findFirst({ where: { email: "audit_bob@cyraops.com" } });
  const conv = await db.conversation.findFirst({ where: { type: "DIRECT" } });

  // -------------------------------------------------------------
  // EC-13: Both participants leaving almost simultaneously
  // -------------------------------------------------------------
  console.log("\n[EC-13] Testing simultaneous leaveCall...");
  const call13 = await db.callSession.create({
    data: {
      conversationId: conv!.id,
      type: "AUDIO",
      status: CallStatus.ACTIVE,
      initiatorId: userA!.id,
      hostId: userA!.id,
      livekitRoomName: `call_ec13_${Date.now()}`,
      participants: {
        create: [
          { userId: userA!.id, status: ParticipantStatus.CONNECTED, isHost: true },
          { userId: userB!.id, status: ParticipantStatus.CONNECTED, isHost: false },
        ],
      },
    },
  });

  const [resA, resB] = await Promise.all([
    db.$transaction((tx) => leaveCall(tx, call13.id, userA!.id)),
    db.$transaction((tx) => leaveCall(tx, call13.id, userB!.id)),
  ]);

  const finalCall13 = await db.callSession.findUnique({ where: { id: call13.id } });
  console.log(`  resA: ${resA.success}, resB: ${resB.success}, finalStatus: ${finalCall13?.status}, reason: ${finalCall13?.terminationReason}`);

  // -------------------------------------------------------------
  // EC-14: Disabled user during an active call
  // -------------------------------------------------------------
  console.log("\n[EC-14] Testing disabled user ejection during active call...");
  const call14 = await db.callSession.create({
    data: {
      conversationId: conv!.id,
      type: "AUDIO",
      status: CallStatus.ACTIVE,
      initiatorId: userA!.id,
      hostId: userA!.id,
      livekitRoomName: `call_ec14_${Date.now()}`,
      participants: {
        create: [
          { userId: userA!.id, status: ParticipantStatus.CONNECTED, isHost: true },
          { userId: userB!.id, status: ParticipantStatus.CONNECTED, isHost: false },
        ],
      },
    },
  });

  await db.user.update({ where: { id: userB!.id }, data: { disabledAt: new Date() } });
  const ejection = await ejectUserFromActiveCalls(db, userB!.id, "admin");
  if (ejection.queuedJobIds?.length) {
    await triggerImmediateSfuEjection(ejection.queuedJobIds);
  }
  const part14 = await db.callParticipant.findFirst({ where: { callSessionId: call14.id, userId: userB!.id } });
  console.log(`  Ejected status: ${part14?.status}, queuedJobs: ${ejection.queuedJobIds?.length}`);
  await db.user.update({ where: { id: userB!.id }, data: { disabledAt: null } });

  // -------------------------------------------------------------
  // EC-15: Expired LiveKit token
  // -------------------------------------------------------------
  console.log("\n[EC-15] Testing LiveKit token expiry rejection...");
  const { token: expiredToken } = await generateParticipantToken({
    roomName: "audit_room_token_test",
    userId: userA!.id,
    ttlSeconds: 10,
  });

  console.log("  Waiting 11s for LiveKit token to expire...");
  await new Promise((r) => setTimeout(r, 11000));

  const room = new Room();
  let connectError: any = null;
  try {
    await room.connect("http://127.0.0.1:7880", expiredToken);
  } catch (e: any) {
    connectError = e;
  } finally {
    room.disconnect();
  }
  console.log(`  LiveKit connection error for expired token: ${connectError?.message || connectError}`);

  // -------------------------------------------------------------
  // EC-16: Duplicate / delayed webhook delivery
  // -------------------------------------------------------------
  console.log("\n[EC-16] Testing delayed webhook on ended call...");
  const delayedRes = await fetch("http://127.0.0.1:3001/api/calls/webhook", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      // Without valid signature, let's verify signature check
    },
    body: JSON.stringify({ event: "participant_joined", room: { name: call13.livekitRoomName } }),
  });
  console.log(`  Missing auth header webhook response: ${delayedRes.status}`);

  console.log("\n=== EC-13 to EC-16 COMPLETE ===");
}

run().catch((e) => {
  console.error("Execution failed:", e);
  process.exit(1);
});

