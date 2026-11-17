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

import path from "node:path";
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

const vendoredPkg = (name) => path.join(VENDOR, "node_modules", name);
const DEFAULT_LOG = (message) => process.stderr.write(`[native-host] ${message}\n`);

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

/**
 * Build the CLI argument vector the headless runner receives. Exported so the
 * policy mapping (never by default, ask when the caller opts in) is unit
 * tested without booting a tree.
 *
 * @param options.task - the task text (appended last, as one argument).
 * @param options.sessionId - optional durable session id to resume.
 * @param options.approvalPolicy - "ask" | "never"; the headless runner maps it
 *   onto the session approval policy via setApprovalPolicy before the run.
 */
export function buildRunArgs({ task, sessionId, approvalPolicy = "never" }) {
  const args = ["--json", "--approval-policy", approvalPolicy];
  if (sessionId) args.push("--session-id", sessionId);
  args.push(task);
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
  } = options;

  if (typeof task !== "string" || task.trim() === "") {
    throw new Error("runNativeTask: task must be a non-empty string");
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
    const appReady = createAppReady();

    let exitResolve;
    const exitCode = new Promise((resolve) => {
      exitResolve = resolve;
    });

    if (evidence) await evidence.installCjs();

    // 3. Mount the tree.
    ctx = await boot("dsh", ROOT_CONFIG, patches, async (hostCtx) => {
      hostCtx.provide("profileContext", profileContext);
      hostCtx.provide(DSH_LAUNCH_ENVIRONMENT_KEY, environment);
      await hostCtx.plugin(PluginPackages, { resolution });
      evidence?.installEsm();
      const args = buildRunArgs({ task, sessionId, approvalPolicy });
      provideCmdline(hostCtx, {
        args,
        exit: (code) => exitResolve(code),
        ready: appReady.service,
      });
    });

    if (ctx.fiber.state === 2 && ctx.get("loader") !== undefined) appReady.commit();
    log(`tree mounted (fiber state=${ctx.fiber.state})`);

    // 4. Wait for the run (exit request, timeout, or abort), draining the
    //    captured NDJSON projection as it streams.
    let timer;
    const timeout = new Promise((_, reject) => {
      timer = setTimeout(() => reject(makeTimeoutError(timeoutMs)), timeoutMs);
    });
    const aborted = new Promise((_, reject) => {
      const onAbort = () => reject(makeAbortError());
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
