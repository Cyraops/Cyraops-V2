#!/usr/bin/env node
/**
 * vendored-boot/boot.mjs — one-shot evidence run of the vendored in-process
 * harness. Thin wrapper over native-host.mjs: it boots the tree from
 * vendor/dsh/ with resolution capture enabled, runs the deterministic banana
 * task, prints the evidence, and exits non-zero on any violation.
 *
 * The reusable production surface is `runNativeTask` in native-host.mjs;
 * this launcher exists so the audit checks stay runnable by hand:
 *
 *     node vendor/tooling/vendored-boot/boot.mjs
 *
 * Evidence asserted:
 *   1. every recorded bare-specifier resolution stays under vendor/dsh/
 *      (a path from the distribution install is a hard failure);
 *   2. the runtime resolution table and pluginPackages.packageOf spot checks
 *      resolve the key packages from the vendored tree;
 *   3. the final text contains "banana".
 * Env: DEEPSEEK_API_KEY comes from loadLayeredEnv("dsh", <project root>);
 * its value is never printed.
 */

import { performance } from "node:perf_hooks";
import {
  EVIDENCE_KEY_PACKAGES,
  INSTALL_ANCHOR,
  PROFILE_DIR,
  VENDOR,
  runNativeTask,
} from "./native-host.mjs";

const T0 = performance.now();
const PROJECT_ROOT = process.cwd();
const DIST = "/Users/tanveersinghsaini/.nvm/versions/node/v22.23.2/lib/node_modules/@deepseek-ai/dsh";
const log = (...args) => process.stderr.write(`[vendored-boot] ${args.join(" ")}\n`);

let finalCode = 0;
let text = "";
let evidence = {};

try {
  for await (const event of runNativeTask({
    task: "Reply with exactly the word: banana",
    projectRoot: PROJECT_ROOT,
    captureEvidence: true,
    tee: "all",
    log,
    evidence,
  })) {
    if (event.type === "final" && typeof event.text === "string") text = event.text;
  }

  console.log("== FINAL TEXT ==");
  console.log(text);
  console.log("=================");

  // Evidence summary + hard assertions.
  log(`install anchor: ${INSTALL_ANCHOR}`);
  log(`profile dir: ${PROFILE_DIR}`);
  log(`vendor root: ${VENDOR}`);
  const recorded = evidence.recorded ?? [];
  log(`recorded resolutions: ${recorded.length} unique (specifier,path) pairs during tree mount`);
  for (const { specifier, p } of recorded.slice(0, 400)) log(`observed: ${specifier} -> ${p}`);
  if (recorded.length > 400) log(`... (${recorded.length - 400} more, trimmed from output)`);
  for (const name of EVIDENCE_KEY_PACKAGES) {
    const hits = recorded.filter(({ specifier }) => specifier === name || specifier.startsWith(`${name}/`));
    if (hits.length === 0) log(`observed: ${name} -> (no recorded import; see table/packageOf above)`);
  }
  for (const [name, dir] of Object.entries(evidence.packageOf ?? {})) {
    log(`pluginPackages.packageOf: ${name} -> ${dir ?? "MISSING"}`);
  }
  const violations = evidence.violations ?? [];
  const distHits = violations.filter((v) => v.resolvedPath.startsWith(DIST));
  const deepseekOutside = violations.filter(
    (v) => v.specifier.startsWith("@deepseek-ai/") && !v.resolvedPath.startsWith(DIST)
  );
  for (const v of distHits) log(`VIOLATION (from $DIST): ${v.specifier} -> ${v.resolvedPath}`);
  for (const v of deepseekOutside)
    log(`VIOLATION (@deepseek-ai outside vendor): ${v.specifier} -> ${v.resolvedPath}`);
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
  if (!/banana/i.test(text ?? "")) {
    finalCode = 1;
    log("FAIL: final text does not contain 'banana'");
  } else {
    log("OK: final text contains 'banana'");
  }
} catch (error) {
  finalCode = 2;
  log(`FATAL: ${error instanceof Error ? `${error.message}\n${error.stack}` : String(error)}`);
} finally {
  log(`wall ${(performance.now() - T0).toFixed(0)}ms, exit code ${finalCode}`);
  process.exitCode = finalCode;
  // Failsafe: never hang the host if some background timer survived.
  const failsafe = setTimeout(() => process.exit(finalCode), 5_000);
  failsafe.unref();
}
