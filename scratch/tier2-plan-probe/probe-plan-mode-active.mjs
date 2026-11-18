#!/usr/bin/env node
/**
 * tier2-plan-probe/probe-plan-mode-active.mjs — PART 1 evidence probe
 * (plan mode ACTIVATED).
 *
 * Headless turns never activate plan mode (no /plan adapter, the runner never
 * touches ctx.planMode). This probe answers the NEXT question the UI decision
 * needs: WHEN plan mode is active, how does the finished plan surface, and
 * does approval run through the user-questions waterfall (the exact channel
 * the cyraops-crm plugin bridges to the Next-side question broker)?
 *
 * Method: boot the vendored tree in-process with the one-shot runner
 * disabled, create the agent ourselves (mirroring the runner), activate
 * plan mode via ctx.planMode.set, drive the planning task, and stub the
 * process-global question broker the CRM answerer looks up — recording the
 * EXACT request it receives and answering "Approve".
 *
 * Captured evidence:
 *   - full session/event log (tool/call arguments carry the plan markdown),
 *   - the user-questions request shape (id/header/question/detail/options/
 *     intent) as the CRM answerer bridged it to the broker,
 *   - the tool/result of exit_plan_mode after approval,
 *   - whether the turn continues (execution proceeds) after approval.
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(HERE, "..", "..");
const OUT = path.join(HERE, "evidence-plan-mode-active.json");

process.env.DSH_HOME ??= (await import(path.join(REPO_ROOT, "vendor/dsh/node_modules/@deepseek-ai/dsh-home-paths/lib/index.js"))).resolveDshHome();

const VENDOR = path.resolve(REPO_ROOT, "vendor", "dsh");
const PROFILE_DIR = path.join(REPO_ROOT, "vendor", "tooling", "vendored-boot", "profile");
const ROOT_CONFIG = path.join(PROFILE_DIR, "cordis.yml");
const vendoredPkg = (name) => path.join(VENDOR, "node_modules", name);
const TASK = process.argv[2] ?? "Plan the steps to update the three open tickets' priorities, then execute your plan.";

const log = (message) => process.stderr.write(`[probe-plan-active] ${message}\n`);

// ---------------------------------------------------------------------------
// Primitives from the vendored tree (same set native-host.mjs imports).
// ---------------------------------------------------------------------------
const appBoot = await import(`${vendoredPkg("@deepseek-ai/dsh-app-boot")}/lib/index.js`);
const { loadLayeredEnv, loadProfileDirectory, createRuntimeResolution, readProfilePatches, boot, PluginPackages } = appBoot;
const { provideCmdline } = await import(`${vendoredPkg("@deepseek-ai/dsh-cmdline")}/lib/index.js`);
const { DSH_LAUNCH_ENVIRONMENT_KEY } = await import(`${vendoredPkg("@deepseek-ai/dsh-launch-environment")}/lib/index.js`);
const { resolveDshHome } = await import(`${vendoredPkg("@deepseek-ai/dsh-home-paths")}/lib/index.js`);
const { installProxyFromEnvironment } = await import(`${vendoredPkg("@deepseek-ai/dsh-http-proxy")}/lib/index.js`);
const { createUserMessage } = await import(`${vendoredPkg("@deepseek-ai/dsh-llm")}/lib/index.js`);
const { installModelSelection } = await import(`${vendoredPkg("@deepseek-ai/dsh-agent")}/lib/index.js`);

const QUESTION_BROKER_KEY = Symbol.for("cyraops.harness.question-broker");

/** Recorded broker requests (the answerer bridges user-questions/request here). */
const brokerRequests = [];
const stubBroker = {
  request(info) {
    brokerRequests.push(info);
    log(`broker.request received: ${JSON.stringify(info)}`);
    return {
      questionId: info.callId ?? "plan-review-q",
      questions: info.questions,
      text: info.questions?.[0]?.question ?? "",
      callId: info.callId,
      cancel: () => {},
      timedOut: false,
      settled: false,
      decision: Promise.resolve({ answers: [{ id: "plan-review", selected: ["Approve"] }] }),
    };
  },
};
globalThis[QUESTION_BROKER_KEY] = stubBroker;

// ---------------------------------------------------------------------------
// Boot (mirrors runNativeTask), with the one-shot runner disabled so this
// probe drives the turn itself.
// ---------------------------------------------------------------------------
const environment = loadLayeredEnv("dsh", REPO_ROOT);
const disposeProxy = await installProxyFromEnvironment(environment, (m) => process.stderr.write(`dsh: ${m}\n`));

const profile = loadProfileDirectory("dsh", PROFILE_DIR, path.join(VENDOR, "package.json"));
if (profile.skippedBundles.length > 0) {
  throw new Error(`profile skipped bundles: ${profile.skippedBundles.map((b) => `${b.packageName} (${b.reason})`).join("; ")}`);
}
const resolution = await createRuntimeResolution({ installAnchor: path.join(VENDOR, "package.json"), profile });
const profileContext = {
  name: "tier2-plan-probe",
  dir: profile.dir,
  patchPath: profile.patchPath,
  installAnchor: path.join(VENDOR, "package.json"),
  startedBundles: profile.layers.map((layer) => layer.packageName),
  cwd: REPO_ROOT,
  home: resolveDshHome(),
  overlays: [],
  telemetryDisabledEnv: process.env.DSH_TELEMETRY_DISABLED,
};
const patches = readProfilePatches("dsh", profileContext, profile);
patches.push({ id: "headless-runner", disabled: true });

function createAppReady() {
  let ready = false;
  const listeners = new Set();
  return {
    service: {
      onReady(listener) {
        if (ready) { listener(); return () => {}; }
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
const appReady = createAppReady();
let exitResolve;
const exitCode = new Promise((resolve) => { exitResolve = resolve; });

const sessionEvents = [];
const ctx = await boot("dsh", ROOT_CONFIG, patches, async (hostCtx) => {
  hostCtx.provide("profileContext", profileContext);
  hostCtx.provide(DSH_LAUNCH_ENVIRONMENT_KEY, environment);
  hostCtx.on("session/event", (session, event) => {
    sessionEvents.push({ sessionId: session.id, ...event });
  });
  await hostCtx.plugin(PluginPackages, { resolution });
  provideCmdline(hostCtx, {
    args: ["--json", "--approval-policy", "ask", TASK],
    exit: (code) => exitResolve(code),
    ready: appReady.service,
  });
});
if (ctx.fiber.state === 2 && ctx.get("loader") !== undefined) appReady.commit();
log("tree mounted");

// ---------------------------------------------------------------------------
// Drive the turn ourselves, mirroring the headless runner but with plan mode
// ACTIVE before the first step.
// ---------------------------------------------------------------------------
const startedAt = Date.now();
const events = [];
let runError = null;
try {
  const agents = ctx.get("agents");
  const defaultModel = ctx.get("agentDefaultModel");
  const planMode = ctx.get("planMode");
  const sessions = ctx.get("sessions");
  log(`agents=${typeof agents} planMode=${typeof planMode?.set}`);

  const selection = defaultModel.currentSelection();
  log(`model selection: ${JSON.stringify({ provider: selection.provider, model: selection.model, reasoningEffort: selection.reasoningEffort })}`);
  const sessionId = `session-tier2-plan-probe-${Date.now()}`;
  const { agent } = await agents.create({
    sessionId,
    meta: { cwd: REPO_ROOT },
    agentOptions: { ...selection },
    // The runner's setup returns undefined (setupCommit?.commit() then
    // short-circuits); returning installModelSelection's disposer here broke
    // the optional call. Mirror the runner exactly.
    setup: (agentCtx) => {
      installModelSelection(agentCtx);
    },
  });
  log(`agent created: ${agent.id} (session ${agent.session.id})`);

  const outcome = planMode.set(agent, true);
  log(`planMode.set(agent, true) -> ${JSON.stringify(outcome)}`);
  // NOTE: planMode.get/view crash before the session's first event (the plan
  // projection cell does not exist yet); the durable plan/mode log event
  // captured below is the state evidence instead.

  agent.followup(createUserMessage({ content: [{ type: "text", text: TASK }], source: { kind: "user" } }));
  log("task steered; driving to quiescence…");
  let guard = 0;
  while (true) {
    await agent.whenIdle();
    if (agent.status === "idle") break;
    if (++guard > 600) { runError = new Error("quiescence guard exceeded"); break; }
  }
  await sessions.flush(agent.session);
  log(`turn settled; agent.status=${agent.status}`);
} catch (error) {
  runError = error;
  log(`turn failed: ${error instanceof Error ? `${error.message}\n${error.stack}` : String(error)}`);
}

// ---------------------------------------------------------------------------
// Evidence extraction.
// ---------------------------------------------------------------------------
const census = {};
for (const event of sessionEvents) {
  const key = `${event.type}${event.phase ? `/${event.phase}` : ""}`;
  census[key] = (census[key] ?? 0) + 1;
}
const toolCalls = sessionEvents.filter((e) => e.type === "tool/call").map((e) => ({
  seq: e.seq,
  callId: e.data?.callId,
  name: e.data?.name,
  arguments: e.data?.arguments,
}));
const exitPlanCall = toolCalls.find((c) => c.name === "exit_plan_mode");
const toolResults = sessionEvents.filter((e) => e.type === "tool/result").map((e) => ({
  seq: e.seq,
  toolCallId: e.data?.message?.toolCallId,
  isError: e.data?.message?.isError,
  content: e.data?.message?.content,
}));
const exitPlanResult = toolResults.filter((r) => r.toolCallId === exitPlanCall?.callId);
const assistantText = sessionEvents
  .filter((e) => e.type === "assistant/message")
  .flatMap((e) => (e.data?.message?.content ?? []).filter((b) => b.type === "text").map((b) => b.text));
const turnEnd = sessionEvents.filter((e) => e.type === "turn/end").map((e) => e.data?.reason);

const evidence = {
  task: TASK,
  wallMs: Date.now() - startedAt,
  brokerRequests,
  census,
  planModeSetOutcome: undefined,
  exitPlanToolCall: exitPlanCall ?? null,
  exitPlanResult,
  planTextFromToolCall: exitPlanCall?.arguments?.plan ?? null,
  planTextFromBrokerDetail: brokerRequests[0]?.questions?.[0]?.detail ?? null,
  brokerQuestionShape: brokerRequests[0]?.questions?.[0] ?? null,
  assistantText,
  turnEndReasons: turnEnd,
  runError: runError ? String(runError.message ?? runError) : null,
  sessionId: sessionEvents[0]?.sessionId ?? null,
};
fs.writeFileSync(OUT, JSON.stringify(evidence, null, 2));
log(`wrote ${OUT}`);
log(`census: ${JSON.stringify(census)}`);
log(`exit_plan_mode tool call present: ${Boolean(exitPlanCall)}`);
log(`broker requests: ${brokerRequests.length}`);
log(`plan text length: tool=${exitPlanCall?.arguments?.plan?.length ?? 0} broker=${brokerRequests[0]?.questions?.[0]?.detail?.length ?? 0}`);

await ctx.fiber.dispose();
await disposeProxy();
process.exit(runError ? 2 : 0);
