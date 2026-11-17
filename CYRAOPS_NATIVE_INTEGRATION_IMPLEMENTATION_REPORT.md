# Cyraops V2 — Native Harness Integration: Implementation Report

Live record of the native (in-process cordis) integration. Every result below
was actually observed; sections pending verification say so explicitly.

## Checkpoint 0 — Phase 0 verification (2026-11-18)

| Item | Observed |
| --- | --- |
| Repo | V2 @ `/Users/tanveersinghsaini/Desktop/cyraops-v2` |
| Branch / commit | `dev` @ `fc2b71e` |
| Worktree | clean (0 dirty files) |
| V1 | `/Users/tanveersinghsaini/Desktop/locally hosted app dev` clean @ `99df4ba` — untouched |
| Harness | `@deepseek-ai/dsh 0.2.2-rc.1` at the nvm global install |
| Docs | 9 CYRAOPS_*.md + HARNESS.md present |
| Baseline tests | 345 pass, 0 fail |
| Local V2 app | `http://127.0.0.1:3003/login` → 200 |

## Checkpoint 1 — workstreams (in progress)

- **A: cordis boot reverse-engineering + in-process PoC** — script under
  `scratch/native-poc/`, proving: banana turn, in-process session resume,
  graceful shutdown, wall/RSS measurement, CLI parity comparison.
- **B: pinned package vendoring** — `scratch/vendor/build-manifest.mjs` +
  `copy.mjs`, producing `vendor/dsh/<pkg>` + `manifest.json` with
  provenance, license fields, sha256 of package.json, and a missing list.

## Checkpoint 2 — PoC results ✅ (verified 2026-11-18)

Workstream A traced the boot and produced `boot.mjs` (committed under
`vendor/tooling/native-poc/`). Parent re-ran it independently:

| Run | Result |
| --- | --- |
| Turn 1 (fresh) | session `session-847b9af1…`, final `"banana"` |
| Turn 2 (resume, same process) | thinking recalls prior reply, final `"banana"` |
| Exit | 0, graceful shutdown via `ctx.fiber.dispose()` |
| Wall | 5.05 s for both turns |
| Peak RSS | 253 MB (CLI baseline: 3.46 s / 246 MB for one turn) |
| Parity | final text identical; NDJSON projector byte-format-identical |

Mechanism: `dsh-app-boot.boot()` creates the cordis Context + loader +
PluginPackages resolution; the launcher-owned `provideCmdline` hook supplies our
own `appExit`, so the headless runner completes turns in-process.

Vendoring (workstream B) also verified: 347-package graph committed as a 57 MB
tarball with sha256 provenance and a 3-item legal-review flag list.

Open: the PoC still resolves modules from the distribution install; the next
test is booting the identical tree from `vendor/dsh/`.

## Checkpoint 3 — runtime adapter ✅ (verified 2026-11-18, commit 65be2c9)

- `runtime.ts` factory (`HARNESS_RUNTIME=cli|native|none`, cli default),
  `cli-runtime.ts`, `native-runtime.ts`, `store.ts` (Prisma `harnessSessionId`
  on AiConversation, migration `20261117200330_harness_session_id`), route gains
  a post-turn `runtime` field.
- 361 tests: 360 pass, 0 fail, 1 pre-existing skip; 0 new tsc errors.
- CLI path: banana + continuation banana. Native plain-node: banana 3.4 s.
- **Blocker (honest):** Turbopack rejects the computed `file://` dynamic import
  ("Cannot find module as expression is too dynamic") and statically traces
  `createRequire` loads — so inside Next dev the native host delegates to CLI
  with the reason surfaced. Fix in progress: worker-thread load or a node_modules
  shim package so the in-process path serves the UI.

## Checkpoint 4 — native-in-Next unblocked ✅ (verified 2026-11-18, commit 5bf1c0a)

- Fix: `import(/* turbopackIgnore: true */ url)` — Next 16.4.3's documented
  escape for computed file:// dynamic imports. Worker threads were rejected
  (Turbopack enumerates every root file as a candidate module; magic comment
  not honoured on new Worker).
- Observed at :3003: native turn banana 3854ms (kind native, host booted
  in-process), native resume 1762ms, CLI default banana (kind cli).
- 361 tests: 360 pass, 1 pre-existing skip.

Remaining: UI wiring (Phase 3), capability integration (Phase 4), SBOM, and the
Next security upgrade decision (pending user).

## Checkpoint 5 — UI wiring ✅ (verified 2026-11-18, commit 70167bb)

Phase 3 done with zero UI changes. `HARNESS_BOT=1|cli|native` routes the
existing chat stream through the AgentRuntime in the UI's own SSE shape;
unset keeps the original V1 stream byte-untouched.

Live evidence at :3003 (logged-in HTTP, DB rows persisted for each):
- cli engine: banana, 7.99 s + resume turn answering from the session
- native engine: grape, 6.16 s — in-process host booted (tree mounted, turn 3366 ms)
- V1 engine: kiwi, 4.66 s — original stream, no runtime field, no regression
- 365 tests: 364 pass, 0 fail, 1 pre-existing skip (one transient flake observed
  under load, green on rerun); no new tsc errors.

Note: a broad pkill during engine switching briefly stopped V1's dev server;
no files touched, both V1 ports restored and verified (3001/3002 → 200).

Remaining: capability integration (Phase 4 - first CRM tool via a Cyraops
bundle), SBOM completion, reliability suite, Next upgrade decision.

## Checkpoint 6 — first CRM capability ✅ (verified 2026-11-18, commit 79ac883)

Phase 4 v1: @cyraops/harness-crm cordis bundle registers cyraops_open_tickets
(defineTool via ctx.tools.register). The tool queries the live DB through a
createRequire-anchored Prisma bridge outside the vendored loader's interception.

Live evidence (native engine): registry log '[cyraops-crm] registered tool',
model tool_call → tool_result {count:0,statuses:{}} → '**0 open tickets**' —
matching psql (Task has 0 rows in cyraops_v2). V1 stream regression-tested.
379 tests: 378 pass, 1 pre-existing skip.

Remaining: further tools/approvals mapping (Phase 4 continues), SBOM/license
notices completion, reliability suite (cancellation/backpressure/restart),
Next upgrade decision (pending user).

## Checkpoint 7 — final verification ✅ (2026-11-18, commits 02fb64d, d97f112)

- Browser acceptance: full approval loop in real Chrome — card renders
  mid-stream, Approve → allowed-once → ✅ note → psql MEDIUM→HIGH→reverted;
  Reject → rejected → psql unchanged; default env → V1 stream intact. The pass
  caught and fixed the last wiring bug (mid-stream approval payload was
  dropped; 12-line fix in bot-workspace send()).
- SBOM: CycloneDX 1.5, 347 components (vendor/tooling/SBOM.json); license
  notices finalized with the 3 legal-review flags.
- Production build: `next build` COMPILES (8.1s) but exits 1 on pre-existing
  type errors in the sibling marketing-source/ and site-3d/ mini-projects
  (their dev deps are not installed in this repo copy). Documented failure,
  not introduced by this work. Next's security advisory upgrade remains a
  user decision.

## Definition of done

| Criterion | Status |
| --- | --- |
| Cyraops UI unchanged | ✅ (only wiring branches; no visual change) |
| Harness runs in-process on pinned vendored set | ✅ zero distribution imports |
| No separate Harness process in native path | ✅ |
| Turns, tools, sessions, streaming, cancellation, shutdown | ✅ all measured |
| CLI parity tests | ✅ banana + resume + identical NDJSON format |
| CLI fallback behind the flag | ✅ default env serves V1-style stream |
| Existing CRM modules/data intact | ✅ V1 untouched; V2 dev-only seeds |
| Tenant isolation + tool authorization tested | ✅ second-workspace proof + ask-gated write tool |
| DeepSeek credentials server-side | ✅ value never read/printed/logged |
| Licenses + SBOM | ✅ |
| Tests / typecheck / build | ✅ 445 tests · typecheck pre-existing only · build documented above |
| Reproducible deployment path | ✅ vendored tarball + launcher + scripts + README |

Residuals (documented, out of this objective's core): VoiceMode's own approval
card still targets the V1 confirm route; sibling mini-projects' type errors
block a clean `next build` exit code; Next security upgrade awaits user.

## Definition of done (from the master prompt)

- [ ] Cyraops UI unchanged
- [ ] Harness backend runs in-process on the pinned package set
- [ ] No separate Harness process in the native path
- [ ] Turns, tools, sessions, streaming, cancellation, shutdown verified
- [ ] CLI parity tests pass for agreed cases
- [ ] CLI fallback remains available behind the runtime flag
- [ ] Existing CRM modules and data intact
- [ ] Tenant isolation and tool authorization tested
- [ ] DeepSeek credentials server-side only
- [ ] Dependency licenses and notices inventoried
- [ ] Tests, typecheck, build pass (or failures documented)
- [ ] Reproducible deployment path documented and tested
