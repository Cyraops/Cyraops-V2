# Cyraops × DeepSeek Harness — Distribution & Deployment

**User decision (2026-11-18): no downloadable desktop app in this scope.** V2 is
a hosted/local web application; all changes go to the V2 repo `dev` branch.

## Deployment targets

| Target | What runs locally | What runs remotely |
| --- | --- | --- |
| Local dev (current) | `next dev` on `:3003`; `dsh` spawned per turn on the same machine | DeepSeek API only |
| Self-hosted server | Next.js + Node ≥ 24.9 (harness requirement) + Postgres + `dsh` | DeepSeek API |
| Managed cloud (later) | nothing | the whole stack |

No target bundles secrets into a client: keys live in server env
(`HARNESS_BIN`, `HARNESS_PROFILE`, DeepSeek credentials via the harness's own
store). The DeepSeek API requires internet connectivity — the product is not
offline, and we do not claim otherwise.

## Install / update / rollback (server)

- Install: copy repo, `npm ci`, provide `DATABASE_URL` + harness binary, migrate.
- Update: bump `@deepseek-ai/dsh` install, re-run POC suite, restart service.
- Rollback: restore previous harness install; our adapter's interface is stable.
- Backups: Postgres dumps + `DSH_HOME` session dir; restore procedure in ops runbook (Phase 5).

## Diagnostics

- Health: `/api/harness/run` returns `ms`, `steps`, `sessionId`; a dedicated
  `/api/harness/health` (Phase 3) reports runtime reachability without spending
  tokens.
- Logs: structured, with correlation id per turn; harness stderr captured.
- Uninstall: remove service, drop DB, delete `DSH_HOME` profile data — documented at release.
