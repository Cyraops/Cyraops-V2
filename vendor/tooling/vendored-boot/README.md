# Boot from the vendored tree (verified 2026-11-18)

`native-host.mjs` is the reusable in-process boot host: it boots the headless
harness tree with ALL package resolution from `vendor/dsh/` — zero imports
from the distribution install. The resolution root is the `installAnchor`
function parameter threaded through `dsh-app-boot`'s primitives; the only
hard-coded distribution path is in the CLI's own launcher
(`profile-boot-e2mS45fC.js:120`), which this host replaces.

Required layout: `vendor/dsh/package.json` (exact copy of the distribution
manifest) + `vendor/dsh/node_modules/<pkg>` (anchor walk = Node's node_modules
resolution from the anchor). Two native addons are required on darwin-arm64
and were added to the vendored set: `node-addon-require-builtin-darwin-arm64@0.1.9`
and `@deepseek-ai/node-addon-system-darwin-arm64@0.1.2`.

## Public API

```js
import { runNativeTask } from "./native-host.mjs";

for await (const event of runNativeTask({ task: "…", sessionId?: "…" })) {
  // HarnessEvent: { type: "session" | "status" | "thinking" | "text" | "final" | "error", … }
}
```

One call = one headless turn (boot a fresh cordis tree, run the `--json`
NDJSON projection, dispose the tree — same lifecycle the CLI gives per
process). Options: `signal` (AbortSignal), `timeoutMs` (default 180 000),
`projectRoot` (env layer + task cwd, default `process.cwd()`),
`captureEvidence` (one-shot resolution recording, for `boot.mjs`). While a
turn runs, the host temporarily captures `process.stdout` to harvest the
projection — callers must serialize concurrent turns (the adapter does).

## How the adapter uses it

`src/lib/harness/native-runtime.ts` loads this module with a **dynamic import
of a runtime-computed `file://` URL** (`pathToFileURL(join(process.cwd(),
"vendor/tooling/vendored-boot/native-host.mjs"))`), so Next/Turbopack never
statically bundles the vendored ESM/CJS/native-addon code. The runtime
serializes turns globally (the host owns stdout during a run) and maps the
adapter's `AgentRuntime` contract onto `runNativeTask`; `HARNESS_RUNTIME=native`
selects it, and `runtimeFactory` falls back to the CLI runtime when the
vendored tree is missing.

**Known blocker (observed 2026-11-18, Next 16.4.3 dev/Turbopack):** the
Turbopack dev runtime intercepts `import()` and rejects the computed file URL
with `Cannot find module as expression is too dynamic`, and it statically
traces `createRequire(...)`-based loads (compile error `Module not found:
Can't resolve ...`). No shipped escape hatch exists, so inside `next dev` the
adapter falls back to the CLI runtime for the HTTP path — the turn is still
served, and the API's `runtime` field reports
`{"available":true,"kind":"cli","reason":"...intercepted by the Next.js dev
runtime..."}`. In a plain Node process (and a runtime that leaves `import()`
native) the module loads normally and the in-process path serves the turn;
`native-host.mjs` has no top-level `await` so Node's `require(esm)` can load
it as well. The module is production-ready for a non-bundler host; re-testing
against a newer Next/Turbopack is the way to lift the dev-server limitation.

## Evidence launcher

`boot.mjs` is the one-shot audit wrapper (banana task, resolution capture,
hard assertions that every recorded resolution stays under `vendor/dsh/`).

Observed: final text "banana", 350-entry runtime resolution table, 280
recorded resolutions — every one under `vendor/dsh/node_modules` (hard
assertion), wall ~3.4 s, exit 0. The project `.env` supplies the DeepSeek key
through `loadLayeredEnv`; its value is never read or printed.
