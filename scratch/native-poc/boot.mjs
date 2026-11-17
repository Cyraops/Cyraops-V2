#!/usr/bin/env node
/**
 * native-poc/boot.mjs — in-process DeepSeek Harness host (no `dsh` CLI subprocess).
 *
 * Boots the exact same Cordis tree the `dsh --profile headless` CLI boots —
 * but inside this Node process, by importing the CLI's own boot primitives
 * from the installed distribution — then runs two turns against one persisted
 * session, resuming it through the real headless-runner with --session-id,
 * and shuts the tree down gracefully.
 *
 * Boot mechanism (traced from the CLI sources; see the final report):
 *   bin.js ──> profile-boot-e2mS45fC.js runProfile():
 *     1. loadLayeredEnv("dsh", cwd)          → launchEnvironment snapshot
 *        (materializes project/home .env values into process.env; the
 *        DeepSeek API key resolves from it — never printed here)
 *     2. loadProfileDirectory(...)           → bundle patch layers
 *        (bundle packages resolve from $DIST/node_modules via installAnchor)
 *     3. createRuntimeResolution(...)        → package resolution table
 *     4. boot(binName, cordis.yml, patches, prepare) from
 *        @deepseek-ai/dsh-app-boot:
 *          - new Context() (@deepseek-ai/cordis)
 *          - ctx.baseUrl = profile dir URL
 *          - ctx.provide("dshHomePath", …)
 *          - await ctx.plugin(Loader) (@deepseek-ai/cordis-plugin-loader)
 *          - prepare(ctx): provide "profileContext", "launchEnvironment",
 *            plugin(PluginPackages, { resolution }), provideCmdline({args, exit})
 *          - mountRootInclude(ctx, cordis.yml, patches) → tree mounts
 *          - await ctx.get("loader").await()
 *     5. The mounted headless-startup plugin parses cmdlineArgs; the
 *        headless-runner plugin drives one task and requests ctx.get("appExit")
 *        when done. Our launcher provides appExit as a promise-resolving
 *        callback instead of a process exit — that is the whole trick.
 */

import path from "node:path";
import { fileURLToPath } from "node:url";
import { performance } from "node:perf_hooks";

const T0 = performance.now();

// Deterministic harness home (same value the reference CLI run uses).
process.env.DSH_HOME ??= "/Users/tanveersinghsaini/.dsh";

const DIST = "/Users/tanveersinghsaini/.nvm/versions/node/v22.23.2/lib/node_modules/@deepseek-ai/dsh";
const pkg = (name) => path.join(DIST, "node_modules", name);
const HERE = fileURLToPath(new URL(".", import.meta.url));
const PROFILE_DIR = path.join(HERE, "profile");
// Project .env layer the reference CLI reads when invoked from the repo root.
// It supplies DEEPSEEK_API_KEY; the value is never printed by this script.
const ENV_LAYER_CWD = "/Users/tanveersinghsaini/Desktop/cyraops-v2";

const log = (...args) => process.stderr.write(`[native-poc] ${args.join(" ")}\n`);

// ---------------------------------------------------------------------------
// Import the exact boot primitives the CLI's lib/profile-boot uses.
// ---------------------------------------------------------------------------
const appBoot = await import(`${pkg("@deepseek-ai/dsh-app-boot")}/lib/index.js`);
const {
  loadLayeredEnv,
  loadProfileDirectory,
  createRuntimeResolution,
  readProfilePatches,
  boot,
  PluginPackages,
} = appBoot;
const { provideCmdline } = await import(`${pkg("@deepseek-ai/dsh-cmdline")}/lib/index.js`);
const { DSH_LAUNCH_ENVIRONMENT_KEY } = await import(`${pkg("@deepseek-ai/dsh-launch-environment")}/lib/index.js`);
const { resolveDshHome } = await import(`${pkg("@deepseek-ai/dsh-home-paths")}/lib/index.js`);
const { installProxyFromEnvironment } = await import(`${pkg("@deepseek-ai/dsh-http-proxy")}/lib/index.js`);

const INSTALL_ANCHOR = path.join(DIST, "package.json");
const ROOT_CONFIG = path.join(PROFILE_DIR, "cordis.yml");

log(`DSH_HOME=${process.env.DSH_HOME}`);
log(`install anchor: ${INSTALL_ANCHOR}`);
log(`profile dir: ${PROFILE_DIR}`);
log(`env project layer: ${ENV_LAYER_CWD}`);

// ---------------------------------------------------------------------------
// Launch environment + proxy (mirrors runProfile's first steps).
// ---------------------------------------------------------------------------
const environment = loadLayeredEnv("dsh", ENV_LAYER_CWD);
const disposeProxy = await installProxyFromEnvironment(
  environment,
  (message) => process.stderr.write(`dsh: ${message}\n`),
);

// ---------------------------------------------------------------------------
// Small launcher-owned helpers (mirror lib/profile-boot createAppReady).
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

// Peak-RSS sampler (best-effort in-process estimate; /usr/bin/time -l gives
// the authoritative number when the script is run under it).
let maxRss = 0;
const sampler = setInterval(() => {
  maxRss = Math.max(maxRss, process.memoryUsage().rss);
}, 100);
sampler.unref();

// ---------------------------------------------------------------------------
// bootTree: mount one tree in-process and let the real headless-runner drive.
// ---------------------------------------------------------------------------
async function bootTree(args, label) {
  const profile = loadProfileDirectory("dsh", PROFILE_DIR, INSTALL_ANCHOR);
  if (profile.skippedBundles.length > 0) {
    log(`${label}: skipped bundles: ${profile.skippedBundles.map((b) => `${b.packageName} (${b.reason})`).join("; ")}`);
  }
  const resolution = await createRuntimeResolution({
    installAnchor: INSTALL_ANCHOR,
    profile,
  });
  const profileContext = {
    name: "native-poc",
    dir: profile.dir,
    patchPath: profile.patchPath,
    installAnchor: INSTALL_ANCHOR,
    startedBundles: profile.layers.map((layer) => layer.packageName),
    cwd: process.cwd(),
    home: resolveDshHome(),
    overlays: [],
    telemetryDisabledEnv: process.env.DSH_TELEMETRY_DISABLED,
  };
  const patches = readProfilePatches("dsh", profileContext, profile);
  const appReady = createAppReady();

  let exitResolve;
  const exitCode = new Promise((resolve) => {
    exitResolve = resolve;
  });
  let sessionResolve;
  const sessionId = new Promise((resolve) => {
    sessionResolve = resolve;
  });
  // Per-boot outcome capture: mirrors dsh-headless summarize() without
  // importing its process-bound internals.
  const collect = { sessionId: undefined, text: "", reason: undefined };

  const ctx = await boot("dsh", ROOT_CONFIG, patches, async (hostCtx) => {
    hostCtx.provide("profileContext", profileContext);
    hostCtx.provide(DSH_LAUNCH_ENVIRONMENT_KEY, environment);
    // Attach BEFORE any plugin activates so the first session/event of the
    // run cannot be missed.
    hostCtx.on("session/event", (session, event) => {
      if (collect.sessionId === undefined) {
        collect.sessionId = session.id;
        sessionResolve(session.id);
      }
      if (event.type === "assistant/message") {
        const joined = event.data.message.content
          .filter((block) => block.type === "text")
          .map((block) => block.text)
          .join("");
        if (joined !== "") collect.text = joined;
      } else if (event.type === "turn/end") {
        collect.reason = event.data.reason;
      }
    });
    await hostCtx.plugin(PluginPackages, { resolution });
    // The launcher-owned appExit: the headless-runner requests it when the
    // run ends; we resolve a promise instead of exiting the process.
    provideCmdline(hostCtx, {
      args,
      exit: (code) => exitResolve(code),
      ready: appReady.service,
    });
  });

  if (ctx.fiber.state === 2 && ctx.get("loader") !== undefined) appReady.commit();
  log(`${label}: tree mounted (fiber state=${ctx.fiber.state})`);
  return { ctx, exitCode, sessionId, collect };
}

// ---------------------------------------------------------------------------
// Two turns: fresh task, then CLI-style --session-id resume. Both in-process.
// ---------------------------------------------------------------------------
async function main() {
  const results = { turn1: {}, turn2: {} };
  let finalCode = 0;
  try {
    // ---- Turn 1: new session -------------------------------------------------
    const args1 = ["--json", "--approval-policy", "never", "Reply with exactly the word: banana"];
    log(`turn 1: booting tree #1 (wall ${(performance.now() - T0).toFixed(0)}ms)`);
    const tree1 = await bootTree(args1, "tree #1");
    results.turn1.rssAfterBoot = process.memoryUsage().rss;
    const code1 = await withTimeout(tree1.exitCode, 300_000, "turn 1");
    const sessionId = await tree1.sessionId;
    results.turn1 = { ...results.turn1, ...tree1.collect, exitCode: code1 };
    results.turn1.rssAfterTurn = process.memoryUsage().rss;
    log(`turn 1 done: exit=${code1} sessionId=${sessionId} text=${JSON.stringify(tree1.collect.text)}`);
    await tree1.ctx.fiber.dispose(); // graceful shutdown of tree #1
    log(`tree #1 disposed (wall ${(performance.now() - T0).toFixed(0)}ms)`);

    // ---- Turn 2: resume the same session in-process ---------------------------
    const args2 = ["--json", "--session-id", sessionId, "--approval-policy", "never", "What word did you just say?"];
    log("turn 2: booting tree #2 with --session-id (resume)");
    const tree2 = await bootTree(args2, "tree #2");
    const code2 = await withTimeout(tree2.exitCode, 300_000, "turn 2");
    results.turn2 = { ...tree2.collect, exitCode: code2 };
    results.turn2.rssAfterTurn = process.memoryUsage().rss;
    log(`turn 2 done: exit=${code2} text=${JSON.stringify(tree2.collect.text)}`);
    await tree2.ctx.fiber.dispose(); // graceful shutdown of tree #2
    log(`tree #2 disposed (wall ${(performance.now() - T0).toFixed(0)}ms)`);

    if (code1 !== 0 || code2 !== 0) finalCode = 1;
  } catch (error) {
    finalCode = 2;
    log(`FATAL: ${error instanceof Error ? `${error.message}\n${error.stack}` : String(error)}`);
  } finally {
    try {
      if (typeof disposeProxy === "function") await disposeProxy();
    } catch (error) {
      log(`proxy dispose failed: ${String(error)}`);
    }
    const wallMs = performance.now() - T0;
    maxRss = Math.max(maxRss, process.memoryUsage().rss);
    // Let stdout finish flushing the NDJSON events before the summary.
    await new Promise((resolve) => process.stdout.write("", resolve));
    process.stdout.write("\n== HOST SUMMARY ==\n");
    process.stdout.write(
      JSON.stringify(
        {
          sessionId: results.turn1.sessionId,
          turn1: {
            exitCode: results.turn1.exitCode,
            finalText: results.turn1.text,
            reason: results.turn1.reason,
          },
          turn2: {
            exitCode: results.turn2.exitCode,
            finalText: results.turn2.text,
            reason: results.turn2.reason,
          },
          wallMs: Math.round(wallMs),
          maxRssSampledBytes: maxRss,
          finalRssBytes: process.memoryUsage().rss,
        },
        null,
        2,
      ) + "\n",
    );
    process.exitCode = finalCode;
    // Failsafe: never hang the host if some background timer survived.
    const failsafe = setTimeout(() => {
      process.stderr.write("[native-poc] failsafe exit\n");
      process.exit(finalCode);
    }, 5_000);
    failsafe.unref();
  }
}

await main();
