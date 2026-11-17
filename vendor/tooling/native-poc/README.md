# In-process harness boot — proof (verified 2026-11-18)

`boot.mjs` boots the `headless` harness bundle tree **inside our own Node
process** — no `dsh` CLI subprocess — and runs two turns: a fresh task, then a
second tree in the same process resuming the first session. Exit 0 after
graceful shutdown via `ctx.fiber.dispose()`.

Boot mechanism (traced from the compiled distribution):
1. `loadLayeredEnv("dsh", <projectDir>)` provides the launch environment
   (DeepSeek key comes from the project `.env` layer — value never read).
2. `boot(...)` from `@deepseek-ai/dsh-app-boot` creates the cordis `Context`,
   provides `dshHomePath`, mounts the loader, then mounts the profile tree from
   `cordis.yml` + the patch stack (`@deepseek-ai/dsh-base` +
   `@deepseek-ai/dsh-headless` bundle layers).
3. `PluginPackages` installs module-resolution interception so bare specifiers
   resolve from the distribution's `node_modules`.
4. `provideCmdline` is the launcher-owned hook: we pass our own `appExit`
   callback, so the mounted `dsh-headless` runner finishes a turn **without
   exiting the process**.

Observed (re-run by the parent agent):
- turn 1: session `session-847b9af1…`, final text `banana`
- turn 2: same sessionId, thinking recalls "The previous reply was …", `banana`
- 5.05 s wall for both turns, 253 MB peak RSS, exit 0
- CLI baseline for one turn: 3.46 s, 246 MB peak RSS — format-identical NDJSON

Known limitation: a one-shot runner refuses `--session-id` while the session is
live in the same tree, so multi-turn here = two sequential tree boots. A
single-tree second turn would drive `agents.get(id).followup()` directly.

Next step: resolve the same tree from `vendor/dsh/` (this script still points at
the distribution install) — the decisive test of the vendored tarball.
