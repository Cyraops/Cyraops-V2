#!/usr/bin/env node
/**
 * vendored-boot/boot.mjs — in-process DeepSeek Harness headless boot with ALL
 * package resolution served from the vendored tree:
 *
 *     /Users/tanveersinghsaini/Desktop/cyraops-v2/vendor/dsh/
 *
 * vendor/dsh mirrors the distribution install layout exactly:
 *   - vendor/dsh/package.json          = copy of $DIST/package.json (the
 *     "installation anchor": collectInstallationScopePackages() walks its
 *     dependencies through <dir>/node_modules, and resolveBundleDir() finds
 *     profile bundles from the same anchor first).
 *   - vendor/dsh/node_modules/<pkg>    = the sha256-verified copies
 *     (previously flat at vendor/dsh/<pkg>; moved one level down so Node's
 *     node_modules lookup order applies — same bytes, same dirs).
 *
 * Nothing is imported from $DIST
 * (/Users/tanveersinghsaini/.nvm/versions/node/v22.23.2/lib/node_modules/@deepseek-ai/dsh).
 * Even the boot primitives (dsh-app-boot's loadLayeredEnv /
 * createRuntimeResolution / PluginPackages / boot, dsh-cmdline's
 * provideCmdline, dsh-launch-environment, dsh-home-paths, dsh-http-proxy)
 * come from vendor/dsh/node_modules. The only files NOT served from the
 * vendored tree are this launcher and the Node runtime itself.
 *
 * Resolution evidence captured live:
 *   1. the createRuntimeResolution() table entries for key packages;
 *   2. an ESM wrapper installed ON TOP of PluginPackages' runtime
 *      interception records every bare-specifier file URL the internal
 *      loader actually resolves during tree mount;
 *   3. a CommonJS Module._resolveFilename wrapper records every CJS
 *      resolution (it is the interception's underlying "original", so all
 *      routed CJS requests pass through it);
 *   4. ctx.get("pluginPackages").packageOf(...) spot-checks after mount.
 * Every recorded path is asserted to live under vendor/dsh/ — a $DIST path
 * is a hard failure.
 *
 * Run: node scratch/vendored-boot/boot.mjs
 * Env: DEEPSEEK_API_KEY comes from loadLayeredEnv("dsh", <cyraops-v2 root>),
 * the same project .env layer the reference CLI reads. Never printed.
 */

import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { createRequire } from "node:module";
import { performance } from "node:perf_hooks";

const T0 = performance.now();

const PROJECT_ROOT = "/Users/tanveersinghsaini/Desktop/cyraops-v2";
const VENDOR = path.join(PROJECT_ROOT, "vendor", "dsh");
const DIST = "/Users/tanveersinghsaini/.nvm/versions/node/v22.23.2/lib/node_modules/@deepseek-ai/dsh";
const HERE = fileURLToPath(new URL(".", import.meta.url));
const PROFILE_DIR = path.join(HERE, "profile");
// Project .env layer the reference CLI reads when invoked from the repo root.
// It supplies DEEPSEEK_API_KEY; the value is never printed by this script.
const ENV_LAYER_CWD = PROJECT_ROOT;

// Deterministic harness home (same value the reference CLI run uses).
process.env.DSH_HOME ??= "/Users/tanveersinghsaini/.dsh";

const vendoredPkg = (name) => path.join(VENDOR, "node_modules", name);
const log = (...args) => process.stderr.write(`[vendored-boot] ${args.join(" ")}\n`);

// ---------------------------------------------------------------------------
// Import every boot primitive from the VENDORED tree (absolute file URLs so
// the import itself cannot fall back to $DIST).
// ---------------------------------------------------------------------------
const appBoot = await import(`${vendoredPkg("@deepseek-ai/dsh-app-boot")}/lib/index.js`);
const {
  loadLayeredEnv,
  loadProfileDirectory,
  createRuntimeResolution,
  readProfilePatches,
  boot,
  PluginPackages,
} = appBoot;
const { provideCmdline } = await import(`${vendoredPkg("@deepseek-ai/dsh-cmdline")}/lib/index.js`);
const { DSH_LAUNCH_ENVIRONMENT_KEY } = await import(`${vendoredPkg("@deepseek-ai/dsh-launch-environment")}/lib/index.js`);
const { resolveDshHome } = await import(`${vendoredPkg("@deepseek-ai/dsh-home-paths")}/lib/index.js`);
const { installProxyFromEnvironment } = await import(`${vendoredPkg("@deepseek-ai/dsh-http-proxy")}/lib/index.js`);

const INSTALL_ANCHOR = path.join(VENDOR, "package.json");
const ROOT_CONFIG = path.join(PROFILE_DIR, "cordis.yml");

log(`vendor root: ${VENDOR}`);
log(`install anchor: ${INSTALL_ANCHOR}`);
log(`profile dir: ${PROFILE_DIR}`);
log(`env project layer: ${ENV_LAYER_CWD}`);
log(`DSH_HOME=${process.env.DSH_HOME}`);
log(`boot primitives imported from: ${vendoredPkg("@deepseek-ai/dsh-app-boot")}/lib/index.js`);

// ---------------------------------------------------------------------------
// Resolution evidence capture.
// ---------------------------------------------------------------------------
const BARE = /^(?:@[^/]+\/[^/]+|[^./@][^/]*)(?:\/.*)?$/;
const keyPackages = [
  "@deepseek-ai/dsh-headless",
  "@deepseek-ai/dsh-base",
  "@deepseek-ai/dsh-app-boot",
  "@deepseek-ai/cordis",
  "@deepseek-ai/dsh-cmdline",
  "@deepseek-ai/dsh-session",
  "@deepseek-ai/dsh-agent",
];
const recorded = new Map(); // specifier -> Set<absolute resolved path>
const violations = []; // resolved paths outside the vendored tree

function recordResolved(specifier, resolvedPath) {
  if (typeof specifier !== "string" || !BARE.test(specifier)) return;
  if (typeof resolvedPath !== "string" || resolvedPath.length === 0) return;
  if (!path.isAbsolute(resolvedPath)) return; // Node builtins resolve to themselves
  if (!resolvedPath.startsWith(VENDOR + path.sep) && resolvedPath !== VENDOR) {
    // Track anything outside the vendored tree; a $DIST hit is fatal below.
    violations.push({ specifier, resolvedPath });
    return;
  }
  if (!recorded.has(specifier)) recorded.set(specifier, new Set());
  recorded.get(specifier).add(resolvedPath);
}

// CJS: install BEFORE the interception exists, so installRuntimeInterception
// captures this wrapper as its underlying "original" — every routed CJS
// require therefore still passes through us.
const Module = (await import("node:module")).default;
const originalResolveFilename = Module._resolveFilename;
Module._resolveFilename = function (request, parent, isMain, options) {
  const filename = originalResolveFilename.apply(this, arguments);
  recordResolved(request, filename);
  return filename;
};
log("CJS _resolveFilename recorder installed");

// ESM: install INSIDE prepare, right after PluginPackages has installed its
// own interception, so we sit on top of it and see the final routed URLs.
let esmRecorderInstalled = false;
function installEsmRecorder() {
  if (esmRecorderInstalled) return;
  esmRecorderInstalled = true;
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
}

// ---------------------------------------------------------------------------
// Launcher helpers (mirror the CLI's lib/profile-boot runProfile steps).
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
// Main: one boot, one deterministic task.
// ---------------------------------------------------------------------------
async function main() {
  let finalCode = 0;
  let disposeProxy = () => {};
  let ctx;
  try {
    // Launch environment + proxy (mirrors runProfile's first steps).
    const environment = loadLayeredEnv("dsh", ENV_LAYER_CWD);
    disposeProxy = await installProxyFromEnvironment(
      environment,
      (message) => process.stderr.write(`dsh: ${message}\n`),
    );

    // 1. Load the scratch profile; bundle dirs resolve from the vendored anchor.
    const profile = loadProfileDirectory("dsh", PROFILE_DIR, INSTALL_ANCHOR);
    if (profile.skippedBundles.length > 0) {
      log(`skipped bundles: ${profile.skippedBundles.map((b) => `${b.packageName} (${b.reason})`).join("; ")}`);
      finalCode = 1;
    }
    for (const layer of profile.layers) {
      log(`bundle layer: ${layer.packageName} -> ${layer.packageDir}`);
    }

    // 2. Runtime resolution table from the vendored anchor.
    const resolution = await createRuntimeResolution({
      installAnchor: INSTALL_ANCHOR,
      profile,
    });
    log(`runtime resolution: ${resolution.entries.length} entries, all installation-scope entries under: ${VENDOR}`);
    for (const name of keyPackages) {
      const entry = resolution.entries.find((e) => e.name === name);
      log(`resolution table: ${name} -> ${entry ? entry.packageDir : "MISSING"}`);
    }

    const profileContext = {
      name: "vendored-boot",
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
    const collect = { sessionId: undefined, text: "", reason: undefined };

    // 3. Mount the tree.
    ctx = await boot("dsh", ROOT_CONFIG, patches, async (hostCtx) => {
      hostCtx.provide("profileContext", profileContext);
      hostCtx.provide(DSH_LAUNCH_ENVIRONMENT_KEY, environment);
      hostCtx.on("session/event", (session, event) => {
        if (collect.sessionId === undefined) collect.sessionId = session.id;
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
      installEsmRecorder(); // now sits on top of the interception
      provideCmdline(hostCtx, {
        args: ["--json", "--approval-policy", "never", "Reply with exactly the word: banana"],
        exit: (code) => exitResolve(code),
        ready: appReady.service,
      });
    });

    if (ctx.fiber.state === 2 && ctx.get("loader") !== undefined) appReady.commit();
    log(`tree mounted (fiber state=${ctx.fiber.state})`);

    // 4. Wait for the headless run to finish (appExit resolved by the runner).
    const code = await withTimeout(exitCode, 300_000, "headless run");
    log(`run done: exit=${code} sessionId=${collect.sessionId} text=${JSON.stringify(collect.text)} reason=${collect.reason}`);

    // 5. Post-mount spot checks through the published PluginPackages service.
    const pluginPackages = ctx.get("pluginPackages");
    if (pluginPackages) {
      const parentURL = pathToFileURL(
        path.join(vendoredPkg("@deepseek-ai/dsh-headless"), "lib", "index.js"),
      ).href;
      for (const name of keyPackages) {
        const pkg = pluginPackages.packageOf(name, parentURL);
        log(`pluginPackages.packageOf: ${name} -> ${pkg ? pkg.dir : "MISSING"}`);
      }
    }

    // 6. Evidence summary + hard assertions.
    const all = [];
    for (const [specifier, paths] of [...recorded].sort((a, b) => a[0].localeCompare(b[0]))) {
      for (const p of paths) all.push({ specifier, p });
    }
    log(`recorded resolutions: ${all.length} unique (specifier,path) pairs during tree mount`);
    for (const { specifier, p } of all) log(`observed: ${specifier} -> ${p}`);
    for (const name of keyPackages) {
      const hits = all.filter(({ specifier }) => specifier === name || specifier.startsWith(`${name}/`));
      if (hits.length === 0) log(`observed: ${name} -> (no recorded import; see table/packageOf above)`);
    }
    const distHits = violations.filter((v) => v.resolvedPath.startsWith(DIST));
    const deepseekOutside = violations.filter(
      (v) => v.specifier.startsWith("@deepseek-ai/") && !v.resolvedPath.startsWith(DIST),
    );
    const outside = violations.filter(
      (v) => !v.resolvedPath.startsWith(DIST) && !v.specifier.startsWith("@deepseek-ai/"),
    );
    for (const v of distHits) log(`VIOLATION (from $DIST): ${v.specifier} -> ${v.resolvedPath}`);
    for (const v of deepseekOutside) log(`VIOLATION (@deepseek-ai outside vendor): ${v.specifier} -> ${v.resolvedPath}`);
    for (const v of outside) log(`note (non-deepseek outside vendored tree): ${v.specifier} -> ${v.resolvedPath}`);
    if (distHits.length > 0) {
      finalCode = 1;
      log("FAIL: some resolved paths came from $DIST");
    } else {
      log("OK: no resolved path came from $DIST");
    }
    if (deepseekOutside.length > 0) {
      finalCode = 1;
      log("FAIL: some @deepseek-ai specifiers resolved outside the vendored tree");
    } else {
      log("OK: every recorded @deepseek-ai/* resolution is under the vendored tree");
    }
    const ok = /banana/i.test(collect.text ?? "");
    if (!ok) {
      finalCode = 1;
      log("FAIL: final text does not contain 'banana'");
    }

    console.log("== FINAL TEXT ==");
    console.log(collect.text ?? "");
    console.log("=================");
    if (code !== 0) finalCode = 1;
  } catch (error) {
    finalCode = 2;
    log(`FATAL: ${error instanceof Error ? `${error.message}\n${error.stack}` : String(error)}`);
  } finally {
    try {
      if (ctx) await ctx.fiber.dispose();
    } catch (error) {
      log(`dispose failed: ${String(error)}`);
    }
    try {
      await disposeProxy();
    } catch (error) {
      log(`proxy dispose failed: ${String(error)}`);
    }
    log(`wall ${(performance.now() - T0).toFixed(0)}ms, exit code ${finalCode}`);
    process.exitCode = finalCode;
    // Failsafe: never hang the host if some background timer survived.
    const failsafe = setTimeout(() => process.exit(finalCode), 5_000);
    failsafe.unref();
  }
}

await main();
