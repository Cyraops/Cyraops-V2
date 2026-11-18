/**
 * The AgentRuntime adapter: one stable seam between Cyraops V2 and the
 * DeepSeek Harness, with two interchangeable engines behind it.
 *
 * - `cli` (default): the existing one-task-per-process spawn of `dsh`
 *   (`cli-runtime.ts` / `client.ts`) — today's behaviour, kept verbatim.
 * - `native`: an in-process cordis boot served entirely from the vendored
 *   tree (`native-runtime.ts` / `vendor/tooling/vendored-boot/native-host.mjs`).
 * - `none`: the harness is switched off; healthCheck reports it.
 *
 * Selection is by `HARNESS_RUNTIME` (`cli` | `native` | `none`). When
 * `native` is requested but the vendored tree is missing, the factory falls
 * back to the CLI runtime and records the reason so `healthCheck()` can
 * surface it.
 */

import { existsSync } from "node:fs";
import { join } from "node:path";
import type { HarnessEvent } from "./client";
import { createCliRuntime } from "./cli-runtime";
import { createNativeRuntime } from "./native-runtime";
import { createPrismaSessionStore, type HarnessSessionStore } from "./store";
import type { PermissionMode } from "@/lib/permissions/mode";

export type { HarnessEvent };

export interface Session {
  /** Adapter-level session id; the value the API hands back and accepts. */
  id: string;
  /** Owning tenant (Cyraops user id); every store access is scoped by it. */
  tenantId: string;
  /** The conversation this session belongs to (AiConversation id, or a synthetic key). */
  conversationId: string;
  /** The harness's own durable session id; null until the first turn announces one. */
  harnessSessionId: string | null;
}

export interface RuntimeHealth {
  available: boolean;
  kind: "native" | "cli" | "none";
  reason?: string;
}

export interface AgentRuntime {
  createSession(input: { tenantId: string; conversationId: string }): Promise<Session>;
  executeTurn(input: {
    sessionId: string;
    task: string;
    signal?: AbortSignal;
    /** The turn's workspace/tenant key (conversation owner id); scopes the CRM tools. */
    workspaceId?: string | null;
    /**
     * The caller's unified permission mode, already role-gated. Mapped onto
     * DSH_PERMISSION_MODE (native: per-turn env under the global mutex; cli:
     * per-spawn env + --permission-mode) and, for SYSTEM, onto the
     * system-tools mount decision.
     */
    permissionMode?: PermissionMode;
    /**
     * Plan-mode switch for this turn ("on" | "off"): the native runtime runs
     * the turn as a plan-mode turn (the model presents its plan through
     * exit_plan_mode for review before executing). Only the native runtime
     * implements it; other runtimes ignore it (the "/plan" chat surface is
     * native-only).
     */
    planMode?: "on" | "off";
  }): AsyncIterable<HarnessEvent>;
  getSession(sessionId: string): Promise<Session | null>;
  cancelTurn(input: { sessionId: string }): Promise<void>;
  closeSession(sessionId: string): Promise<void>;
  healthCheck(): Promise<RuntimeHealth>;
}

/**
 * A turn that failed at the engine level (spawn failure, non-zero exit,
 * timeout). Carries the engine diagnostics the route turns into a 502.
 */
export class HarnessRunError extends Error {
  readonly details: { code?: number | null; stderr?: string; timedOut?: boolean; sessionId?: string | null };

  constructor(
    message: string,
    details: { code?: number | null; stderr?: string; timedOut?: boolean; sessionId?: string | null } = {}
  ) {
    super(message);
    this.name = "HarnessRunError";
    this.details = details;
  }
}

export function isAbortError(error: unknown): boolean {
  return (
    (error instanceof Error && error.name === "AbortError") ||
    (typeof error === "object" && error !== null && (error as { name?: unknown }).name === "AbortError")
  );
}

/** The DOMException-based error thrown by every runtime on cancellation. */
export function abortError(message = "The turn was cancelled"): Error {
  const error = typeof DOMException === "function" ? new DOMException(message, "AbortError") : new Error(message);
  Object.defineProperty(error, "name", { value: "AbortError", configurable: true, writable: true });
  return error;
}

/** True when the committed vendored tree and its native host launcher exist. */
export function vendoredTreePresent(treeRoot: string): boolean {
  return (
    existsSync(join(treeRoot, "vendor", "dsh", "package.json")) &&
    existsSync(join(treeRoot, "vendor", "tooling", "vendored-boot", "native-host.mjs"))
  );
}

export type RuntimeKind = "native" | "cli" | "none";

/** HARNESS_RUNTIME → runtime kind; unknown values keep the safe default (`cli`). */
export function requestedRuntimeKind(env?: NodeJS.ProcessEnv): RuntimeKind {
  const value = (env ?? process.env).HARNESS_RUNTIME?.trim().toLowerCase() || "cli";
  if (value === "native") return "native";
  if (value === "none") return "none";
  return "cli";
}

/**
 * Build the runtime for a kind. `treeRoot` is the directory whose `vendor/dsh`
 * tree would serve the native path (the factory passes `process.cwd()`; tests
 * pass a fake root to exercise the fallback without touching the real tree).
 */
export function createRuntime(kind: RuntimeKind, treeRoot: string, store: HarnessSessionStore): AgentRuntime {
  switch (kind) {
    case "native": {
      if (vendoredTreePresent(treeRoot)) return createNativeRuntime(store);
      return createCliRuntime(store, {
        fallbackReason:
          `HARNESS_RUNTIME=native requested, but the vendored harness tree was not found under ` +
          `${join(treeRoot, "vendor", "dsh")} (or its native host launcher is missing); ` +
          `falling back to the CLI runtime.`,
      });
    }
    case "none":
      return createDisabledRuntime();
    default:
      return createCliRuntime(store);
  }
}

/** The one store instance all runtimes and the route share. */
let defaultStore: HarnessSessionStore | null = null;
export function harnessSessionStore(): HarnessSessionStore {
  return (defaultStore ??= createPrismaSessionStore());
}

export function runtimeFactory(env?: NodeJS.ProcessEnv): AgentRuntime {
  return createRuntime(requestedRuntimeKind(env), process.cwd(), harnessSessionStore());
}

/** A small push queue bridging producers to AsyncIterable consumers. */
export interface EventQueue<T> extends AsyncIterable<T> {
  push(value: T): void;
  close(): void;
}

/**
 * A small push queue bridging producer callbacks (spawn events, in-process
 * NDJSON lines) to an AsyncIterable consumer. `push` after `close` is a no-op;
 * iterating ends when the queue is closed and drained.
 */
export function createEventQueue<T>(): EventQueue<T> {
  const items: T[] = [];
  const waiters: Array<() => void> = [];
  let closed = false;
  return {
    push(value: T) {
      if (closed) return;
      items.push(value);
      waiters.shift()?.();
    },
    close() {
      closed = true;
      while (waiters.length > 0) waiters.shift()?.();
    },
    async *[Symbol.asyncIterator](): AsyncIterator<T> {
      while (true) {
        if (items.length > 0) {
          yield items.shift() as T;
          continue;
        }
        if (closed) return;
        await new Promise<void>((resolve) => waiters.push(resolve));
      }
    },
  };
}

/** HARNESS_RUNTIME=none: sessions exist, turns are refused, health says so. */
function createDisabledRuntime(): AgentRuntime {
  const sessions = new Map<string, Session>();
  return {
    async createSession({ tenantId, conversationId }) {
      const id = crypto.randomUUID();
      const session: Session = { id, tenantId, conversationId, harnessSessionId: null };
      sessions.set(id, session);
      return session;
    },
    async *executeTurn() {
      throw new HarnessRunError("The harness runtime is disabled (HARNESS_RUNTIME=none).");
    },
    async getSession(sessionId) {
      return sessions.get(sessionId) ?? null;
    },
    async cancelTurn() {},
    async closeSession(sessionId) {
      sessions.delete(sessionId);
    },
    async healthCheck() {
      return { available: false, kind: "none" } satisfies RuntimeHealth;
    },
  };
}
