/**
 * The CLI AgentRuntime: one `dsh` process per turn, exactly as today's route
 * behaved. `client.ts` (the spawn wrapper) is untouched.
 *
 * Session mapping:
 * - `createSession` returns a Session whose `harnessSessionId` is null — the
 *   harness assigns the durable id on the first turn. When the store already
 *   holds an id for this conversation (a previous turn, or a server restart),
 *   the session resumes it instead.
 * - `executeTurn` spawns `dsh --session-id <id>` when an id is known, streams
 *   the parsed events, and appends a synthetic `final` event when the spawn
 *   produced none (so downstream `finalTextOf` always has an answer to find).
 * - The first turn's announced id is persisted through the store, keyed by
 *   conversationId and scoped by tenantId.
 *
 * Known limits (all inherited from the spawn contract in `client.ts`):
 * - `cancelTurn` is cooperative: the in-flight child cannot be killed from
 *   here. The turn's iterator throws an AbortError immediately, its results
 *   are discarded, and the next turn on the same session waits for the child
 *   to exit so two spawns never write the same harness session concurrently.
 * - Turns on one session are serialized; different sessions may run in
 *   parallel (same as today's route).
 */

import { randomUUID } from "node:crypto";
import { statSync } from "node:fs";
import { join } from "node:path";
import { runHarnessTask, harnessBinary, type HarnessEvent } from "./client";
import { finalTextOf } from "./events";
import {
  abortError,
  createEventQueue,
  HarnessRunError,
  type AgentRuntime,
  type EventQueue,
  type RuntimeHealth,
  type Session,
} from "./runtime";
import type { HarnessSessionStore } from "./store";

/** Resolve a bare command name against PATH without spawning a process. */
function binaryOnPath(bin: string): boolean {
  if (bin.includes("/") || bin.includes("\\")) {
    try {
      return statSync(bin).isFile();
    } catch {
      return false;
    }
  }
  for (const dir of (process.env.PATH ?? "").split(":")) {
    if (!dir) continue;
    try {
      if (statSync(join(dir, bin)).isFile()) return true;
    } catch {
      // keep scanning
    }
  }
  return false;
}

export class CliAgentRuntime implements AgentRuntime {
  private readonly sessions = new Map<string, Session>();
  private readonly turns = new Map<string, Promise<unknown>>();
  private readonly controllers = new Map<string, AbortController>();

  constructor(
    private readonly store: HarnessSessionStore,
    private readonly fallbackReason?: string
  ) {}

  async createSession(input: { tenantId: string; conversationId: string }): Promise<Session> {
    const id = randomUUID();
    const harnessSessionId = await this.store.loadHarnessSessionId({
      tenantId: input.tenantId,
      conversationId: input.conversationId,
    });
    const session: Session = {
      id,
      tenantId: input.tenantId,
      conversationId: input.conversationId,
      harnessSessionId,
    };
    this.sessions.set(id, session);
    this.controllers.set(id, new AbortController());
    return session;
  }

  async *executeTurn(input: { sessionId: string; task: string; signal?: AbortSignal }): AsyncIterable<HarnessEvent> {
    const session = this.sessions.get(input.sessionId);
    if (!session) throw new Error(`unknown harness session: ${input.sessionId}`);

    const controller = this.controllers.get(input.sessionId);
    const signal = input.signal ?? controller?.signal;
    const queue = createEventQueue<HarnessEvent>();

    let aborted = false;
    let removeAbortListener: (() => void) | undefined;
    if (signal) {
      const onAbort = () => {
        aborted = true;
        queue.close(); // unblock the consumer; the child keeps running to exit
      };
      if (signal.aborted) onAbort();
      else {
        signal.addEventListener("abort", onAbort, { once: true });
        removeAbortListener = () => signal.removeEventListener("abort", onAbort);
      }
    }

    // Serialize turns per session: the next turn waits for this child to exit.
    const previous = this.turns.get(session.id) ?? Promise.resolve();
    const spawn = previous.catch(() => undefined).then(() => this.runSpawn(session, input.task, queue));
    this.turns.set(session.id, spawn.catch(() => undefined));

    try {
      yield* queue;
      if (aborted) throw abortError();
      await spawn; // rethrows engine failures (HarnessRunError)
    } finally {
      removeAbortListener?.();
    }
  }

  private async runSpawn(session: Session, task: string, queue: EventQueue<HarnessEvent>): Promise<void> {
    let harnessSessionId = session.harnessSessionId;
    if (!harnessSessionId) {
      harnessSessionId = await this.store.loadHarnessSessionId({
        tenantId: session.tenantId,
        conversationId: session.conversationId,
      });
    }

    let sawFinal = false;
    const result = await runHarnessTask({
      task,
      sessionId: harnessSessionId ?? undefined,
      cwd: process.cwd(),
      onEvent: (event) => {
        if (event.type === "final") sawFinal = true;
        queue.push(event);
      },
    });

    if (!sawFinal) {
      queue.push({
        type: "final",
        sessionId: result.sessionId ?? undefined,
        text: finalTextOf(result.events),
        reason: { kind: result.code === 0 ? "completed" : "failed" },
      });
    }
    queue.close();

    if (result.code !== 0) {
      throw new HarnessRunError(
        result.timedOut ? "The harness turn timed out." : "The harness turn failed.",
        {
          code: result.code,
          stderr: result.stderr.trim(),
          timedOut: result.timedOut,
          sessionId: result.sessionId,
        }
      );
    }

    if (result.sessionId) {
      session.harnessSessionId = result.sessionId;
      await this.store.saveHarnessSessionId({
        tenantId: session.tenantId,
        conversationId: session.conversationId,
        harnessSessionId: result.sessionId,
      });
    }
  }

  async getSession(sessionId: string): Promise<Session | null> {
    return this.sessions.get(sessionId) ?? null;
  }

  async cancelTurn(input: { sessionId: string }): Promise<void> {
    this.controllers.get(input.sessionId)?.abort();
  }

  async closeSession(sessionId: string): Promise<void> {
    this.sessions.delete(sessionId);
    this.controllers.delete(sessionId);
    this.turns.delete(sessionId);
  }

  async healthCheck(): Promise<RuntimeHealth> {
    const bin = harnessBinary();
    if (!binaryOnPath(bin)) {
      return { available: false, kind: "cli", reason: `harness binary "${bin}" not found on PATH` };
    }
    if (this.fallbackReason) return { available: true, kind: "cli", reason: this.fallbackReason };
    return { available: true, kind: "cli" };
  }
}

export function createCliRuntime(store: HarnessSessionStore, options: { fallbackReason?: string } = {}): AgentRuntime {
  return new CliAgentRuntime(store, options.fallbackReason);
}
