/**
 * The native AgentRuntime: the harness runs in-process through the vendored
 * boot host (`vendor/tooling/vendored-boot/native-host.mjs`), never as a
 * child process. Each turn boots a fresh cordis tree from the vendored
 * packages and disposes it afterwards — one turn, one tree, same NDJSON event
 * contract as the CLI.
 *
 * The host is loaded ONLY by dynamic import with a fully runtime-computed
 * `file://` URL, so Next/Turbopack never statically bundles (or type-checks)
 * the vendored ESM/CJS/native-addon code. If the dynamic import fails inside
 * Next for any reason (bundling interception, native addon load failure), the
 * runtime does not break the HTTP path: it delegates the turn to the CLI
 * runtime (same store, so session persistence still works) and healthCheck()
 * reports the fallback and the underlying error.
 *
 * Concurrency: turns are serialized globally (one turn at a time across all
 * sessions) because the in-process host temporarily takes over
 * `process.stdout` to capture the run projection. `cancelTurn` aborts the
 * in-flight turn's signal; the host tears the tree down and the iterator
 * throws an AbortError.
 */

import { randomUUID } from "node:crypto";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import type { HarnessEvent } from "./client";
import { CliAgentRuntime } from "./cli-runtime";
import { sessionIdOf } from "./events";
import {
  abortError,
  createEventQueue,
  HarnessRunError,
  isAbortError,
  vendoredTreePresent,
  type AgentRuntime,
  type RuntimeHealth,
  type Session,
} from "./runtime";
import type { HarnessSessionStore } from "./store";

interface NativeHostModule {
  runNativeTask(options: {
    task: string;
    sessionId?: string;
    signal?: AbortSignal;
    timeoutMs?: number;
    projectRoot?: string;
    onLog?: (message: string) => void;
  }): AsyncIterable<HarnessEvent>;
}

let hostModule: Promise<NativeHostModule> | null = null;
let hostLoadError: Error | null = null;

function hostLoadTimeoutMs(): number {
  const value = Number(process.env.HARNESS_NATIVE_LOAD_TIMEOUT_MS);
  return Number.isFinite(value) && value > 0 ? value : 30_000;
}

function loadNativeHost(): Promise<NativeHostModule> {
  if (hostLoadError) return Promise.reject(hostLoadError);
  if (!hostModule) {
    const url = pathToFileURL(join(process.cwd(), "vendor", "tooling", "vendored-boot", "native-host.mjs")).href;
    const importing = import(url).then((mod) => mod as NativeHostModule);
    // A bundler runtime (Turbopack dev) intercepts dynamic import() and either
    // hangs or rejects computed file URLs ("Cannot find module as expression
    // is too dynamic"). Bound the wait so the HTTP path falls back to the CLI
    // runtime instead of hanging; the reason surfaces in healthCheck(). In a
    // plain Node process (and a runtime that leaves import() native) this
    // resolves in milliseconds and the in-process path serves the turn.
    hostModule = new Promise<NativeHostModule>((resolve, reject) => {
      const timer = setTimeout(() => {
        const timeoutMs = hostLoadTimeoutMs();
        hostLoadError = new Error(
          `loading ${url} did not settle within ${timeoutMs}ms (intercepted by the Next.js dev runtime?); turns are served by the CLI runtime`
        );
        hostModule = null;
        reject(hostLoadError);
      }, hostLoadTimeoutMs());
      importing.then(
        (mod) => {
          clearTimeout(timer);
          resolve(mod);
        },
        (error) => {
          clearTimeout(timer);
          hostModule = null;
          hostLoadError = error instanceof Error ? error : new Error(String(error));
          reject(hostLoadError);
        }
      );
    });
    importing.catch(() => undefined); // keep the un-timed-out original handled
  }
  return hostModule;
}

export class NativeAgentRuntime implements AgentRuntime {
  private readonly sessions = new Map<string, Session>();
  private readonly controllers = new Map<string, AbortController>();
  /** Global mutex: one in-process turn at a time (host owns stdout while running). */
  private turnChain: Promise<unknown> = Promise.resolve();
  /** CLI fallback when the native host cannot be loaded in this process. */
  private cliDelegate: CliAgentRuntime | null = null;
  private readonly delegateSessions = new Map<string, string>();

  constructor(private readonly store: HarnessSessionStore) {}

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
    const events: HarnessEvent[] = [];

    const run = this.turnChain.catch(() => undefined).then(() => this.runTurn(session, input.task, signal, queue, events));
    this.turnChain = run.catch(() => undefined);

    try {
      yield* queue;
      await run; // rethrows engine failures, including HarnessRunError/AbortError
    } finally {
      // nothing to clean up; the host restores its state in its own finally
    }
  }

  private async runTurn(
    session: Session,
    task: string,
    signal: AbortSignal | undefined,
    queue: ReturnType<typeof createEventQueue<HarnessEvent>>,
    events: HarnessEvent[]
  ): Promise<void> {
    let harnessSessionId = session.harnessSessionId;
    if (!harnessSessionId) {
      harnessSessionId = await this.store.loadHarnessSessionId({
        tenantId: session.tenantId,
        conversationId: session.conversationId,
      });
    }

    try {
      let host: NativeHostModule;
      try {
        host = await loadNativeHost();
      } catch {
        // Next/Turbopack (or a missing addon) blocked the in-process host:
        // serve the turn through the CLI runtime instead of failing the route.
        await this.runTurnViaCli(session, task, signal, queue, events);
        return;
      }

      try {
        for await (const event of host.runNativeTask({
          task,
          sessionId: harnessSessionId ?? undefined,
          signal,
          projectRoot: process.cwd(),
          onLog: (message) => process.stderr.write(`[native-host] ${message}\n`),
        })) {
          events.push(event);
          queue.push(event);
        }
      } catch (error) {
        if (isAbortError(error) || error instanceof HarnessRunError) throw error;
        const details = error as { code?: number | null; stderr?: string; timedOut?: boolean; sessionId?: string | null };
        throw new HarnessRunError(
          error instanceof Error ? `The in-process harness turn failed: ${error.message}` : "The in-process harness turn failed.",
          {
            code: details.code,
            stderr: details.stderr,
            timedOut: details.timedOut,
            sessionId: details.sessionId,
          }
        );
      }
    } finally {
      queue.close();
    }

    const announced = sessionIdOf(events);
    if (announced) {
      session.harnessSessionId = announced;
      await this.store.saveHarnessSessionId({
        tenantId: session.tenantId,
        conversationId: session.conversationId,
        harnessSessionId: announced,
      });
    }
  }

  /** Turn served by the CLI runtime because the native host is unavailable. */
  private async runTurnViaCli(
    session: Session,
    task: string,
    signal: AbortSignal | undefined,
    queue: ReturnType<typeof createEventQueue<HarnessEvent>>,
    events: HarnessEvent[]
  ): Promise<void> {
    const delegate = (this.cliDelegate ??= new CliAgentRuntime(this.store));
    let delegateId = this.delegateSessions.get(session.id);
    let delegateSession = delegateId ? await delegate.getSession(delegateId) : null;
    if (!delegateSession) {
      delegateSession = await delegate.createSession({
        tenantId: session.tenantId,
        conversationId: session.conversationId,
      });
      this.delegateSessions.set(session.id, delegateSession.id);
    }
    for await (const event of delegate.executeTurn({ sessionId: delegateSession.id, task, signal })) {
      events.push(event);
      queue.push(event);
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
    const delegateId = this.delegateSessions.get(sessionId);
    if (delegateId) {
      this.delegateSessions.delete(sessionId);
      await this.cliDelegate?.closeSession(delegateId);
    }
  }

  async healthCheck(): Promise<RuntimeHealth> {
    const root = process.cwd();
    if (!vendoredTreePresent(root)) {
      return {
        available: false,
        kind: "native",
        reason: `vendored harness tree not found under ${join(root, "vendor", "dsh")}`,
      };
    }
    if (hostLoadError) {
      return {
        available: true,
        kind: "cli",
        reason: `native host could not be loaded in this process (${hostLoadError.message}); turns are served by the CLI runtime`,
      };
    }
    return { available: true, kind: "native" };
  }
}

export function createNativeRuntime(store: HarnessSessionStore): AgentRuntime {
  return new NativeAgentRuntime(store);
}
