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

## Checkpoint 2 — PoC results (pending)

_(filled after workstream A returns and the PoC is re-run here)_

## Checkpoint 3 — runtime adapter (pending)

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
