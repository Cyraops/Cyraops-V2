# Cyraops × DeepSeek Harness — Security & Tenant Isolation

## Threat model

| Actor | Risk | Control |
| --- | --- | --- |
| Tenant A → Tenant B data | cross-tenant read via agent tools/sessions | server-side tenant scoping on every route + tool; harness sessionId is per (tenant, conversation) and never client-visible |
| Prompt injection (web pages, emails, tool output) | agent misled into destructive tool calls | treat all tool output as untrusted; `taintsRun` on reads; consequential tools require approval; no raw shell by default |
| Model API abuse | cost spike | per-tenant token budget, rate limits (`AuthRateLimit` already exists), turn timeouts |
| Secret leakage | key in logs/client bundle | keys only in server env; harness uses its own `DSH_HOME/llm-deepseek` store; redact in logs |
| Local execution (later) | agent with shell on a laptop | off by default, per-capability consent, sandbox (`dsh-bash-sandbox`), allowlisted dirs |
| Harness process compromise | plugin/runtime bug | run harness under a restricted user, network egress allowlist, no access to our DB credentials (it never gets them) |

## Tenancy rules (Phase 3, before multi-tenant use)

1. `tenantId` comes from the authenticated session on the server — **never from
   the client**.
2. One harness session per (tenant, conversation); our DB row `AiConversation`
   stores `harnessSessionId`; lookups filter by tenant.
3. Tool allowlists are per tenant; a tool the tenant hasn't enabled is not
   registered in their runtime profile.
4. The harness cwd is a per-tenant scratch directory (no shared workspace).
5. `--approval-policy never` only for read-only test turns; production uses the
   ask/default policy surfaced through our approval UI.

## Data handling

- Retention: harness session files under `DSH_HOME/sessions` are deleted when
  the conversation is deleted (job + test).
- Export: conversations export through our existing export path.
- Audit: every executed tool call + approval logged with tenant/user/action id.
- Credentials: never stored in our DB; env or the harness's own secret store.
