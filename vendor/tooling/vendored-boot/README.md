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

## Production image (2026-11-18)

The Dockerfile now carries the whole tree: it copies the extracted
`vendor/dsh` + `vendor/tooling` (the build fails fast when the extracted tree
is missing from the context; the pinned tarball is excluded from the image),
installs the linux-x64 prebuilds of the two native-addon families into
`vendor/dsh/node_modules` for the image platform, installs a REAL copy of the
CRM bundle into `profile/node_modules/@cyraops/harness-crm` (instead of the
dev symlink), and sets `HARNESS_RUNTIME=native`. `native-host.mjs` also
self-heals the CRM bundle entry at boot: when the profile entry is missing or
dangling it materializes a real copy from the project's
`src/lib/harness/plugins/cyraops-crm` before the profile loads.

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
"vendor/tooling/vendored-boot/native-host.mjs"))`), and the import carries the
**`turbopackIgnore` magic comment** (documented in Next's bundled
lazy-loading guide: "Skip bundling - import happens at runtime"). The comment
keeps the expression out of Turbopack's module graph entirely, so the vendored
ESM/CJS/native-addon code is never statically bundled or type-checked and the
import stays a native Node runtime import. The runtime serializes turns
globally (the host owns stdout during a run) and maps the adapter's
`AgentRuntime` contract onto `runNativeTask`; `HARNESS_RUNTIME=native` selects
it, and `runtimeFactory` falls back to the CLI runtime when the vendored tree
is missing.

**Previous blocker, now lifted (observed 2026-11-18, Next 16.4.3
dev/Turbopack):** without the magic comment, the Turbopack dev runtime
intercepts `import()` and rejects the computed file URL with `Cannot find
module as expression is too dynamic`, and it statically traces
`createRequire(...)`-based loads (compile error `Module not found: Can't
resolve ...`). With `/* turbopackIgnore: true */`, `next dev` compiles the
route and the in-process host serves the turn: verified banana turn through
`POST /api/harness/run` with `HARNESS_RUNTIME=native` →
`{"runtime":{"available":true,"kind":"native"}}`, wall ~3.9 s for the first
turn and ~1.8 s for a session-resume turn. A worker-thread alternative
(`new Worker(<runtime-computed path>)` from the adapter) was tried first and
rejected: Turbopack statically evaluates the Worker path argument to the
project root directory and then errors on every non-module file under it
("Unknown module type" for each root `*.md`/log, `Module not found` inside
`native-host.mjs`, a non-placeable native addon reached via
`eslint.config.mjs`); the `turbopackIgnore` comment was not honoured on the
`new Worker(...)` expression in this Next version. The direct import with the
magic comment is the production path. If the import ever fails inside a
bundler host, the adapter delegates the turn to the CLI runtime and the API's
`runtime` field reports `{"available":true,"kind":"cli","reason":...}`.
`native-host.mjs` has no top-level `await` so Node's `require(esm)` can load
it as well, which keeps the door open for a non-bundler host.

## Evidence launcher

`boot.mjs` is the one-shot audit wrapper (banana task, resolution capture,
hard assertions that every recorded resolution stays under `vendor/dsh/`).

Observed: final text "banana", 350-entry runtime resolution table, 280
recorded resolutions — every one under `vendor/dsh/node_modules` (hard
assertion), wall ~3.4 s, exit 0. The project `.env` supplies the DeepSeek key
through `loadLayeredEnv`; its value is never read or printed.
