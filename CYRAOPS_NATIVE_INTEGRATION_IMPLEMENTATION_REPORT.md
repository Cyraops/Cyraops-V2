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

## Checkpoint 4 — UI wiring (pending)

## Checkpoint 5 — capability integration (pending)

## Checkpoint 6 — licensing/SBOM (pending)

## Checkpoint 7 — reliability/packaging (pending)

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
