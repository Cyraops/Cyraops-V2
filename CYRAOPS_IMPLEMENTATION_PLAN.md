# Cyraops × DeepSeek Harness — Implementation Plan

## Phase 1 — Audit ✅ (this commit)

- [x] Inspect harness package: identity, license, entry points, profiles, packages
- [x] Headless PoC: measured run, events, session resume
- [x] Adapter + `/api/harness/run` verified through our API
- [x] Deliverable documents (this directory)
- [ ] Remaining: dependency license inventory (`license-checker`), JSON-RPC SDK inspection

## Phase 2 — Minimal headless PoC (in progress)

- [x] One chat request → one harness execution via `src/lib/harness/client.ts`
- [x] Session continuation (`--session-id`) proven; mapped to conversation later
- [ ] Wire the existing bot UI to `/api/harness/run` behind a feature flag
- [ ] Test: streaming events forwarded to our SSE; error when harness missing

## Phase 3 — Runtime adapter & persistence

- [ ] `AgentRuntime` interface + `harnessSessionId` column on `AiConversation`
- [ ] Persistent runtime via `dsh-sdk-jsonrpc-server` (benchmark vs spawn)
- [ ] Cancellation, cleanup, per-tenant cwd, health endpoint, correlation ids

## Phase 4 — Capability integration

- [ ] Cyraops plugin bundle (cordis): register CRM tools, port one at a time
- [ ] Per-tenant tool allowlist; approval surfaced in our UI
- [ ] Compaction policy; token metering per tenant

## Phase 5 — Production hardening

- [ ] Security review, load tests, failure tests, cost metering, backups
- [ ] Deployment/upgrade tests for self-hosted server target

## Phase 6 — Release

- [ ] Pin harness version, SBOM, license notices (THIRD_PARTY_LICENSES_AND_NOTICES.md)
- [ ] Docs: install, configure, upgrade, rollback, support, known limitations

## Risks

| Risk | Likelihood | Mitigation |
| --- | --- | --- |
| Process-per-turn overhead | certain at first | measured 1.6–3.2 s; JSON-RPC runtime is the fix |
| Harness API drift between rc versions | medium | pin version; POC suite gates upgrades |
| Tool porting effort (53 tools) | high | one at a time behind allowlists; keep V1 tools as fallback |
| Prompt injection through CRM data | high | taintsRun + approvals carry over from V1 |
