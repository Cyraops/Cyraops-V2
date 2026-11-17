import "next/dist/server/node-environment";
import { createServer } from "node:http";
import next from "next";
import { Server as SocketServer } from "socket.io";
import { db } from "./src/lib/db";
import { SESSION_COOKIE, sha256 } from "./src/lib/auth";
import { setRealtimeServer } from "./src/lib/realtime";
import { taskRunner } from "./src/lib/ai/automation/task-runner";
import { browserRuntime } from "./src/lib/ai/browser/browser-runtime";
import { emailSyncWorker } from "./src/lib/email/sync-worker";
import { sweepCallTimeouts } from "./src/lib/calling/state-machine";
import { sweepRoutines } from "./src/lib/ai/automation/runner";
import { ensureDefaultSkills, ensureDefaultRoutine } from "./src/lib/ai/automation/routines";
import { ensureDefaultCategories } from "./src/lib/cost-service";

declare global {
  var __callSweepTimer: NodeJS.Timeout | undefined;
  var __routineSchedulerTimer: NodeJS.Timeout | undefined;
}

async function start() {
  const dev = process.env.NODE_ENV !== "production";
  const hostname = process.env.HOST ?? "0.0.0.0";
  const port = Number(process.env.PORT ?? 3000);
  const app = next({ dev });
  const handle = app.getRequestHandler();

  await app.prepare();
  const httpServer = createServer((req, res) => handle(req, res));
  const io = new SocketServer(httpServer, { cors: { origin: false }, maxHttpBufferSize: 64 * 1024 });
  setRealtimeServer(io);
  io.use(async (socket, nextSocket) => {
    try {
      const cookie = socket.handshake.headers.cookie;
      const token = cookie?.split(";").map((part) => part.trim()).find((part) => part.startsWith(`${SESSION_COOKIE}=`))?.slice(SESSION_COOKIE.length + 1);
      if (!token) return nextSocket(new Error("Unauthorized"));
      let sessionToken = token;
      try { sessionToken = decodeURIComponent(token); } catch { sessionToken = ""; }
      const session = await db.session.findUnique({ where: { tokenHash: sha256(sessionToken) }, select: { userId: true, expiresAt: true, user: { select: { disabledAt: true } } } });
      if (!session || session.expiresAt < new Date() || session.user.disabledAt) return nextSocket(new Error("Unauthorized"));
      socket.data.userId = session.userId;
      nextSocket();
    } catch { nextSocket(new Error("Unauthorized")); }
  });
  io.on("connection", (socket) => {
    // Automatically join personal notification room derived exclusively from server-side authenticated identity
    if (socket.data.userId) {
      socket.join(`user:${socket.data.userId}`);
    }

    socket.on("conversation:join", async (conversationId: unknown) => {
      if (typeof conversationId !== "string" || conversationId.length > 64) return;
      const member = await db.conversationMember.findUnique({ where: { conversationId_userId: { conversationId, userId: socket.data.userId } }, select: { conversationId: true } });
      if (member) socket.join(conversationId);
    });
    socket.on("conversation:leave", (conversationId: unknown) => {
      if (typeof conversationId === "string" && conversationId.length <= 64) socket.leave(conversationId);
    });
  });
  const sweepCalls = async () => {
    try {
      await sweepCallTimeouts(db);
    } catch (error) {
      console.error("[CallSweep] Background sweep failed:", error);
    }
  };
  if (globalThis.__callSweepTimer) {
    clearInterval(globalThis.__callSweepTimer);
  }
  globalThis.__callSweepTimer = setInterval(() => { void sweepCalls(); }, 15_000);

  // Scheduled routines run through a durable queue now: a row per occurrence,
  // claimed with a lease, so a redeploy mid-run retries instead of losing it and
  // a second replica cannot double-run the same slot.
  // A sweep can outlast the 60s tick (each run may make a live model call).
  // Without this guard two sweeps overlap and pick up the same work.
  let sweeping = false;
  const runScheduledRoutines = async () => {
    if (sweeping) return;
    sweeping = true;
    try {
      const outcome = await sweepRoutines(new Date());
      if (outcome.queued || outcome.executed || outcome.recovered) {
        console.log(
          `[Routines] queued=${outcome.queued} executed=${outcome.executed} recovered=${outcome.recovered}`
        );
      }
    } catch (error) {
      console.error("[Routines] Sweep failed:", error);
    } finally {
      sweeping = false;
    }
  };
  if (globalThis.__routineSchedulerTimer) {
    clearInterval(globalThis.__routineSchedulerTimer);
  }
  globalThis.__routineSchedulerTimer = setInterval(() => { void runScheduledRoutines(); }, 60_000);
  const sendDeadlineReminders = async () => {
    const now = new Date();
    const until = new Date(now.getTime() + 24 * 60 * 60 * 1000);
    const dueTasks = await db.task.findMany({ where: { archivedAt: null, status: { not: "DONE" }, dueDate: { gt: now, lte: until }, assigneeId: { not: null } }, select: { id: true, title: true, dueDate: true, assigneeId: true } });
    for (const task of dueTasks) {
      if (!task.assigneeId || !task.dueDate) continue;
      const day = task.dueDate.toISOString().slice(0, 10);
      await db.notification.upsert({ where: { dedupeKey: `deadline:${task.id}:${day}` }, create: { dedupeKey: `deadline:${task.id}:${day}`, userId: task.assigneeId, type: "DEADLINE", title: "Task due within 24 hours", body: task.title, href: "/tasks" }, update: {} });
    }
  };
  void sendDeadlineReminders().catch((error) => console.error("Deadline reminder check failed", error));
  const reminderTimer = setInterval(() => { void sendDeadlineReminders().catch((error) => console.error("Deadline reminder check failed", error)); }, 30 * 60 * 1000);
  httpServer.listen(port, hostname, () => {
    console.log(`Cyraops CRM listening on http://${hostname}:${port}`);

    // Ensure default cost categories exist idempotently on server startup
    void ensureDefaultCategories().catch((err) => {
      console.error("[Startup] Failed to ensure default cost categories:", err);
    });

    // Seed the skill catalogue and the daily routine, then check for due work.
    void ensureDefaultSkills()
      .then(() => ensureDefaultRoutine())
      .then(() => runScheduledRoutines())
      .catch((err) => console.error("[Startup] Routine seeding failed:", err));

    // Durable task recovery sweep on startup
    void taskRunner.recoverOrphanedTasks().then((count) => {
      if (count > 0) console.log(`[Startup Recovery] Successfully recovered ${count} in-flight AI task(s)`);
    }).catch((err) => {
      console.error("[Startup Recovery] Failed to run recovery sweep:", err);
    });

    // Start background mailbox synchronization
    emailSyncWorker.start();
  });

  for (const signal of ["SIGINT", "SIGTERM"] as const) process.on(signal, () => {
    emailSyncWorker.stop();
    clearInterval(reminderTimer);
    if (globalThis.__callSweepTimer) {
      clearInterval(globalThis.__callSweepTimer);
      globalThis.__callSweepTimer = undefined;
    }
    io.close();
    void browserRuntime.closeAll().catch(() => {});
    httpServer.close(() => { void db.$disconnect().finally(() => process.exit(0)); });
  });
}

void start();
