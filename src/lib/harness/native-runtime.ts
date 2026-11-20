/**
 * The native AgentRuntime: the harness runs in-process through the vendored
 * boot host (`vendor/tooling/vendored-boot/native-host.mjs`), never as a
 * child process. Each turn boots a fresh cordis tree from the vendored
 * packages and disposes it afterwards — one turn, one tree, same NDJSON event
 * contract as the CLI.
 *
 * The host is loaded ONLY by dynamic import of a fully runtime-computed
 * `file://` URL. The import carries the `turbopackIgnore` magic comment
 * (documented in Next's bundled lazy-loading guide for exactly this case), so
 * the Turbopack dev runtime leaves the expression alone instead of rejecting
 * the computed URL ("Cannot find module as expression is too dynamic") or
 * statically tracing the vendored ESM/CJS/native-addon code. If the dynamic
 * import fails inside Next for any reason (bundling interception, native
 * addon load failure), the runtime does not break the HTTP path: it delegates
 * the turn to the CLI runtime (same store, so session persistence still
 * works) and healthCheck() reports the fallback and the underlying error.
 *
 * Concurrency: turns are serialized globally (one turn at a time across all
 * sessions) because the in-process host temporarily takes over
 * `process.stdout` to capture the run projection and the turn's tenant is
 * published through process.env (CYRAOPS_WORKSPACE_ID, read by the
 * cyraops-crm bridge during tool execution) — the same global mutex makes
 * both mutations safe. `cancelTurn` aborts the in-flight turn's signal; the
 * host tears the tree down and the iterator throws an AbortError.
 */

import { randomUUID } from "node:crypto";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { approvalBroker, type ApprovalDecidedInfo, type PendingApproval } from "./approval-broker";
import {
  questionBroker,
  type PendingQuestion,
  type QuestionDecidedInfo,
} from "./question-broker";
import type { HarnessEvent } from "./client";
import { CliAgentRuntime } from "./cli-runtime";
import { sessionIdOf } from "./events";
import {
  createEventQueue,
  HarnessRunError,
  isAbortError,
  vendoredTreePresent,
  type AgentRuntime,
  type RuntimeHealth,
  type Session,
} from "./runtime";
import { harnessPermissionPreset, systemToolsEnabled } from "@/lib/permissions/mode";
import type { PermissionMode } from "@/lib/permissions/mode";
import type { HarnessSessionStore } from "./store";

interface NativeHostModule {
  runNativeTask(options: {
    task: string;
    sessionId?: string;
    signal?: AbortSignal;
    timeoutMs?: number;
    projectRoot?: string;
    /**
     * Project-work harness (Phase A): the turn's sandbox workspace root
     * (server-resolved realpath). When set, the host pins the sandboxed
     * filesystem cwd, the sandbox-policy workspace root, and the session's
     * recorded working directory to it for this turn.
     */
    workspaceRoot?: string;
    approvalPolicy?: "ask" | "never";
    /** Harness permission preset name ("read-only" | "workspace-write" | "danger-full-access"). */
    permissionMode?: string;
    /** SYSTEM permission mode re-enables the harness system tools. */
    systemTools?: boolean;
    /** Tier-2 plan preview: "on" | "off" runs the turn as a plan-mode turn. */
    planMode?: "on" | "off";
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
    // turbopackIgnore: the Turbopack dev runtime must skip bundling this
    // import and leave it as a native runtime Node import of the computed
    // file URL (without the comment it rejects computed URLs with "Cannot
    // find module as expression is too dynamic"). In a plain Node process
    // the comment is inert and the import resolves in milliseconds.
    const importing = import(/* turbopackIgnore: true */ url).then((mod) => mod as NativeHostModule);
    // Bound the wait so the HTTP path falls back to the CLI runtime instead
    // of hanging; the reason surfaces in healthCheck(). In a plain Node
    // process (and a runtime that leaves import() native) this resolves in
    // milliseconds and the in-process path serves the turn.
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
  /**
   * Project-work harness (Phase A): the workspace root each conversation's
   * harness session was created under (keyed like the store: tenant + "\0" +
   * conversation). A turn whose root differs starts a fresh harness session —
   * the harness refuses to resume a session whose recorded cwd differs from
   * the boot cwd, and silently resuming under the wrong root would be worse.
   */
  private readonly sessionBootRoots = new Map<string, string | null>();

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

  async *executeTurn(input: {
    sessionId: string;
    task: string;
    signal?: AbortSignal;
    workspaceId?: string | null;
    workspaceRoot?: string | null;
    permissionMode?: PermissionMode;
    model?: string | null;
    planMode?: "on" | "off";
  }): AsyncIterable<HarnessEvent> {
    const session = this.sessions.get(input.sessionId);
    if (!session) throw new Error(`unknown harness session: ${input.sessionId}`);

    const controller = this.controllers.get(input.sessionId);
    const signal = input.signal ?? controller?.signal;
    const queue = createEventQueue<HarnessEvent>();
    const events: HarnessEvent[] = [];

    const run = this.turnChain
      .catch(() => undefined)
      .then(() =>
        this.runTurn(
          session,
          input.task,
          input.workspaceId ?? null,
          input.workspaceRoot ?? null,
          input.permissionMode,
          input.planMode,
          input.model,
          signal,
          queue,
          events
        )
      );
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
    workspaceId: string | null,
    workspaceRoot: string | null,
    permissionMode: PermissionMode | undefined,
    planMode: "on" | "off" | undefined,
    model: string | null | undefined,
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

    // Project-work harness (Phase A): a conversation whose project root
    // changed (set, changed, or cleared) must not resume the harness session
    // created under the old root — the harness's own adoptability check
    // rejects a session whose recorded cwd differs from the boot cwd. A fresh
    // session boots cleanly under the new root; the old one is abandoned.
    const bootKey = `${session.tenantId}\u0000${session.conversationId}`;
    if (harnessSessionId) {
      const bootedUnder = this.sessionBootRoots.get(bootKey);
      if (bootedUnder !== undefined && bootedUnder !== workspaceRoot) {
        console.info(
          `[native-runtime] workspace root changed for conversation ${session.conversationId} ` +
            `(${bootedUnder ?? "none"} -> ${workspaceRoot ?? "none"}); starting a fresh harness session`
        );
        harnessSessionId = null;
        session.harnessSessionId = null;
      }
    }
    // Record the root this turn boots under BEFORE the boot, so the guard
    // above sees the true boot root even when the turn fails mid-boot.
    this.sessionBootRoots.set(bootKey, workspaceRoot);

    try {
      let host: NativeHostModule;
      try {
        host = await loadNativeHost();
      } catch {
        // Next/Turbopack (or a missing addon) blocked the in-process host:
        // serve the turn through the CLI runtime instead of failing the route.
        await this.runTurnViaCli(session, task, workspaceId, workspaceRoot, permissionMode, model, signal, queue, events);
        return;
      }

      // Tenant scoping: the harness plugin reads CYRAOPS_WORKSPACE_ID from
      // process.env when a tool executes. The global turn mutex (turnChain)
      // guarantees no two turns interleave, so setting the variable for the
      // duration of this turn cannot leak into a concurrent turn. Restored in
      // finally so later turns (and any other reader) see the prior value.
      const previousWorkspace = process.env.CYRAOPS_WORKSPACE_ID;
      if (workspaceId) process.env.CYRAOPS_WORKSPACE_ID = workspaceId;
      else delete process.env.CYRAOPS_WORKSPACE_ID;

      // Permission mapping: the cyraops-crm plugin's ask gate and the harness
      // sandbox policy read DSH_PERMISSION_MODE / --permission-mode. Set per
      // turn under the same global mutex so concurrent turns can never see
      // another tenant's mode; restored below with CYRAOPS_WORKSPACE_ID.
      const preset = permissionMode ? harnessPermissionPreset(permissionMode) : undefined;
      const previousPermissionMode = process.env.DSH_PERMISSION_MODE;
      if (preset) process.env.DSH_PERMISSION_MODE = preset;
      else delete process.env.DSH_PERMISSION_MODE;

      // Model override (Settings → Permissions → Model): published as
      // HARNESS_MODEL for the duration of this turn under the same global
      // mutex so the audit/cost layer names the selected model. null/absent
      // removes it so the harness keeps its configured default.
      const previousModel = process.env.HARNESS_MODEL;
      if (model) process.env.HARNESS_MODEL = model;
      else delete process.env.HARNESS_MODEL;
      console.info(`[native-runtime] effective model: ${model ?? "harness default (null)"}`);

      // Approval events: the plugin's answerer publishes requests on the
      // broker (same process); forward them into this turn's event stream as
      // synthetic harness events so bot-stream can relay them over SSE.
      const broker = approvalBroker();
      const forwardRequest = (pending: PendingApproval) => {
        queue.push({
          type: "approval",
          approvalId: pending.approvalId,
          toolName: pending.toolName,
          summary: pending.summary,
          ...(pending.callId ? { callId: pending.callId } : {}),
          ...(pending.reason ? { reason: pending.reason } : {}),
        });
      };
      const forwardDecided = (info: ApprovalDecidedInfo) => {
        queue.push({
          type: "approval_decided",
          approvalId: info.approvalId,
          outcome: info.outcome,
          timedOut: info.timedOut,
        });
      };
      const stopRequest = broker.onRequest(forwardRequest);
      const stopDecided = broker.onDecided(forwardDecided);

      // Ask-user events: the plugin's question answerer publishes each
      // ask_user_question batch on the question broker (same process); forward
      // them into this turn's event stream as synthetic harness events so
      // bot-stream can relay them over SSE ({ type: "question" }).
      const qBroker = questionBroker();
      const forwardQuestion = (pending: PendingQuestion) => {
        queue.push({
          type: "question",
          questionId: pending.questionId,
          text: pending.text,
          questions: pending.questions,
          ...(pending.callId ? { callId: pending.callId } : {}),
        });
      };
      const forwardQuestionDecided = (info: QuestionDecidedInfo) => {
        queue.push({
          type: "question_decided",
          questionId: info.questionId,
          timedOut: info.timedOut,
        });
      };
      const stopQuestion = qBroker.onRequest(forwardQuestion);
      const stopQuestionDecided = qBroker.onDecided(forwardQuestionDecided);

      try {
        for await (const event of host.runNativeTask({
          task,
          sessionId: harnessSessionId ?? undefined,
          signal,
          projectRoot: process.cwd(),
          // Project-work harness (Phase A): the conversation's project root
          // (server-resolved realpath, already owner-gated upstream) pins the
          // turn's sandbox: fs-sandbox cwd, sandbox-policy workspace root and
          // the session's recorded working directory all resolve to it, so
          // the model's tools operate under that root for exactly this turn.
          // Unset = CRM mode: the repo root stays the sandbox, as before.
          workspaceRoot: workspaceRoot ?? undefined,
          // The write tool's ask must reach an answerer; the plugin's broker
          // answerer fails closed when no decision arrives in time.
          approvalPolicy: "ask",
          // Permission mapping: the preset for this turn (the plugin gate and
          // the harness sandbox policy both read it), and SYSTEM re-enables
          // the harness system tools the profile patch otherwise disables.
          permissionMode: preset,
          systemTools: permissionMode ? systemToolsEnabled(permissionMode) : false,
          // Plan-mode turns (Tier-2 plan preview): the "/plan" chat surface
          // drives the turn as a plan-mode turn; the review arrives through
          // the question broker the runtime already subscribes to below.
          planMode,
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
      } finally {
        stopRequest();
        stopDecided();
        stopQuestion();
        stopQuestionDecided();
        if (previousWorkspace === undefined) delete process.env.CYRAOPS_WORKSPACE_ID;
        else process.env.CYRAOPS_WORKSPACE_ID = previousWorkspace;
        if (previousPermissionMode === undefined) delete process.env.DSH_PERMISSION_MODE;
        else process.env.DSH_PERMISSION_MODE = previousPermissionMode;
        if (previousModel === undefined) delete process.env.HARNESS_MODEL;
        else process.env.HARNESS_MODEL = previousModel;
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
    workspaceId: string | null,
    workspaceRoot: string | null,
    permissionMode: PermissionMode | undefined,
    model: string | null | undefined,
    signal: AbortSignal | undefined,
    queue: ReturnType<typeof createEventQueue<HarnessEvent>>,
    events: HarnessEvent[]
  ): Promise<void> {
    const delegate = (this.cliDelegate ??= new CliAgentRuntime(this.store));
    const delegateId = this.delegateSessions.get(session.id);
    let delegateSession = delegateId ? await delegate.getSession(delegateId) : null;
    if (!delegateSession) {
      delegateSession = await delegate.createSession({
        tenantId: session.tenantId,
        conversationId: session.conversationId,
      });
      this.delegateSessions.set(session.id, delegateSession.id);
    }
    for await (const event of delegate.executeTurn({
      sessionId: delegateSession.id,
      task,
      signal,
      workspaceId,
      workspaceRoot,
      permissionMode,
      model,
    })) {
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
