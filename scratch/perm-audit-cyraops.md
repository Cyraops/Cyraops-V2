# PHASE 1+2 — Cyraops V2 permission-mechanism inventory (CYRAOPS side)

- **Repo:** /Users/tanveersinghsaini/Desktop/cyraops-v2 — branch `dev`, commit `10b339d25fd33bfb1f21085f907f2bb34bebe497`
- **Audit mode:** read-only. No code/config/DB/schema changed. No git operations. Only this file written.
- **Classification key:** `IMPLEMENTED AND VERIFIED` (present in code AND confirmed at runtime or by unit tests) · `IMPLEMENTED BUT NOT VERIFIED` (present in code, not exercised live) · `PARTIALLY IMPLEMENTED` (exists but incomplete/scoped unevenly) · `NOT IMPLEMENTED` (absent) · `SECURITY RISK` (implemented but dangerous as built).
- **Live server used for spot checks:** cyraops-v2 `next dev` on **http://127.0.0.1:3003** (HARNESS_BOT=native, HARNESS_RUNTIME=native). NOTE: port 3001 is a *different* checkout (`locally hosted app dev`) and was NOT used.
- **Related evidence:** harness-side inventory already exists at `scratch/perm-audit-harness.md` (PHASE 4). This file covers the Cyraops app side; findings that touch the harness boundary cite both.

---

## 1. Permission UI

- `[NOT IMPLEMENTED]` **No permission/role/allowlist/approval settings page exists.** `src/app/(workspace)/settings/page.tsx` is a 2-line wrapper; the settings module's "Access & Collaboration Model" section is a **static info card** ("Role-based permissions — Granular access controls enforce…") with no controls behind it — `src/components/modules/settings.tsx:340-355`. Role gates shown there are just `user.role === "OWNER"` visibility conditions.
- `[IMPLEMENTED AND VERIFIED]` **Team member role management UI + server enforcement.** Role dropdown/disable in `src/components/modules/team.tsx:181-227`; writes go to `PATCH /api/team/[id]` which enforces `canManageMember(actor.role, target.role, nextRole)` — `src/app/api/team/[id]/route.ts:13-22`, rules in `src/lib/permissions.ts:3-7` (MEMBER can manage nobody; ADMIN only MEMBER; OWNER not OWNER). Add-member POST enforces actor not MEMBER and role enum `["ADMIN","MEMBER"]` — `src/app/api/team/route.ts:54-66`.
- `[IMPLEMENTED BUT NOT VERIFIED]` **Agent creation UI/server with tool allowlist.** `POST /api/ai/agents` (Owner/Admin only, L30-32) validates every requested tool id against the registry and refuses unknown ids — `src/app/api/ai/agents/route.ts:57-61`. No UI to edit an existing agent's tools was found in `src/app/(workspace)/ai/agents` (page is display + create form only).
- `[IMPLEMENTED AND VERIFIED]` **Assistant approval-mode selector (ASK/AUTO/NEVER)** in `src/components/modules/bot-workspace.tsx:273,464,477` → `PATCH /api/assistant/me`, server whitelists the three values — `src/app/api/assistant/me/route.ts:43-44,57-59`. Enforcement of the mode is server-side in the policy resolver (§3).
- `[IMPLEMENTED BUT NOT VERIFIED]` **Approval review UI for org-wide agent approvals** (`src/app/(workspace)/ai/approvals/page.tsx`) backed by `GET/POST /api/ai/approvals` which 403s MEMBERs — `src/app/api/ai/approvals/route.ts:12,20`.
- `[IMPLEMENTED AND VERIFIED]` **Emergency stop control** `POST /api/ai/admin` (Owner/Admin only, 403 for MEMBER) → `triggerEmergencyStop` pauses RUNNING/PLANNING/WAITING_FOR_AGENT tasks — `src/app/api/ai/admin/route.ts:33-40`, `src/lib/ai/orchestrator/emergency.ts:3-25`.
- `[NOT IMPLEMENTED]` **No UI to manage approval "always allow" rules** beyond the card's checkbox; rules can only be removed via `PATCH /api/assistant/me` `removeRuleFor` — `src/app/api/assistant/me/route.ts:54-60`.

## 2. Roles & RBAC

- `[IMPLEMENTED AND VERIFIED]` **Role enum** `OWNER | ADMIN | MEMBER`, `User.role @default(MEMBER)` — `prisma/schema.prisma:10-14,152`. Session model with hashed token, expiry — `schema.prisma:222-231`.
- `[IMPLEMENTED AND VERIFIED]` **Session auth lib** `src/lib/auth.ts`: `SESSION_COOKIE="company_session"` L6; `userFromRequest`/`currentUser` check token hash, expiry and `user.disabledAt`, delete expired session (L18-36); cookie `httpOnly, secure, sameSite:"lax"` (L45-49). Verified live: every authed route returns 401 without a cookie (§8).
- `[IMPLEMENTED AND VERIFIED]` **CSRF origin check** `sameOrigin()` fails closed (no Origin+no Referer+no Sec-Fetch-Site ⇒ false) — `src/lib/auth.ts:57-92`. Verified live: origin-less POST to harness/run, harness/approve, assistant/actions/confirm → 403 "Invalid request origin" (§8).
- `[NOT IMPLEMENTED]` **No auth in middleware.** `middleware.ts:11-33` only canonicalizes host (apex→www redirect). All authorization is per-route in handlers.
- `[IMPLEMENTED AND VERIFIED]` **Workspace page gate**: `(workspace)/layout.tsx:16-17` server-redirects unauthenticated users to /login.
- `[IMPLEMENTED AND VERIFIED]` **Owner-only workspace settings write** — `src/app/api/workspace/route.ts:65-68`.
- `[IMPLEMENTED AND VERIFIED]` **AI data access rules** `src/lib/ai/access.ts`: Owner/Admin see org-wide agent tasks; Members only their own (L32-39); AI conversations strictly private to owner at every role (L50-53); `aiTaskVisibilityWhere` where-fragment (L58-60). Applied in `src/app/api/ai/goals/route.ts:15`.
- `[IMPLEMENTED AND VERIFIED]` **Project delivery data gate** `src/lib/project-access.ts:8-17` (Owner/Admin or ProjectMember) — closes the earlier milestone hole.
- `[IMPLEMENTED BUT NOT VERIFIED]` **AI provider management Owner/Admin only** — `src/app/api/ai/providers/route.ts:7-8,34,46`.

## 3. Tool-level permissions (CRM tools, registry, dispatch)

- `[IMPLEMENTED AND VERIFIED]` **Tool metadata vocabulary** `src/lib/ai/tools/types.ts:24-43`: `riskClass`, `requiresApproval`, `readOnly`, `taintsRun`, `externalRead`, `persistsContent`, `explicitApproval` ("can never be permanently allowed or auto-approved", L39-40).
- `[IMPLEMENTED AND VERIFIED]` **Single policy decision point** `src/lib/ai/policy/resolve-action.ts` (unit-tested in `resolve-action.test.ts`):
  - DENY rule wins over everything, every mode, taint (L88-95);
  - `explicitApproval` tools always `ask`, `canAlwaysAllow:false`, and are denied under NEVER+taint (L99-114);
  - readOnly reads are free except tainted+`externalRead` (L121-139);
  - `persistsContent` + taint ⇒ ask (L143-150);
  - standing ALLOW rule is ignored once the run is tainted (L177-184);
  - mode NEVER: tainted ⇒ deny, else allow (L187-204); AUTO passes untainted reads (L206-213); default ask (L215-222).
- `[IMPLEMENTED AND VERIFIED]` **Turn loop enforces the resolver before every tool call** — `src/lib/ai/orchestrator/agent-turn.ts:269-303`; CLASS_C tools are *offered* to the model but never execute without the gate (L133-143); one pending action card per turn; `runTainted` set by `tool.taintsRun` (L318).
- `[IMPLEMENTED AND VERIFIED]` **Tool inventory** `src/lib/ai/tools/crm-tools.ts` (48 tools). Highlights:
  - CLASS_C + `explicitApproval`: `delete_contact` (L809-828), `send_email` (L1058-1122); CLASS_C: `execute_routine` (L1237-1262);
  - CLASS_B + `requiresApproval:true`: `create_event` L749, `archive_task` L789, `create_routine` L1030, `browser_navigate` L1274, `browser_click` L1342, `browser_type` L1361;
  - CLASS_B + `requiresApproval:false` (ask only under ASK mode): create/update contact/company/lead/deal, `create_task`, `update_task`, `draft_email`;
  - readOnly/taint flags: `search_documents` L682-683, `summarize_thread` L1195-1196, `browser_extract` L1294-1297 (`externalRead`).
- `[IMPLEMENTED AND VERIFIED]` **Registry safety** `src/lib/ai/tools/registry.ts`: secret masking of tool inputs/outputs by key name (L4-26); idempotency replay prevention incl. ambiguous in-flight mutation pause (L57-94); pre-log RUNNING + final AiToolCall rows (L99-179).
- `[IMPLEMENTED AND VERIFIED]` **Approval execution path** `src/lib/ai/assistant/runtime.ts:408-465` `decidePendingAction`: pending action must belong to the deciding user, atomic `updateMany` claim (two clicks can't double-run), "always allow" persisted as `AssistantApprovalRule` only when `!tool.explicitApproval` (L452-462).
- `[IMPLEMENTED AND VERIFIED]` **Confirm route** `src/app/api/assistant/actions/confirm/route.ts:7-10` sameOrigin + userFromRequest; decision executed server-side.
- `[IMPLEMENTED AND VERIFIED]` **Assistant tool surface is a fixed allowlist** `ASSISTANT_TOOL_IDS` — `src/lib/ai/assistant/runtime.ts:21-43`; resolved against the registry at call time (L59-63).
- `[SECURITY RISK]` **Member scoping inside CRM tools is uneven.** `search_deals`/`get_deal` scope Members to `ownerId` (crm-tools.ts L419, L438) and `search_tasks` to assignee/creator (L566-568), but `update_deal` (L478-484), `analyze_deal` (L494-498), `create_deal` (L456-467, no owner set), `get_contact`/`search_contacts`/`search_companies`/`get_company` (L78-200) have **no per-user scoping at all** — a MEMBER's assistant can read or update records it does not own. Reports are the only admin-gated reads (L591-593, L631-633, L652-654).

## 4. Agent-level permissions

- `[IMPLEMENTED]` **AiAgent fields** `tools` (JSON allowlist) and `permissions` (JSON string, `@default("[]")`) — `prisma/schema.prisma:878-879`; 7 core agents seeded with per-agent tools + permission strings — `src/lib/ai/agents/definitions.ts:15-200`, `agent-registry.ts:22-77` (templates protected via `isTemplate`, L41).
- `[NOT IMPLEMENTED]` **`AiAgent.permissions` is cosmetic.** Grep of all enforcement paths shows it is only seeded (`agent-registry.ts:44,62,66,121,146`), copied (`src/app/api/ai/agents/route.ts:50,77`), and displayed. No code ever checks `permissions` to allow/deny anything.
- `[PARTIALLY IMPLEMENTED]` **Per-agent tool allowlist** — planner builds the model catalog from `agent.tools` only (`src/lib/ai/orchestrator/planner.ts:48-106`), but the dispatcher executes whatever `toolId` a plan step carries with no re-check against the agent's allowlist (`src/lib/ai/orchestrator/dispatcher.ts:300` area; risk comes from the registered tool, L300). Constraint is prompt-level, not a hard server gate.
- `[IMPLEMENTED AND VERIFIED]` **Teammate chat honors agent tools/status** — `sendAssistantMessage` loads the agent row, requires `status:"ACTIVE"`, and passes `agent.tools` as the model tool list — `src/lib/ai/assistant/runtime.ts:490-494,586-595`.
- `[IMPLEMENTED AND VERIFIED]` **Background dispatcher approval** = `step.requiresApproval || tool.requiresApproval || tool.riskClass === "CLASS_C"` — `src/lib/ai/orchestrator/dispatcher.ts:300`; policy mode/rules loaded from the requester's Assistant (`loadDispatchPolicy`, L59).

## 5. Workspace / tenant scoping

- `[NOT IMPLEMENTED]` **Schema has no workspace/tenant column on domain tables.** `Workspace` is a singleton (`id @default("main")`, 1:1 `ownerId`) — `prisma/schema.prisma:394-413`. Task/Contact/Deal/CalendarEvent carry no `workspaceId`; tenant-stable keys are user ids (Task.creatorId/project.ownerId, CalendarEvent.creatorId).
- `[PARTIALLY IMPLEMENTED]` **Harness tenant scoping is a query-level env filter, not row-level security.** `CYRAOPS_WORKSPACE_ID` = calling user's id: set per-spawn for CLI (`src/lib/harness/cli-runtime.ts:152-154`) and via process.env under the global turn mutex for native (`src/lib/harness/native-runtime.ts:192-194`); route passes `workspaceId: user.id` (`src/app/api/harness/run/route.ts:50,66-67`).
- `[PARTIALLY IMPLEMENTED]` **Bridge scoping** `src/lib/harness/plugins/cyraops-crm/lib/bridge.mjs`: `taskTenantWhere` = creator OR project owner (L88-91); `updateTicket` where-clause scoped, cross-tenant id fails "not found in this workspace" (L397-415); `scheduleEvents` scoped by creatorId (L309-330); **`searchContacts` has no tenant filter — searches the whole DB** (L271-298), explicitly documented as a limitation (L61-68); **unset `CYRAOPS_WORKSPACE_ID` ⇒ whole-DB legacy behavior** (L88-90, L64-68).
- `[PARTIALLY IMPLEMENTED]` **App-side API mirrors the same gap**: `GET /api/crm/contacts` returns all contacts for any role (no where-clause ownership filter) — `src/app/api/crm/contacts/route.ts:32-67`.
- `[SECURITY RISK]` **Harness session resume is not tenant-checked.** `/api/harness/run` resolves `sessionId` from the process-wide map with no ownership comparison (`harness/run/route.ts:42-58`; `cli-runtime.ts:193-195`); the turn then runs under the *caller's* tenant env. A user who learns another user's session id could resume their harness conversation. Mitigated today only by unguessable ids (randomUUID); no server-side check exists.

## 6. Filesystem / shell exposure

- `[IMPLEMENTED AND VERIFIED]` **Cyraops CRM tools expose NO shell/fs.** Grep for `child_process|exec|spawn|fs.readFile` in `src/lib/ai` and `src/app/api` returns zero hits. The only process boundary in the app is Playwright: `chromium.launch({ headless: true, args: ["--no-sandbox", ...] })` — `src/lib/ai/browser/browser-runtime.ts:183-190`.
- `[SECURITY RISK]` **The harness bot engine IS a shell/fs boundary, and it inherits the full server environment.** CLI runtime spawns `dsh --profile headless --json --approval-policy never` with `cwd: process.cwd()` (repo root) and `env: { ...process.env, CYRAOPS_WORKSPACE_ID }` — `src/lib/harness/client.ts:56,62-66`, `cli-runtime.ts:144-159`. The child process receives **every server secret** (DATABASE_URL, OPENAI/DEEPSEEK keys, LIVEKIT secret, GODADDY password — §9).
- `[IMPLEMENTED AND VERIFIED]` **Bot boot profile mounts bash/fs tools to the model.** Profile composition `vendor/tooling/vendored-boot/profile/package.json:8-16` = `dsh-base` → `dsh-headless` → `@cyraops/harness-crm` (profile `cordis.yml` and `cordis.patch.yml` are both `[]`; the whole entry list comes from bundle patches). `dsh-base/cordis.patch.yml` inserts `tool-bash` (L281-283), `tool-pwsh` (L285-287), `tool-fs` (L296-298, `applyPatch:false`), `tool-fs-search` (L302-304), `tool-executor-native/ptc` (L501-505) — **none are disabled for the bot profile**.
- `[PARTIALLY IMPLEMENTED]` **Sandbox gating of those tools**: headless layer sets sandbox-policy `mode: DSH_PERMISSION_MODE ?? 'workspace-write'`, `workspaceRoot: process.cwd()` (`vendor/dsh/node_modules/@deepseek-ai/dsh-headless/cordis.patch.yml:29-33`). Escalation beyond workspace-write requires approval; CLI runs `--approval-policy never` ⇒ `decide()` returns `rejected` before any answerer (`vendor/dsh/node_modules/@deepseek-ai/dsh-user-approval/lib/index.js:200`); native runs `approvalPolicy:"ask"` (`native-runtime.ts:229`) but the only `approval/request` answerer mounted is the CRM plugin's, which passes non-`cyraops_update_ticket` asks through → `unavailable` (denied). **Net: model can run bash and write inside the repo root without approval; anything beyond that fails closed.**
- `[IMPLEMENTED BUT NOT VERIFIED]` **The CRM plugin's one write tool** (`cyraops_update_ticket`) is gated by a `tools/pre-execute` ask and an `approval/request` answerer wired to the Next-side `approvalBroker` — `src/lib/harness/plugins/cyraops-crm/lib/index.js:451-462,473-495,504-508`. Not exercised live in this audit.

## 7. Chat & voice approvals

- `[IMPLEMENTED AND VERIFIED]` **Chat approval card flow** — pending action rows (`AssistantPendingAction`) created server-side per turn (`runtime.ts:613-637`); UI `decide()` in `src/components/modules/bot-workspace.tsx:1034-1065` posts to `/api/assistant/actions/confirm` (or `/api/harness/approve` when `via==="harness"`, L1038-1044).
- `[IMPLEMENTED AND VERIFIED]` **Harness approval endpoint** — `POST /api/harness/approve` sameOrigin + auth, `approvalBroker().decide(id, approve)` grants exactly one run (`allowed-once`); unknown/decided ids → 404 — `src/app/api/harness/approve/route.ts:20-40`; broker auto-rejects on 60s timeout — `src/lib/harness/approval-broker.ts:111`.
- `[IMPLEMENTED AND VERIFIED]` **Native runtime relays approval events as SSE** (`approval`/`approval_decided`) into bot-stream — `src/lib/harness/native-runtime.ts:199-219`, `src/lib/harness/bot-stream.ts:20-25,128-130`.
- `[IMPLEMENTED AND VERIFIED]` **Voice-mode approval** — `decideApproval` in `src/components/ai/voice-mode.tsx:1028-1055` routes the decision to harness vs assistant confirm; `/api/voice/confirm` verifies `pending.userId === user.id` before executing (`src/app/api/voice/confirm/route.ts:26-30`); voice chat prompt directs high-impact actions to tools so the server registers confirmation cards (`src/app/api/voice/chat/route.ts:35`).
- `[IMPLEMENTED BUT NOT VERIFIED]` **Unattended runs** (routines/webhook/email) — policy resolver turns asks into "waits for you in the conversation" cards (`resolve-action.ts:218-221`); goal-runner pauses the team and notifies (`src/lib/ai/team/goal-runner.ts:237-247`).

## 8. API / external access

- `[IMPLEMENTED AND VERIFIED]` **150 route files** under `src/app/api`. 9 without session auth, each with its own rationale:
  - `auth/login` (sameOrigin + `AuthRateLimit`: 12 fails / 15 min per IP *and* per email, sha256-keyed — `login/route.ts:11-27`), `auth/logout`, `auth/setup` (setup token);
  - `health` — public DB ping (`health/route.ts`);
  - `intake/[token]` + `intake/[token]/email` — bearer-token machine intake, 240 calls/hr cap, token hash stored (`intake/[token]/route.ts:1-34`);
  - `routines/hooks/[token]` — webhook token, uniform 404 on bad token (`routines/hooks/[token]/route.ts:7-13`);
  - `public/inquiries` — public form handler (`public/inquiries/route.ts`);
  - `calls/webhook` — LiveKit signature header verification (`calls/webhook/route.ts:28-42`).
- `[IMPLEMENTED AND VERIFIED]` **Live spot checks** (cyraops-v2 dev server, port 3003, no cookie):
  - `GET /api/health` → **200** `{"status":"ok","database":"connected"}` (intended public);
  - `GET` tickets, crm/contacts, calendar, computer/local, assistant/me, team, ai/agents, pages, files, workspace → **401**;
  - `POST /api/harness/run`, `/api/harness/approve`, `/api/assistant/actions/confirm` (origin-less) → **403 "Invalid request origin"**;
  - `POST /api/assistant/chat`, `/api/voice/confirm`, `/api/ai/agents` → **401**;
  - `GET /api/harness/run`, `GET /api/harness/approve` → **405** (route exists, POST-only);
  - `GET /api/routines/hooks/badtoken` → **405**; `GET /api/intake/badtoken` → **401**.
- `[IMPLEMENTED AND VERIFIED]` **In-app rate limits** — chat 30 msgs/min (`src/lib/ai/assistant/guard.ts:5-18`), daily AI spend $2/user (`guard.ts:20-37`).
- `[SECURITY RISK]` **20 authenticated mutating routes skip `sameOrigin`** (defense-in-depth gap; primary mitigation is the SameSite=Lax cookie): `ai/admin, ai/agents, ai/approvals, ai/computer, ai/conversations, ai/conversations/[id]/messages, ai/dispatch, ai/providers, ai/providers/[id], ai/skills, ai/tasks/[id], assistant/chat, assistant/chat/stream, dashboard/improvements/convert, dashboard/intake, dashboard/skills, presence, voice/chat, voice/confirm, voice/settings`.
- `[IMPLEMENTED BUT NOT VERIFIED]` **Public page share** is a deliberate revocable token (`regenerate` mints new slug) scoped to the page owner — `src/app/api/pages/[id]/share/route.ts:15-39`.

## 9. Secrets

- `[IMPLEMENTED AND VERIFIED]` **No `NEXT_PUBLIC_*` anywhere** in `src` or `public` (grep: zero hits). All env reads are server-side (`process.env.*` in `src` only; 150+ reads, all backend).
- `[IMPLEMENTED AND VERIFIED]` **`.env` secrets** (values not read during audit): DATABASE_URL, INITIAL_SETUP_KEY, OPENAI_API_KEY, DEEPSEEK_API_KEY, LIVEKIT_API_KEY/SECRET, GODADDY_EMAIL_PASSWORD — none referenced by client bundles.
- `[IMPLEMENTED AND VERIFIED]` **BYO provider keys encrypted at rest** — AES-256-GCM, key from `AI_KEY_ENCRYPTION_SECRET` (feature disabled if absent, no plaintext fallback), display masked to last 4 — `src/lib/ai/crypto.ts:1-50`, `src/app/api/ai/providers/route.ts:89`.
- `[SECURITY RISK]` **Full env inheritance into the model-bash-capable bot process** — CLI spawn `env: { ...process.env }` (`client.ts:63`, `cli-runtime.ts:152-154`); the native in-process harness shares `process.env` by definition. The mounted `tool-bash` (§6) can read these values inside a turn. Boundary to record, not a leak to the browser.

## 10. Audit logging

- `[IMPLEMENTED AND VERIFIED]` **`AiAuditLog` model** — `eventType, entity, entityId, actorId, actorType, details(JSON), ipAddress` (`schema.prisma:1192-1204`); writers: tool executions for mutating tools with masked input (`src/lib/ai/tools/registry.ts:181-208`), approval decisions (`src/lib/ai/orchestrator/approval.ts:87-99`), task-runner events (`automation/task-runner.ts:91-103`), emergency stop (`orchestrator/emergency.ts:26-36`).
- `[IMPLEMENTED AND VERIFIED]` **`AiToolCall` ledger** pre/post records with masked input/output — `registry.ts:99-179`; `Activity` rows for CRM writes via `logActivity` — `src/lib/auth.ts:94-96`.
- `[SECURITY RISK]` **Two audit writers pass a non-existent `action` column and the writes fail.** `AiAuditLog` has no `action` field, yet `task-runner.ts:98` and `emergency.ts:32` pass `action:`. `task-runner` swallows the error (audit silently missing); `emergency.ts` does **not** catch, so `POST /api/ai/admin` EMERGENCY_STOP pauses the tasks and then throws → 500, and the audit row never lands. (`registry.ts:194-196` documents and avoids this exact bug.)
- `[IMPLEMENTED]` **No sensitive `console.log`** — 6 `console.log` sites total, all operational (scheduler, sync worker, dispatcher claim) with no action payloads.

---

## Four-mode mapping (READ ONLY / CONTROLLED ACCESS / FULL CONTROL / SYSTEM ACCESS)

| Mode | What exists | Enforced where | Classification |
|---|---|---|---|
| **READ ONLY** | CLASS_A readOnly tools execute with no card (`resolve-action.ts:121-139`); tainted-run external reads (browser_extract) still ask; harness preset `read-only` exists in the preset catalog but Cyraops never selects it (default is workspace-write). Member-level *row* scoping for reads is partial (§3/§5). | Server-side — policy resolver; unit-tested. | PARTIALLY IMPLEMENTED (policy solid, data scoping uneven) |
| **CONTROLLED ACCESS** | CLASS_B/C + `requiresApproval` tools produce one approval card per turn (`agent-turn.ts:291-303`); `explicitApproval` tools (send_email, delete_contact) can never be always-allowed (`resolve-action.ts:99-114`, `runtime.ts:452-462`); standing ALLOW rules from cards (`AssistantApprovalRule`); taint blocks steered writes in every mode (L177-184, L190-197); harness write tool `cyraops_update_ticket` gated by approval service + broker + `/api/harness/approve` (native only); voice confirm checks requester identity (`voice/confirm/route.ts:26-30`); dispatcher requires approval for CLASS_C/step-required (`dispatcher.ts:300`). | Server-side everywhere. Endpoints verified 401/403 live; full approve→execute flow not re-run live. | IMPLEMENTED AND VERIFIED (flow logic) / IMPLEMENTED BUT NOT VERIFIED (live execution) |
| **FULL CONTROL** | Owner/Admin role gates on team/workspace/agents/approvals/providers/goals/admin/report tools (all server-side, §2); per-user assistant approvalMode ASK/AUTO/NEVER (`assistant/me` + resolver L187-213). No role-to-tool matrix; `AiAgent.permissions` is decorative (NOT IMPLEMENTED). | Server-side role checks per route; mode enforced in resolver. | IMPLEMENTED AND VERIFIED for role gates; NOT IMPLEMENTED for agent permission strings |
| **SYSTEM ACCESS** | Harness bot engine (native/CLI): bash/fs/fs-search/executor tools mounted to the model (boot profile §6); sandbox workspace-write with workspaceRoot = repo root; CLI `--approval-policy never` (escalations auto-rejected), native `ask` with no answerer for non-CRM tools (fail closed); full `process.env` inherited by the spawned `dsh`; tenant scoping = query-level `CYRAOPS_WORKSPACE_ID` filter, unset ⇒ whole DB. No Cyraops UI exposes permission presets; HARNESS_BOT/HARNESS_RUNTIME/DSH_PERMISSION_MODE are env-only switches. | Enforced by the harness sandbox/approval stack inside the spawned process; tenant filter applied by the bridge; nothing in Cyraops UI. | PARTIALLY IMPLEMENTED + SECURITY RISK (env inheritance; bash within workspace-write runs without approval; single-workspace DB) |

**UI-only vs server-side:** every mode's *decision* is server-side (resolver, role checks, broker, sandbox). The only UI-only artifacts are the static settings "permission" card (settings.tsx:348), agent `permissions` strings, and client-side button visibility; none of those are security boundaries.

## Spot-check command outputs (cyraops-v2 dev server, port 3003)

```
GET /api/health               -> 200  {"status":"ok","database":"connected"}
GET /api/tickets              -> 401
GET /api/crm/contacts         -> 401
GET /api/calendar             -> 401
GET /api/computer/local       -> 401
GET /api/assistant/me         -> 401
GET /api/team                 -> 401
GET /api/ai/agents            -> 401
GET /api/pages                -> 401
GET /api/files                -> 401
GET /api/workspace            -> 401
GET /api/harness/run          -> 405 (POST-only route exists)
GET /api/harness/approve      -> 405 (POST-only route exists)
POST /api/harness/run         -> 403 {"error":"Invalid request origin"}   (origin-less)
POST /api/harness/approve     -> 403 {"error":"Invalid request origin"}   (origin-less)
POST /api/assistant/actions/confirm -> 403 {"error":"Invalid request origin"}
POST /api/assistant/chat      -> 401 {"error":"Unauthorized"}
POST /api/voice/confirm       -> 401 {"error":"Unauthorized: Invalid session."}
POST /api/ai/agents           -> 401 {"error":"Unauthorized"}
GET /api/routines/hooks/badtoken -> 405
GET /api/intake/badtoken      -> 401
```

Commands: `curl -s -o /dev/null -w "%{http_code}" http://127.0.0.1:3003/api/<path>` and origin-less `curl -s -X POST ... -H "Content-Type: application/json" -d '{...}'`. NOTE: `http://127.0.0.1:3001` is a *different* checkout (`locally hosted app dev`) — V1 territory, deliberately untouched; all checks above target 3003.
