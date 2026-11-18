# Phase A — per-conversation workspace roots: implementation evidence

Backend only. Branch `dev`, base commit `bc9fe62`. No commits made; changes are
working-tree only.

## 1. Schema / migration

- `AiConversation` gains `workspaceRoot String?` (the owner-supplied spelling)
  and `workspaceRootRealpath String?` (the server-resolved canonical path).
  `null` on both = CRM mode today (`prisma/schema.prisma`, AiConversation).
- The harness bot chat's turn path actually turns under `AssistantConversation`
  (`resolveConversation` in `src/lib/ai/assistant/runtime.ts`; the session
  store's AiConversation lookup by assistant-conversation id falls back to its
  in-memory map — the two surfaces are distinct). The SAME two columns
  therefore also exist on `AssistantConversation`; the chat stream route reads
  the root from there. AiConversation carries the field per the Phase A spec
  and its API/read payloads are wired; the columns are ready for when the
  agents' conversation path adopts the harness runtime.
- Migration: `prisma/migrations/20261118201234_conversation_workspace_root`
  (name `conversation_workspace_root`), applied to **cyraops_v2** (dev) and
  **cyraops_test** (`prisma migrate deploy` with DATABASE_URL overridden).
  SQL is two additive `ALTER TABLE ... ADD COLUMN` statements, one per table.
- Where else was considered: a per-workspace default root on `Workspace`
  (schema has none today). Rejected as the authoritative location because the
  root is a per-conversation property (two conversations in one workspace can
  work on different projects), and the conversation row is already the scope
  that carries the harness session id. A future `Workspace.defaultWorkspaceRoot`
  could seed new conversations; the conversation value would still win.

## 2. Security model (server-enforced)

Pure rules live in `src/lib/harness/workspace-root.ts` and are unit-tested with
an injected fake fs (`src/lib/harness/workspace-root.test.ts`):

- `normalizeWorkspaceRoot(path, fs)` — trimmed, absolute, exists, is a
  directory; returns the realpath. Typed `WorkspaceRootError`
  (`NOT_ABSOLUTE` / `NOT_FOUND` / `NOT_DIRECTORY`) mapped to HTTP 400.
- `workspaceRootForTurn({ actorId, conversationOwnerId, workspaceRootRealpath })`
  — the turn-level owner gate: only the conversation owner's turns run under
  the recorded realpath; every other caller's turn resolves `null` (CRM mode).
  The chat stream route applies it with `conversationOwnerId = assistant.userId`
  (`src/app/api/assistant/chat/stream/route.ts`), so even a future shared
  thread cannot leak the root to a non-owner.
- Both spellings are stored: `workspaceRoot` (as typed) + `workspaceRootRealpath`
  (what the sandbox actually maps).

API (owner-only, `sameOrigin`, zod):

- `POST /api/assistant/conversations/[id]/workspace-root` `{ path: string | null }`
  — set (validates + records both spellings) or clear. Owner-only by
  construction: the conversation resolves only under the caller's own assistant.
- `GET /api/assistant/conversations/[id]/workspace` — read-only listing
  `{ workspaceRoot, workspaceRootRealpath, exists, realpath }` for the future
  file panel.
- `POST/GET /api/ai/conversations/[id]/workspace-root` + `/workspace` — the
  same contract on the AiConversation surface, with the explicit
  `canViewAiConversation` owner check (non-owners get 404, matching the
  existing messages route).
- The root rides the conversation read payloads: the AiConversation list/messages
  routes return full rows (columns included automatically); the assistant
  list's select now includes both fields (`listConversations`).

## 3. Harness mapping

The turn input carries `workspaceRoot?: string | null` end to end:
`chat stream route → streamHarnessTurn (bot-stream.ts) → AgentRuntime.executeTurn
(runtime.ts) → native-runtime.ts / cli-runtime.ts`.

### Native runtime (`src/lib/harness/native-runtime.ts` + `vendor/tooling/vendored-boot/native-host.mjs`)

How the harness maps a working directory into the sandbox (vendored lib,
read during implementation):

- `sandbox-policy` resolves the per-call policy as
  `workspaceRoot = session.header.cwd ?? config.workspaceRoot`
  (`vendor/dsh/node_modules/@deepseek-ai/dsh-sandbox-policy/lib/index.js`) —
  the session's recorded cwd IS the workspace-write boundary.
- The headless runner records the session cwd as
  `fs.processPath(fs.resolve("."))` (`dsh-headless/lib/index.js` run()), where
  `fs` is the sandboxed filesystem whose cwd config defaults to `process.cwd()`
  (`dsh-fs-local`). Plan-mode turns take the cwd from the host's `projectRoot`
  (`native-host.mjs` drivePlanTurn).
- `tool-bash` executes under `ctx.workingDirectory` state, initialised from the
  session header cwd (`dsh-working-directory`).

Smallest faithful mapping implemented: `runNativeTask` accepts a new
`workspaceRoot` option (absolute; the host refuses non-absolute spellings).
When set, the host appends two per-turn patch rows (patch rows override by id
and REPLACE config — `applyPatches` in `dsh-app-boot`):

```js
appliedPatches.push({ id: "fs-sandbox", config: { cwd: workspaceRoot } });
appliedPatches.push({
  id: "sandbox-policy",
  config: { mode: process.env.DSH_PERMISSION_MODE ?? "workspace-write", workspaceRoot },
});
```

and passes the root as the plan-drive cwd (`drivePlanTurn`:
`const cwd = workspaceRoot ?? projectRoot`). `projectRoot` keeps feeding the
env layer (DeepSeek key) and the CRM-bundle source — both must stay the repo.
Effect per turn: session `header.cwd` = the root → the sandbox workspace-write
boundary, the bash/fs tools' cwd, and the working-directory system-prompt
context all resolve to the project root. A fresh tree is booted per turn under
the existing global turn mutex and disposed afterwards, so nothing leaks to
the next turn ("restore after" is inherent to the one-turn-one-tree design).

Root changes mid-conversation: the vendored runner refuses to resume a session
whose recorded cwd differs from the boot cwd (`assertAdoptable`), so the
native runtime tracks the boot root per conversation and starts a FRESH harness
session when the turn's root differs from the one the session was created under
(`sessionBootRoots` in native-runtime.ts) — this is what makes "clear the root"
restore CRM behaviour without a crash.

### CLI runtime (`src/lib/harness/cli-runtime.ts` + `client.ts`)

`workspaceRoot` becomes `--add-dir <realpath>` on the spawn (repeatable option
of `dsh --profile headless`, validated absolute by the harness startup). The
headless profile wires `headlessStartup.additionalWritableRoots` into the
sandbox-policy row, so the root is granted as an additional physical directory
writable under the workspace-write preset for exactly that spawn (per turn,
alongside the existing per-spawn env overrides). The spawn cwd stays the repo.

### What a rooted turn's sandbox grants

| mode | native (cwd pinned to the root) | CLI (--add-dir root) |
| --- | --- | --- |
| read-only | reads pass; every mutation denied | same; extra roots grant nothing |
| workspace-write | mutations allowed under the session workspace = the project root (+ platform temp areas); repo no longer the boundary | mutations allowed under the session workspace (repo cwd) AND the project root |
| danger-full-access | sandbox does not restrict file modifications; tools' cwd/context still start at the root | same |

## 4. Probe

`scratch/workspace-root-probe.mjs` — live dev DB + dev server :3003 + the real
in-process native host. **24/24 steps PASS** (see `evidence.json` for every
line; raw streams in `probe.stdout.log` / `probe.stderr.log`). Highlights:

- owner sets `/tmp/cyraops-probe-root` via POST → row carries BOTH spellings
  (`workspaceRoot="/tmp/cyraops-probe-root"`,
  `workspaceRootRealpath="/private/tmp/cyraops-probe-root"` — macOS `/tmp` is a
  symlink to `/private/tmp`, so realpath differs from the typed path);
- the owner's native turn answers with the marker filename:
  `The file is: **cyraops-probe-marker.txt**` — the only file in the project root;
- a non-owner session gets 404 on set/list, and a non-owner turn resolves
  `root=null` (CONTROLLED mode: no shell mounted, marker unreachable);
- clearing via `{path: null}` then turning again: the guard logs
  `[native-runtime] workspace root changed for conversation … (/private/tmp/cyraops-probe-root -> none); starting a fresh harness session`,
  the turn boots at the repo root (ls shows repo files), answers
  `NO MARKER FOUND`, and the announced session id differs from the rooted
  turn's (no adoptability crash);
- the AiConversation surface (set/GET/clear/owner-gate/read payload) passes.

All probe data reverted: conversations and minted sessions deleted, workspace
permissionMode restored to CONTROLLED, `/tmp/cyraops-probe-root` removed.

## 5. Tests

- New: `src/lib/harness/workspace-root.test.ts` (11 tests: validation/realpath
  via injected fake fs, owner gate, spawn-arg mapping, listing), workspaceRoot
  forwarding in `bot-stream.test.ts` (+1), `--add-dir` mapping in
  `client.test.ts` (+2).
- Full suite (`npm run test:unit`, runs against cyraops_test): **568 tests,
  567 pass, 0 fail, 1 skipped** (the skip is the pre-existing one; baseline
  before this change: 553 pass / 1 skip of 554).
- `npm run typecheck`: clean.

