/**
 * native-host.mjs — the reusable in-process DeepSeek Harness boot host.
 *
 * All package resolution is served from the vendored tree:
 *
 *     vendor/dsh/                       (installation anchor + node_modules)
 *     vendor/tooling/vendored-boot/     (this file + the scratch profile)
 *
 * Nothing is imported from the global distribution install. The boot
 * primitives (dsh-app-boot's loadLayeredEnv / loadProfileDirectory /
 * createRuntimeResolution / readProfilePatches / boot / PluginPackages,
 * dsh-cmdline's provideCmdline, dsh-launch-environment, dsh-home-paths,
 * dsh-http-proxy) all come from vendor/dsh/node_modules.
 *
 * Public surface:
 *
 *   export async function* runNativeTask({
 *     task,              // required, non-empty string
 *     sessionId,         // optional harness durable session id (resume)
 *     signal,            // optional AbortSignal; abort tears the tree down
 *     timeoutMs = 180000,
 *     projectRoot = process.cwd(),   // env layer (DeepSeek key) + task cwd
 *     profileDir, vendorRoot, installAnchor, // defaults below
 *     captureEvidence = false,       // record every resolution (one-shot diagnostics)
 *     tee = "diagnostics",           // "diagnostics" forwards non-NDJSON stdout
 *                                    // lines to the real stdout; "all" forwards
 *                                    // everything (evidence runs)
 *     approvalPolicy = "never",      // session approval policy passed as
 *                                    // --approval-policy; "ask" lets tools that
 *                                    // declare an ask gate consult answerers
 *     permissionMode,                // optional permission preset name
 *                                    // ("read-only" | "workspace-write" |
 *                                    // "danger-full-access") passed as
 *                                    // --permission-mode
 *     systemTools = false,           // true (SYSTEM permission mode) skips the
 *                                    // profile patch rows that disable
 *                                    // tool-bash/tool-fs/tool-fs-search
 *     planMode,                      // "on" | "off": a plan-mode turn, driven
 *                                    // directly (the one-shot runner row is
 *                                    // disabled for this boot; the task may
 *                                    // be empty for a bare switch). "on"
 *                                    // enters plan mode before the turn; the
 *                                    // finished plan surfaces as the
 *                                    // exit_plan_mode tool call and its
 *                                    // review through the user-questions
 *                                    // waterfall (the cyraops-crm answerer
 *                                    // bridges it to the question broker).
 *     log = (m) => process.stderr.write(`[native-host] ${m}\n`),
 *   } = {}) : AsyncIterable<HarnessEvent>
 *
 * One call = one headless turn: boot a fresh cordis tree, run the task through
 * the same `--json` NDJSON projection the CLI emits, yield the parsed events
 * (identical shapes to src/lib/harness/events.ts), append a synthetic `final`
 * event when the projection produced none, throw an error carrying
 * { code, stderr, timedOut } on non-zero exit, and dispose the tree in every
 * path (completion, timeout, abort, consumer break).
 *
 * While a turn runs, this host temporarily captures process.stdout to harvest
 * the NDJSON projection (and tees process.stderr into a tail kept for error
 * reports). Callers that run turns concurrently must serialize them — the
 * AgentRuntime adapter does.
 */

import fs from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { fileURLToPath, pathToFileURL } from "node:url";
import { performance } from "node:perf_hooks";
import { createRequire } from "node:module";

const HERE = fileURLToPath(new URL(".", import.meta.url));

/** The scratch profile the headless tree boots from. */
export const PROFILE_DIR = path.join(HERE, "profile");
/** The vendored harness tree root (installation anchor lives here). */
export const VENDOR = path.resolve(HERE, "..", "..", "dsh");
export const INSTALL_ANCHOR = path.join(VENDOR, "package.json");
export const ROOT_CONFIG = path.join(PROFILE_DIR, "cordis.yml");

/** The system tools the profile patch disables; SYSTEM permission mode re-enables them. */
const SYSTEM_TOOL_IDS = new Set(["tool-bash", "tool-fs", "tool-fs-search"]);

const vendoredPkg = (name) => path.join(VENDOR, "node_modules", name);
const DEFAULT_LOG = (message) => process.stderr.write(`[native-host] ${message}\n`);

/**
 * Ensure the CRM plugin bundle resolves inside the profile's node_modules.
 *
 * The scratch profile declares `@cyraops/harness-crm` as a bundle; dev
 * checkouts satisfy it through a gitignored symlink
 * (`profile/node_modules/@cyraops/harness-crm` -> the project's
 * `src/lib/harness/plugins/cyraops-crm`), which is convenient for local edits
 * but does not survive a build context where that link is absent or dangling
 * (fresh clone, container). The production Docker image installs a real copy
 * (see the Dockerfile); this fallback materializes the same real copy from
 * the project source when the entry is missing or dangling, so the profile
 * can never silently skip the bundle.
 *
 * A resolvable entry (the dev symlink, or an already-installed copy) is left
 * untouched.
 */
function ensureCrmBundle({ profileDir, projectRoot, log }) {
  const entry = path.join(profileDir, "node_modules", "@cyraops", "harness-crm");
  const source = path.join(projectRoot, "src", "lib", "harness", "plugins", "cyraops-crm");
  let usable = false;
  try {
    usable = fs.existsSync(fs.realpathSync(entry));
  } catch {
    // missing or dangling entry: materialize below
  }
  if (!usable) {
    try {
      fs.rmSync(entry, { recursive: true, force: true });
      fs.mkdirSync(path.dirname(entry), { recursive: true });
      fs.cpSync(source, entry, { recursive: true });
      log(`crm bundle materialized: ${source} -> ${entry}`);
    } catch (error) {
      throw new Error(
        `crm bundle is unavailable (${error instanceof Error ? error.message : String(error)})`
      );
    }
  }
  return entry;
}

// ---------------------------------------------------------------------------
// Boot primitives, all from the vendored tree (absolute file URLs so the
// import itself can never fall back to the distribution install).
//
// The primitives are loaded lazily (not at module top level) so this module
// has NO top-level await: bundler runtimes that reject dynamic `import()` of
// computed URLs (Turbopack: "Cannot find module as expression is too
// dynamic") can then load this module through Node's `require(esm)` support.
// Each load step logs to stderr so a loader-level hang is distinguishable
// from a hang inside the vendored code.
// ---------------------------------------------------------------------------
const importLog = (message) => process.stderr.write(`[native-host-import] ${message}\n`);
importLog(`module body entered (${import.meta.url})`);

let primitivesPromise = null;
function loadPrimitives() {
  if (!primitivesPromise) {
    primitivesPromise = (async () => {
      const appBoot = await import(`${vendoredPkg("@deepseek-ai/dsh-app-boot")}/lib/index.js`);
      importLog("dsh-app-boot imported");
      const {
        loadLayeredEnv,
        loadProfileDirectory,
        createRuntimeResolution,
        readProfilePatches,
        boot,
        PluginPackages,
      } = appBoot;
      const { provideCmdline } = await import(`${vendoredPkg("@deepseek-ai/dsh-cmdline")}/lib/index.js`);
      importLog("dsh-cmdline imported");
      const { DSH_LAUNCH_ENVIRONMENT_KEY } = await import(
        `${vendoredPkg("@deepseek-ai/dsh-launch-environment")}/lib/index.js`
      );
      importLog("dsh-launch-environment imported");
      const { resolveDshHome } = await import(`${vendoredPkg("@deepseek-ai/dsh-home-paths")}/lib/index.js`);
      importLog("dsh-home-paths imported");
      const { installProxyFromEnvironment } = await import(
        `${vendoredPkg("@deepseek-ai/dsh-http-proxy")}/lib/index.js`
      );
      importLog("dsh-http-proxy imported; primitives ready");
      return {
        loadLayeredEnv,
        loadProfileDirectory,
        createRuntimeResolution,
        readProfilePatches,
        boot,
        PluginPackages,
        provideCmdline,
        DSH_LAUNCH_ENVIRONMENT_KEY,
        resolveDshHome,
        installProxyFromEnvironment,
      };
    })();
    primitivesPromise.catch(() => {
      primitivesPromise = null; // allow a later retry after a failed load
    });
  }
  return primitivesPromise;
}

// ---------------------------------------------------------------------------
// Event helpers (mirror src/lib/harness/events.ts parsing semantics).
// ---------------------------------------------------------------------------

/** Parse one NDJSON line into a harness event; null for blank/diagnostic lines. */
export function parseEventLine(line) {
  const trimmed = line.trim();
  if (!trimmed) return null;
  try {
    const parsed = JSON.parse(trimmed);
    return typeof parsed?.type === "string" ? parsed : null;
  } catch {
    return null;
  }
}

function finalTextOfEvents(events) {
  for (let i = events.length - 1; i >= 0; i -= 1) {
    if (events[i].type === "final" && typeof events[i].text === "string") return events[i].text;
  }
  for (let i = events.length - 1; i >= 0; i -= 1) {
    if (events[i].type === "text" && typeof events[i].text === "string" && events[i].text) {
      return events[i].text;
    }
  }
  return "";
}

function announcedSessionIdOf(events) {
  for (const event of events) {
    if (event.type === "session" && typeof event.sessionId === "string" && event.sessionId) {
      return event.sessionId;
    }
  }
  return undefined;
}

function syntheticFinal(events, fallbackSessionId, code) {
  return {
    type: "final",
    sessionId: announcedSessionIdOf(events) ?? fallbackSessionId ?? null,
    text: finalTextOfEvents(events),
    reason: { kind: code === 0 ? "completed" : "failed" },
  };
}

function makeRunError(message, details) {
  const error = new Error(message);
  error.name = "HarnessRunError";
  Object.assign(error, details);
  return error;
}

export function makeAbortError(message = "The turn was cancelled") {
  const error = typeof DOMException === "function" ? new DOMException(message, "AbortError") : new Error(message);
  if (error instanceof Error) {
    // Plain assignment fails in strict mode (this module is ESM): the
    // DOMException prototype's `name` is a getter-only accessor. Define an
    // own property instead (mirrors abortError in src/lib/harness/runtime.ts).
    Object.defineProperty(error, "name", { value: "AbortError", configurable: true, writable: true });
  }
  return error;
}

function makeTimeoutError(ms) {
  return makeRunError(`The in-process harness run timed out after ${ms}ms`, {
    code: null,
    stderr: "",
    timedOut: true,
  });
}

// ---------------------------------------------------------------------------
// Plan-mode turn support (Tier-2 plan preview).
//
// The vendored headless runner never enters plan mode (it has no /plan
// command adapter and never touches ctx.planMode), so a plan turn is driven
// here directly: the one-shot runner row is disabled for this boot, the agent
// is created/resumed with the SAME steps the runner takes (mirroring
// dsh-headless run()/resolveAgent), plan mode is switched on or off through
// the harness's own ctx.planMode service, and the task is driven to
// quiescence exactly like the runner — with the SAME NDJSON projector, so the
// event contract is identical (session/status/thinking/text/tool_call/
// tool_result/final).
//
// The finished plan then surfaces as the exit_plan_mode tool call's
// input.plan, and its review runs through the user-questions/request
// waterfall the cyraops-crm plugin bridges to the Next-side question broker
// (see scratch/tier2-plan-probe for the captured evidence).
// ---------------------------------------------------------------------------

let planPrimitivesPromise = null;
function loadPlanPrimitives() {
  if (!planPrimitivesPromise) {
    planPrimitivesPromise = (async () => {
      const { createUserMessage } = await import(`${vendoredPkg("@deepseek-ai/dsh-llm")}/lib/index.js`);
      const { installModelSelection } = await import(`${vendoredPkg("@deepseek-ai/dsh-agent")}/lib/index.js`);
      const { setApprovalPolicy } = await import(`${vendoredPkg("@deepseek-ai/dsh-user-approval")}/lib/index.js`);
      const { brandString } = await import(`${vendoredPkg("@deepseek-ai/dsh-brand")}/lib/index.js`);
      const { SessionSeq } = await import(`${vendoredPkg("@deepseek-ai/dsh-session")}/lib/index.js`);
      const jsonStream = await import(`${vendoredPkg("@deepseek-ai/dsh-headless")}/lib/json-stream-Dc3g2Bl1.js`);
      return {
        createUserMessage,
        installModelSelection,
        setApprovalPolicy,
        brandString,
        SessionSeq,
        projectJsonRun: jsonStream.n,
      };
    })();
    planPrimitivesPromise.catch(() => {
      planPrimitivesPromise = null; // allow a later retry after a failed load
    });
  }
  return planPrimitivesPromise;
}

/** Iterate a live Session's durable events in order (mirrors dsh-headless). */
function* liveSessionEvents(session, SessionSeq) {
  const length = session.seq;
  for (let seq = 0; seq < length; seq++) {
    const event = session.eventAt(SessionSeq(seq));
    if (event === undefined) {
      throw new Error(`headless adoption cannot read seq ${String(seq)} below captured length ${String(length)}`);
    }
    yield event;
  }
}

/**
 * Reject a Session the one-shot driver must not adopt (mirrors the runner's
 * assertAdoptable): a preset the headless tree does not compose, a subagent
 * session, or a recorded cwd that differs from this process's project root.
 */
function assertPlanAdoptable(header, events, sessionId, cwd, SessionSeq) {
  let preset = header.agentPreset;
  for (const event of events) {
    if (event.type !== "agent-preset/selected") continue;
    const selected = event.data?.agentPreset;
    if (typeof selected !== "string" || selected === "") {
      throw new Error(`session "${sessionId}" records a malformed agent-preset/selected event and cannot be adopted`);
    }
    preset = selected;
  }
  if (preset !== undefined) {
    throw new Error(`session "${sessionId}" runs under agent preset "${preset}", which the one-shot runner does not compose`);
  }
  if (header.origin === "subagent") throw new Error(`session "${sessionId}" is a subagent session and cannot be driven directly`);
  if (header.cwd === undefined) throw new Error(`session "${sessionId}" recorded no working directory, so it cannot be adopted`);
  if (header.cwd !== cwd) throw new Error(`session "${sessionId}" was recorded in "${header.cwd}", not "${cwd}"`);
}

/**
 * Drive one plan-mode turn: create/resume the agent (runner steps), apply the
 * plan-mode switch, follow the task to quiescence, flush, and finish the
 * NDJSON projection. Returns the exit code (0 when the last observed turn
 * completed), exactly the runner's rule.
 */
async function drivePlanTurn({
  ctx,
  task,
  sessionId,
  projectRoot,
  planMode,
  approvalPolicy,
  permissionMode,
  registerCancel,
  log,
}) {
  const { createUserMessage, installModelSelection, setApprovalPolicy, brandString, SessionSeq, projectJsonRun } =
    await loadPlanPrimitives();

  const agents = ctx.get("agents");
  const defaultModel = ctx.get("agentDefaultModel");
  const sessions = ctx.get("sessions");
  const planModeService = ctx.get("planMode");
  if (agents === undefined || defaultModel === undefined || sessions === undefined) {
    throw new Error("plan mode requires the harness agents/agentDefaultModel/sessions services");
  }
  if (planModeService === undefined || typeof planModeService.set !== "function") {
    throw new Error("plan mode requires the harness plan-mode service (dsh-plan-mode is not mounted)");
  }
  if (approvalPolicy !== undefined && ctx.get("approval") === undefined) {
    throw new Error("headless --approval-policy requires the approval service");
  }
  const permissions = ctx.get("permissionPresets");
  if (permissionMode !== undefined) {
    if (permissions === undefined) throw new Error("headless --permission-mode requires the permissionPresets service");
    permissions.resolve(permissionMode);
  }
  const approval = ctx.get("approval");

  const selection = defaultModel.currentSelection();
  const agentOptions = { ...selection };
  const setup = (agentCtx, agent) => {
    if (sessionId !== undefined) {
      const previous = agent.model.current();
      const configured = { ...selection };
      if (
        configured.reasoningEffort === undefined &&
        previous !== undefined &&
        previous.provider === configured.provider &&
        previous.model === configured.model &&
        previous.reasoningEffort !== undefined
      ) {
        configured.reasoningEffort = previous.reasoningEffort;
      }
      agent.model.select(configured);
    }
    installModelSelection(agentCtx);
  };

  const cwd = projectRoot;
  let agent;
  if (sessionId === undefined) {
    const created = await agents.create({
      sessionId: brandString(`session-${randomUUID()}`),
      meta: { cwd },
      agentOptions,
      setup,
    });
    agent = created.agent;
  } else {
    // Mirrors the runner's resolveAgent: the session must exist on disk and
    // no agent may be live under it in this tree (a fresh tree guarantees it).
    if (ctx.get("sessionPersistence") === undefined) {
      throw new Error("headless --session-id requires the sessionPersistence service; the Session would not survive this process");
    }
    const query = ctx.get("sessionQuery");
    if (query === undefined) throw new Error("headless --session-id requires the sessionQuery service; dsh-base provides it");
    const live = agents.get(sessionId);
    if (live !== undefined) {
      throw new Error(`session "${sessionId}" is live in this process, so the one-shot runner cannot own an exclusive run interval`);
    }
    const observation = await query.observeSession(sessionId);
    assertPlanAdoptable(observation.header, observation.events, sessionId, cwd, SessionSeq);
    const resumed = await agents.resume({ resumeSessionId: sessionId, agentOptions, setup });
    agent = resumed.agent;
    assertPlanAdoptable(agent.session.header, liveSessionEvents(agent.session, SessionSeq), sessionId, cwd, SessionSeq);
  }
  registerCancel(() => agent.cancel({ kind: "disposed" }));
  await agent.whenIdle();
  if (sessionId !== undefined) {
    assertPlanAdoptable(agent.session.header, liveSessionEvents(agent.session, SessionSeq), sessionId, cwd, SessionSeq);
  }
  if (permissionMode !== undefined && permissions !== undefined) permissions.set(agent.session, permissionMode);
  if (approvalPolicy !== undefined && approval?.overrideOf(agent.session) !== approvalPolicy) {
    setApprovalPolicy(agent.session, approvalPolicy);
  }

  // The plan-mode switch (durable in the session log: it survives resume).
  planModeService.set(agent, planMode === "on");
  log(`plan mode set to ${planMode === "on" ? "active" : "inactive"} (session=${agent.session.id})`);

  const firstSeq = agent.session.seq;
  const projection = projectJsonRun(ctx, agent, process.stdout, { cwd });
  const subagents = ctx.get("subagents");
  let failure;
  const stopErrors = ctx.on("agent/error", ({ agent: subject, error }) => {
    if (subject === agent) failure = { error, atOffset: agent.session.seq };
  });
  const stopTerminals = ctx.on("session/event", (session, event) => {
    if (session === agent.session && event.type === "turn/end" && failure !== undefined && event.seq >= failure.atOffset) {
      failure = undefined;
    }
  });
  try {
    if (typeof task === "string" && task.trim() !== "") {
      agent.followup(createUserMessage({ content: [{ type: "text", text: task }], source: { kind: "user" } }));
      while (true) {
        await agent.whenIdle();
        const idleSeq = agent.session.seq;
        if (!(await subagents?.waitForChildren(agent)) && agent.status === "idle" && agent.session.seq === idleSeq) break;
      }
    }
  } finally {
    stopErrors();
    stopTerminals();
  }
  await sessions.flush(agent.session);
  if (failure !== undefined) throw failure.error;

  // summarize [firstSeq, seq): the last assistant text + the final turn reason
  // (mirrors dsh-headless summarize()).
  let started = false;
  let text = "";
  let reason;
  const length = agent.session.seq;
  for (let seq = firstSeq; seq < length; seq++) {
    const event = agent.session.eventAt(SessionSeq(seq));
    if (event === undefined) {
      throw new Error(`headless summary cannot read seq ${String(seq)} below captured length ${String(length)}`);
    }
    if (event.type === "turn/start") {
      started = true;
      reason = undefined;
      continue;
    }
    if (!started) continue;
    if (event.type === "assistant/message") {
      const joined = event.data.message.content
        .filter((block) => block.type === "text")
        .map((block) => block.text)
        .join("");
      if (joined !== "") text = joined;
    }
    if (event.type === "turn/end") reason = event.data.reason;
  }
  projection.finish(text, reason);
  // A bare switch ("/plan" / "/plan off") runs no model turn: the empty
  // outcome is a successful mode change, not a failed run.
  const bareSwitch = typeof task !== "string" || task.trim() === "";
  return reason?.kind === "completed" || bareSwitch ? 0 : 1;
}

/**
 * Build the CLI argument vector the headless runner receives. Exported so the
 * policy mapping (never by default, ask when the caller opts in) is unit
 * tested without booting a tree.
 *
 * @param options.task - the task text (appended last, as one argument).
 * @param options.sessionId - optional durable session id to resume.
 * @param options.approvalPolicy - "ask" | "never"; the headless runner maps it
 *   onto the session approval policy via setApprovalPolicy before the run.
 * @param options.permissionMode - optional harness permission preset name
 *   ("read-only" | "workspace-write" | "danger-full-access"); passed as
 *   --permission-mode so the preset's sandbox mode applies to the run.
 */
export function buildRunArgs({ task, sessionId, approvalPolicy = "never", permissionMode }) {
  const args = ["--json", "--approval-policy", approvalPolicy];
  if (permissionMode) args.push("--permission-mode", permissionMode);
  if (sessionId) args.push("--session-id", sessionId);
  // An empty task (a bare plan-mode switch) must not reach commander: the
  // startup parser rejects an empty task positional with a failing exit.
  if (typeof task === "string" && task.trim() !== "") args.push(task);
  return args;
}

// ---------------------------------------------------------------------------
// Stream capture: process.stdout is taken over for the duration of a turn so
// the `--json` projection can be harvested, and process.stderr is teed into a
// bounded tail for error reports.
// ---------------------------------------------------------------------------

function createLineQueue() {
  const items = [];
  const waiters = [];
  let closed = false;
  return {
    push(line) {
      if (closed) return;
      items.push(line);
      waiters.shift()?.();
    },
    close() {
      closed = true;
      while (waiters.length > 0) waiters.shift()();
    },
    async *lines() {
      while (true) {
        if (items.length > 0) {
          yield items.shift();
          continue;
        }
        if (closed) return;
        await new Promise((resolve) => waiters.push(resolve));
      }
    },
  };
}

function installStreamCapture({ tee, onLine }) {
  const realOut = process.stdout;
  const realErr = process.stderr;
  const realOutWrite = realOut.write.bind(realOut);
  const realErrWrite = realErr.write.bind(realErr);
  let outBuffer = "";
  let errTail = "";

  const asText = (chunk, encoding) => {
    if (typeof chunk === "string") return chunk;
    if (chunk instanceof Uint8Array) {
      return Buffer.from(chunk).toString(typeof encoding === "string" ? encoding : "utf8");
    }
    return null;
  };

  const handleLine = (line) => {
    if (line === "") return;
    const isHarness = parseEventLine(line) !== null;
    if (tee === "all" || !isHarness) realOutWrite(`${line}\n`);
    onLine(line);
  };

  const outWrite = function (chunk, encoding, callback) {
    const text = asText(chunk, encoding);
    if (text === null) return realOutWrite(chunk, encoding, callback);
    outBuffer += text;
    let index;
    while ((index = outBuffer.indexOf("\n")) >= 0) {
      const line = outBuffer.slice(0, index);
      outBuffer = outBuffer.slice(index + 1);
      handleLine(line);
    }
    if (typeof callback === "function") callback();
    return true;
  };

  const errWrite = function (chunk, encoding, callback) {
    const text = asText(chunk, encoding);
    if (text !== null) errTail = (errTail + text).slice(-4000);
    return realErrWrite(chunk, encoding, callback);
  };

  realOut.write = outWrite;
  realErr.write = errWrite;

  return {
    stderrTail: () => errTail,
    restore() {
      if (realOut.write === outWrite) realOut.write = realOutWrite;
      if (realErr.write === errWrite) realErr.write = realErrWrite;
      if (outBuffer !== "") {
        const line = outBuffer;
        outBuffer = "";
        handleLine(line);
      }
    },
  };
}

// ---------------------------------------------------------------------------
// Optional resolution-evidence capture (one-shot diagnostic runs: boot.mjs).
// Records every bare-specifier resolution and asserts nothing came from the
// distribution install. The CJS recorder is restored after disposal; the ESM
// recorder sits on top of PluginPackages' interception and is deliberately
// left for the one-shot process to exit.
// ---------------------------------------------------------------------------

export const EVIDENCE_KEY_PACKAGES = [
  "@deepseek-ai/dsh-headless",
  "@deepseek-ai/dsh-base",
  "@deepseek-ai/dsh-app-boot",
  "@deepseek-ai/cordis",
  "@deepseek-ai/dsh-cmdline",
  "@deepseek-ai/dsh-session",
  "@deepseek-ai/dsh-agent",
];

function createEvidenceRecorders({ vendorRoot, log }) {
  const BARE = /^(?:@[^/]+\/[^/]+|[^./@][^/]*)(?:\/.*)?$/;
  const recorded = new Map();
  const violations = [];

  const recordResolved = (specifier, resolvedPath) => {
    if (typeof specifier !== "string" || !BARE.test(specifier)) return;
    if (typeof resolvedPath !== "string" || resolvedPath.length === 0) return;
    if (!path.isAbsolute(resolvedPath)) return;
    if (!resolvedPath.startsWith(vendorRoot + path.sep) && resolvedPath !== vendorRoot) {
      violations.push({ specifier, resolvedPath });
      return;
    }
    if (!recorded.has(specifier)) recorded.set(specifier, new Set());
    recorded.get(specifier).add(resolvedPath);
  };

  let restoreCjs = () => {};
  let esmInstalled = false;

  const installCjs = async () => {
    // Install BEFORE boot() so PluginPackages captures this wrapper as its
    // underlying "original": every routed CJS resolution still passes through us.
    const Module = (await import("node:module")).default;
    const original = Module._resolveFilename;
    const wrapped = function (request, parent, isMain, options) {
      const filename = original.apply(this, arguments);
      recordResolved(request, filename);
      return filename;
    };
    Module._resolveFilename = wrapped;
    restoreCjs = () => {
      if (Module._resolveFilename === wrapped) Module._resolveFilename = original;
    };
    log("CJS _resolveFilename recorder installed");
  };

  const installEsm = () => {
    if (esmInstalled) return;
    esmInstalled = true;
    const vendorRequire = createRequire(`${vendoredPkg("@deepseek-ai/dsh-app-boot")}/lib/index.js`);
    const addon = vendorRequire("node-addon-require-builtin");
    const esm = addon.requireBuiltin("internal/modules/esm/loader").getOrInitializeCascadedLoader();
    const recordResult = (request, result) => {
      if (result && typeof result.url === "string" && result.url.startsWith("file:")) {
        const specifier = typeof request === "string" ? request : request?.specifier;
        recordResolved(specifier, fileURLToPath(result.url));
      }
    };
    const originalResolve = Reflect.get(esm, "resolve");
    if (typeof originalResolve === "function") {
      esm.resolve = async function (request, parent, attributes) {
        const result = await originalResolve.call(esm, request, parent, attributes);
        recordResult(request, result);
        return result;
      };
      log("ESM async resolve recorder installed (on top of PluginPackages interception)");
    }
    const originalSync = Reflect.get(esm, "resolveSync");
    if (typeof originalSync === "function") {
      esm.resolveSync = function (parent, request, ...rest) {
        const result = rest.length
          ? Reflect.apply(originalSync, esm, [parent, request, ...rest])
          : originalSync(parent, request);
        recordResult(request, result);
        return result;
      };
      log("ESM resolveSync recorder installed (on top of PluginPackages interception)");
    }
  };

  return {
    installCjs,
    installEsm,
    restoreCjs,
    summary() {
      const all = [];
      for (const [specifier, paths] of [...recorded].sort((a, b) => a[0].localeCompare(b[0]))) {
        for (const p of paths) all.push({ specifier, p });
      }
      return { recorded: all, violations };
    },
  };
}

// ---------------------------------------------------------------------------
// Launcher helpers (mirror the CLI's profile-boot runProfile steps).
// ---------------------------------------------------------------------------

function createAppReady() {
  let ready = false;
  const listeners = new Set();
  return {
    service: {
      onReady(listener) {
        if (ready) {
          listener();
          return () => {};
        }
        listeners.add(listener);
        return () => listeners.delete(listener);
      },
    },
    commit() {
      if (ready) return;
      ready = true;
      for (const listener of [...listeners]) listener();
      listeners.clear();
    },
  };
}

function withTimeout(promise, ms, label) {
  let timer;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Error(`${label} timed out after ${ms}ms`)), ms);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

// ---------------------------------------------------------------------------
// The turn runner.
// ---------------------------------------------------------------------------

export async function* runNativeTask(options = {}) {
  const {
    task,
    sessionId,
    signal,
    timeoutMs = 180_000,
    projectRoot = process.cwd(),
    profileDir = PROFILE_DIR,
    vendorRoot = VENDOR,
    installAnchor = INSTALL_ANCHOR,
    captureEvidence = false,
    tee = "diagnostics",
    log = DEFAULT_LOG,
    approvalPolicy = "never",
    permissionMode,
    systemTools = false,
    /**
     * "on" | "off" | undefined: run the turn as a plan-mode turn. "on" enters
     * plan mode for the session (the model explores, then presents the plan
     * through exit_plan_mode for review); "off" leaves it. Either way the
     * one-shot runner row is disabled for this boot and the turn is driven
     * directly (see drivePlanTurn). The task may be empty for a bare switch.
     */
    planMode,
  } = options;

  if (planMode === undefined && (typeof task !== "string" || task.trim() === "")) {
    throw new Error("runNativeTask: task must be a non-empty string");
  }
  if (planMode !== undefined && planMode !== "on" && planMode !== "off") {
    throw new Error("runNativeTask: planMode must be \"on\" or \"off\"");
  }

  // Cancellation promptness: a turn that is already aborted never boots a
  // tree (the host maps the abort to an immediate AbortError). Aborts that
  // land while the tree is running are handled by the race in step 4; an
  // abort that lands during boot is picked up by that same race once boot
  // completes.
  if (signal?.aborted) throw makeAbortError();

  const {
    loadLayeredEnv,
    loadProfileDirectory,
    createRuntimeResolution,
    readProfilePatches,
    boot,
    PluginPackages,
    provideCmdline,
    DSH_LAUNCH_ENVIRONMENT_KEY,
    resolveDshHome,
    installProxyFromEnvironment,
  } = await loadPrimitives();

  const started = performance.now();
  const lineQueue = createLineQueue();
  const events = [];
  let ctx;
  let disposeProxy = () => {};
  let failure;
  let exitCodeValue;
  let abortCleanup = () => {};
  const capture = installStreamCapture({ tee, onLine: (line) => lineQueue.push(line) });
  const evidence = captureEvidence ? createEvidenceRecorders({ vendorRoot, log }) : null;

  try {
    // Deterministic harness home (same value the reference CLI run uses).
    process.env.DSH_HOME ??= resolveDshHome();

    if (captureEvidence) {
      log(`vendor root: ${vendorRoot}`);
      log(`install anchor: ${installAnchor}`);
      log(`profile dir: ${profileDir}`);
      log(`env project layer: ${projectRoot}`);
      log(`DSH_HOME=${process.env.DSH_HOME}`);
      log(`boot primitives imported from: ${vendoredPkg("@deepseek-ai/dsh-app-boot")}/lib/index.js`);
    }

    // Launch environment + proxy (mirrors runProfile's first steps).
    const environment = loadLayeredEnv("dsh", projectRoot);
    disposeProxy = await installProxyFromEnvironment(environment, (message) =>
      process.stderr.write(`dsh: ${message}\n`)
    );

    // 0. The CRM bundle must resolve inside the profile; materialize a real
    //    copy from the project source when the dev symlink is missing/dangling
    //    (fresh clone, or a container whose context dropped the link).
    ensureCrmBundle({ profileDir, projectRoot, log });

    // 1. Load the profile; bundle dirs resolve from the vendored anchor.
    const profile = loadProfileDirectory("dsh", profileDir, installAnchor);
    if (profile.skippedBundles.length > 0) {
      throw new Error(
        `profile skipped bundles: ${profile.skippedBundles.map((b) => `${b.packageName} (${b.reason})`).join("; ")}`
      );
    }
    if (captureEvidence) {
      for (const layer of profile.layers) log(`bundle layer: ${layer.packageName} -> ${layer.packageDir}`);
    }

    // 2. Runtime resolution table from the vendored anchor.
    const resolution = await createRuntimeResolution({ installAnchor, profile });
    if (captureEvidence) {
      log(`runtime resolution: ${resolution.entries.length} entries, all installation-scope entries under: ${vendorRoot}`);
      for (const name of EVIDENCE_KEY_PACKAGES) {
        const entry = resolution.entries.find((e) => e.name === name);
        log(`resolution table: ${name} -> ${entry ? entry.packageDir : "MISSING"}`);
      }
    }

    const profileContext = {
      name: "vendored-boot",
      dir: profile.dir,
      patchPath: profile.patchPath,
      installAnchor,
      startedBundles: profile.layers.map((layer) => layer.packageName),
      cwd: projectRoot,
      home: resolveDshHome(),
      overlays: [],
      telemetryDisabledEnv: process.env.DSH_TELEMETRY_DISABLED,
    };
    const patches = readProfilePatches("dsh", profileContext, profile);
    // The profile patch (cordis.patch.yml) disables tool-bash / tool-fs /
    // tool-fs-search on every native boot. SYSTEM permission mode is the
    // explicit per-tenant opt-in that re-enables them: drop exactly those
    // static disable rows while every other mode keeps them off. (The
    // "keep in sync" CLI overlay — system-tools-off.patch.yml — is skipped
    // the same way by the CLI runtime for SYSTEM turns.)
    // Plan-mode turns drive the agent themselves (drivePlanTurn), so the
    // one-shot runner must not run a competing turn in the same tree. The
    // disable row is appended AFTER the bundle rows: patch rows are applied
    // in order and a bundle's insert re-enables a row targeted earlier.
    const appliedPatches = systemTools
      ? patches.filter(
          (row) => !(SYSTEM_TOOL_IDS.has(row?.id) && row?.disabled === true)
        )
      : [...patches];
    if (planMode !== undefined) appliedPatches.push({ id: "headless-runner", disabled: true });
    const appReady = createAppReady();

    let exitResolve;
    const exitCode = new Promise((resolve) => {
      exitResolve = resolve;
    });

    if (evidence) await evidence.installCjs();

    // 3. Mount the tree.
    ctx = await boot("dsh", ROOT_CONFIG, appliedPatches, async (hostCtx) => {
      hostCtx.provide("profileContext", profileContext);
      hostCtx.provide(DSH_LAUNCH_ENVIRONMENT_KEY, environment);
      await hostCtx.plugin(PluginPackages, { resolution });
      evidence?.installEsm();
      const args = buildRunArgs({ task, sessionId, approvalPolicy, permissionMode });
      provideCmdline(hostCtx, {
        args,
        exit: (code) => exitResolve(code),
        ready: appReady.service,
      });
    });

    if (ctx.fiber.state === 2 && ctx.get("loader") !== undefined) appReady.commit();
    log(`tree mounted (fiber state=${ctx.fiber.state})`);

    // Plan-mode turns: drive the agent directly (the runner row is disabled).
    // The drive requests the exit with the runner's outcome rule; abort or
    // timeout cancel the agent so the drive settles and the shared race below
    // completes with the right failure.
    let planCancel = () => {};
    let planDrive = null;
    if (planMode !== undefined) {
      planDrive = (async () => {
        try {
          exitResolve(
            await drivePlanTurn({
              ctx,
              task: typeof task === "string" ? task : "",
              sessionId,
              projectRoot,
              planMode,
              approvalPolicy,
              permissionMode,
              registerCancel: (cancel) => {
                planCancel = cancel;
              },
              log,
            })
          );
        } catch (error) {
          if (failure === undefined) failure = error;
          exitResolve(1);
        }
      })();
    }

    // 4. Wait for the run (exit request, timeout, or abort), draining the
    //    captured NDJSON projection as it streams.
    let timer;
    const timeout = new Promise((_, reject) => {
      timer = setTimeout(() => reject(makeTimeoutError(timeoutMs)), timeoutMs);
    });
    const aborted = new Promise((_, reject) => {
      const onAbort = () => {
        planCancel();
        reject(makeAbortError());
      };
      if (signal?.aborted) onAbort();
      else {
        signal?.addEventListener("abort", onAbort, { once: true });
        abortCleanup = () => signal?.removeEventListener("abort", onAbort);
      }
    });

    const waiter = (async () => {
      try {
        exitCodeValue = await Promise.race([exitCode, timeout, aborted]);
      } catch (error) {
        failure = error;
      } finally {
        clearTimeout(timer);
        abortCleanup();
        lineQueue.close();
      }
    })();

    for await (const line of lineQueue.lines()) {
      const event = parseEventLine(line);
      if (event) {
        events.push(event);
        yield event;
      }
    }
    await waiter;

    if (evidence && options.evidence) {
      const pluginPackages = ctx.get("pluginPackages");
      const packageOf = {};
      if (pluginPackages) {
        const parentURL = pathToFileURL(
          path.join(vendoredPkg("@deepseek-ai/dsh-headless"), "lib", "index.js")
        ).href;
        for (const name of EVIDENCE_KEY_PACKAGES) {
          const pkg = pluginPackages.packageOf(name, parentURL);
          packageOf[name] = pkg ? pkg.dir : null;
        }
      }
      options.evidence.packageOf = packageOf;
      Object.assign(options.evidence, evidence.summary());
    }

    if (failure !== undefined) throw failure;

    // 5. The projection normally ends with `final`; guarantee one exists so
    //    consumers can always derive the answer with the same parser as the CLI.
    if (!events.some((event) => event.type === "final")) {
      yield syntheticFinal(events, sessionId ?? null, exitCodeValue);
    }

    if (exitCodeValue !== 0) {
      const errorEvent = [...events].reverse().find((e) => e.type === "error" && typeof e.message === "string");
      const tail = capture.stderrTail().trim().split("\n").slice(-3).join("\n");
      throw makeRunError(
        errorEvent ? errorEvent.message : tail || `the headless run exited with code ${exitCodeValue}`,
        { code: exitCodeValue, stderr: tail, timedOut: false }
      );
    }
  } finally {
    evidence?.restoreCjs();
    abortCleanup();
    // Dispose while the capture is still installed: an aborted turn's session
    // flush can emit a late `error` NDJSON event to stdout mid-dispose
    // ("flush on a closed handle"); harvesting it here keeps the real stdout
    // free of projector JSON on the abort path.
    try {
      if (ctx) await withTimeout(ctx.fiber.dispose(), 5_000, "tree dispose");
    } catch (error) {
      log(`dispose failed: ${error instanceof Error ? error.message : String(error)}`);
    }
    try {
      await disposeProxy();
    } catch (error) {
      log(`proxy dispose failed: ${error instanceof Error ? error.message : String(error)}`);
    }
    capture.restore();
    log(`turn done in ${(performance.now() - started).toFixed(0)}ms`);
  }
}
