# PHASE 4 — Cyraops V2 vs vendored DeepSeek Harness: permission-capability audit

- **Repo:** /Users/tanveersinghsaini/Desktop/cyraops-v2 (branch `dev`, commit `10b339d`)
- **Audit mode:** read-only; nothing modified except this file. No git operations.
- **Evidence sources (repo-relative paths used throughout):**
  - `vendor/dsh/node_modules/@deepseek-ai/…` (vendored harness tree, version **0.2.2-rc.1**, anchor `vendor/dsh/package.json`)
  - `vendor/tooling/vendored-boot/` (Cyraops boot host + profile)
  - `src/lib/harness/` (Cyraops runtime adapters, broker, CRM plugin)
  - `src/app/api/…` (HTTP surface)
- **Classification key:** EXPOSED TO CYRAOPS USERS (a Cyraops user can observe/invoke it) · INTERNAL ONLY (mounted and enforced, but no user-facing control) · NOT MOUNTED (not in the boot composition) · UNKNOWN (not determinable from files).

---

## Composition: what actually mounts in a Cyraops boot

- Profile manifest `vendor/tooling/vendored-boot/profile/package.json` L8–16 declares bundles, in order:
  **`@deepseek-ai/dsh-base` → `@deepseek-ai/dsh-headless` → `@cyraops/harness-crm`**.
- The profile's own layers are empty: `profile/cordis.yml` is `[]` and `profile/cordis.patch.yml` is `[]`. The entire entry list therefore comes from the three bundle patches (dsh-app-boot composes bundle patches in declaration order over an empty root — `vendor/dsh/node_modules/@deepseek-ai/dsh-app-boot/lib/index.js` L1795–1832, L1865–1870).
- **The Cyraops CRM bundle resolves via a symlink** `vendor/tooling/vendored-boot/profile/node_modules/@cyraops/harness-crm` → `../../../../../../src/lib/harness/plugins/cyraops-crm` (symlink on disk, dir mtime Nov 18 02:48). `resolveBundleDir` anchors at the install anchor then the profile dir (`dsh-app-boot/lib/index.js` L1774–1780, `packageDirFromAnchor` L1755–1761); the install anchor has no `@cyraops/*`, so the profile symlink is the **only** resolution path. No npm script, Dockerfile step, or repo script creates it (checked `package.json` scripts, `scripts/`, `Dockerfile`) — if the symlink is missing (fresh clone that drops it, or the production image which copies no `vendor/` at all), the native boot throws `profile skipped bundles` (`native-host.mjs` L519–524) and every native turn fails. Maintenance: UNKNOWN (present on this checkout, hand-created).
- The CRM bundle patch (`src/lib/harness/plugins/cyraops-crm/cordis.patch.yml` L12–14) inserts one row: `id: tool-cyraops-crm`, `name: '@cyraops/harness-crm'` (no config; the plugin injects `tools` itself, `lib/index.js` L47–48).
- For comparison, the stock CLI `headless` profile template is **dsh-base + dsh-headless only** (`vendor/dsh/node_modules/@deepseek-ai/dsh-official-bundles/lib/index.js` L7) — the global `dsh --profile headless` path (CLI runtime) has no CRM bundle.

---

## 1. dsh-user-approval (`vendor/dsh/node_modules/@deepseek-ai/dsh-user-approval/lib/index.js`)

- **Vocabulary:** `APPROVAL_POLICIES = ["ask", "never"]` (L37); outcomes `OUTCOMES = ["allowed-once","rejected","cancelled","unavailable"]` (L30–35); `allowed-once` is the only grant.
- **`setApprovalPolicy(session, policy)`** (L82–85) validates against the vocabulary and appends one durable `approval/policy` event; per-session override outranks the service config (`effectivePolicy` L177–179).
- **`ApprovalService`** config default `policy: "ask"` (L94); injects the model-facing `approval:policy` system-prompt context with the NEVER/ASK sentences (L39–41, L104–114).
- **`request()`** (L153–168) refuses outside an open turn (L155) and always appends the `approval/asked` + `approval/decided` audit pair around `decide()`.
- **`decide()` fail-closed semantics** (L197–214): aborted signal → `cancelled`; effective policy `never` → `rejected` **before any answerer runs** (L200); otherwise the `approval/request` answerer waterfall runs with default `unavailable` (L201) and non-vocabulary answers normalize to `unavailable`.
- **How Cyraops configures it:**
  - Composition default (dsh-base): `policy: (DSH_PERMISSION_MODE ?? 'workspace-write') === 'danger-full-access' ? 'never' : 'ask'` (`vendor/dsh/node_modules/@deepseek-ai/dsh-base/cordis.patch.yml` L259–262). Cyraops sets no `DSH_PERMISSION_MODE`, so the service default is **ask**; the headless runner then writes a session override from `--approval-policy` (`dsh-headless/lib/index.js` L305–307, L345).
  - Native boot host: `runNativeTask` option `approvalPolicy = "never"` by default (`vendor/tooling/vendored-boot/native-host.mjs` L461, doc L28–30), mapped to `--approval-policy` in `buildRunArgs` (L206–211). **The production adapter overrides this with `"ask"`** (`src/lib/harness/native-runtime.ts` L222–231, comment L227–228).
  - CLI runtime: hard-coded `--approval-policy never` (`src/lib/harness/client.ts` L56).
  - The **only** `approval/request` answerer in the composition is the CRM plugin's broker answerer (`src/lib/harness/plugins/cyraops-crm/lib/index.js` L473–495, registered L508), which delegates everything that is not `cyraops_update_ticket` via `next()` → waterfall default `unavailable` → denial.
  - User-side decision path: plugin answerer → `globalThis` broker (`src/lib/harness/approval-broker.ts`, 60 s auto-reject timeout L189–194) → synthetic `approval`/`approval_decided` SSE events (`native-runtime.ts` L199–219, `bot-stream.ts` L20–25) → `POST /api/harness/approve` calls `broker.decide()` (`src/app/api/harness/approve/route.ts` L20–40).
- **Classification:** **EXPOSED TO CYRAOPS USERS, narrowly** — exactly one capability can ever be approved by a user: `cyraops_update_ticket` in the native runtime. Harness-internal asks (bash/fs sandbox escalation) reach no answerer and fail closed; the CLI runtime is policy `never` (auto-reject).

---

## 2. dsh-permission-presets (`vendor/dsh/node_modules/@deepseek-ai/dsh-permission-presets/lib/index.js`)

- **Preset model:** a preset = `{ sandbox: SANDBOX_MODES, approval: APPROVAL_POLICIES, name, description }` (Config L139–160); `CUSTOM_PRESET` is the derived "no match" state (L51), `AUTO_PRESET` reserved for the experimental Auto integration (L52–62).
- **Configured presets in our boot** (dsh-base patch L264–276): `read-only` (sandbox read-only / approval ask), `workspace-write` (workspace-write / ask), `danger-full-access` (danger-full-access / never).
- **Selection per task:** headless CLI flags `--permission-mode <preset>`, `--approval-policy`, `--add-dir` (`dsh-headless/lib/startup.js` L37); the runner validates against the preset catalog (`dsh-headless/lib/index.js` L310–313) and applies `permissions.set(session, mode)` + `setApprovalPolicy` (L344–345). Fresh sessions are seeded by `pinInitialPermission` from the effective defaults (L376–395). The preset also registers an interactive `/permission` slash command (L212–237).
- **What Cyraops passes:** nothing. `buildRunArgs` (`native-host.mjs` L206–211) emits no `--permission-mode`; `client.ts` L56 emits none; neither sets `DSH_PERMISSION_MODE`; the sandbox default is therefore `workspace-write` (`dsh-headless/cordis.patch.yml` L31, `dsh-base/cordis.patch.yml` L246). There is no UI in Cyraops that drives `permissionPresets` or the `/permission` command.
- **Effective preset today:** native runtime = `workspace-write` + `ask` (matches the configured preset); CLI runtime = `workspace-write` + `never` (no matching preset → `custom`).
- **Classification:** **INTERNAL ONLY** — mounted and functional, but preset switching is reachable only by the headless CLI flags/env Cyraops never supplies or by the console slash command users can't reach. Deployment-level `DSH_PERMISSION_MODE` would change the default.

---

## 3. Sandbox stack: dsh-sandbox / dsh-sandbox-policy / dsh-fs-observation-policy

- **Policy owner** `sandbox-policy` (dsh-base patch L243–247), replaced by the headless layer (`dsh-headless/cordis.patch.yml` L27–33): `mode: DSH_PERMISSION_MODE ?? 'workspace-write'`, `workspaceRoot: process.cwd()`, `additionalWritableRoots: ctx.headlessStartup.additionalWritableRoots` (empty unless `--add-dir`).
  - `dsh-sandbox-policy/lib/index.js`: `SANDBOX_MODES = [read-only, workspace-write, danger-full-access]` (L26–30); `setSandboxMode` appends one `sandbox/mode` session event (L40–42); service default mode `read-only` (L114–119, overridden by the patch); contributes the model-facing `sandbox:policy` runtime context ("Current DSH file policy: workspace-write …") (L85–100, L137–155); `resolve()` precedence = approved escalation > session override > deployment default, workspace root = session cwd (L166–174).
- **Bash confinement** — mounted rows `sandbox` (dsh-sandbox-local, dsh-base patch L240–241) and `bash-sandbox` (dsh-bash-sandbox, L249–253, darwin-enabled):
  - `dsh-bash-sandbox/lib/index.js` wraps the local bash executor through `ctx.sandbox` and exposes `sandboxMode` = policy default (class L32, inject L33, `get sandboxMode()` L51).
  - `dsh-sandbox-local/lib/index.js` builds platform profiles: bwrap mounts (Linux, `bwrapProfileArgs` L22), Landlock grants (Linux, `landlockProfileArgs` L45), sandbox-exec Seatbelt SBPL (macOS, `seatbeltProfileArgs` L67); workspace-write = read-only `/` + writable workspace roots + temp areas.
  - Escalation: the bash tool advertises `sandbox_permissions`/`justification` and resolves widening through `ctx.approval` **before execution** (`dsh-tool-bash/lib/index.js` L349–375; approver at L369). In Cyraops this ask can never be granted (see §1) → any attempt fails closed with the escalation hint; a plain denial under workspace-write returns the `[sandbox: file access denied under …]` marker (L200–204, L243–245).
- **Filesystem confinement** — mounted row `fs-sandbox` (dsh-fs-sandbox, dsh-base patch L524–525): `read-only` denies every mutation; `workspace-write` allows writes only when the target canonicalizes under the policy workspace root, else throws `FS_SANDBOX_DENIED` (`dsh-fs-sandbox/lib/index.js` L87–91, L180–187). The fs `write`/`edit` tools share the same escalation approval (`dsh-tool-fs/lib/index.js` L1857–1868, L1877–1889, L1904–1928) — equally ungrantable in Cyraops.
- **`fs-observation-policy`** (dsh-fs-observation-policy): **NOT MOUNTED** — the row is `disabled: true` in dsh-base (L292–294). Its header states the consequence: "Without this plugin, tools retain the bare provider's unconditional mutation behavior" (`lib/index.js` L1–12) — i.e. no observe-then-edit no-clobber/version guards; only the sandbox mode fences fs mutations.
- **Classification:** **INTERNAL ONLY** — full enforcement is active (Seatbelt/bwrap/Landlock + in-process fs fence under workspace-write, root = server cwd), visible to the model via runtime context and denial markers, but users get no sandbox controls; escalation approval is dead-ended (fail closed). `fs-observation-policy` is NOT MOUNTED.

---

## 4. dsh-tools policy (`vendor/dsh/node_modules/@deepseek-ai/dsh-tools/lib/pipeline.js`)

- **Pre-execute waterfall** (`tools/pre-execute`, L386): default `{ kind: "allow" }`; a listener may return `{ kind: "ask" }` → `serviceAsk` (L387, L608–660) — no ApprovalService mounted → degrade to deny (L609–616); `allowed-once` → allow (L633–636); `rejected`/`cancelled`/`unavailable` → deny with distinct reasons (L637–657). A `{ kind: "deny" }` decision or a registry guard failure denies without approval (L402–418). Post-execute waterfall accepts/blocks results (L672–701).
- **Built-in gating in shipped tools:** bash and fs tools gate only *escalation* (sandbox_permissions) through `ctx.approval`, inside their tool bodies (§3). `dsh-tool-web` has no approval gating (anonymous fetch restricted to public HTTP(S) destinations per dsh-base comment L454–466). `dsh-tool-jobs`' pre-execute listener is passive (output-limit bookkeeping, always `next()`, `lib/index.js` L273–277). The TODO in dsh-tool-bash confirms deployment policy is *not* shipped there (`dsh-tool-bash/lib/index.js` L218–219).
- **The only real ask gate in the Cyraops composition is ours:** `updateTicketAskGate` returns `{ kind: "ask", reason }` for `cyraops_update_ticket` only (`src/lib/harness/plugins/cyraops-crm/lib/index.js` L455–461, registered L507). No profile patch adds policy rows for bash/fs/web.
- **Classification:** **EXPOSED TO CYRAOPS USERS only via the one CRM write tool**; the generic pipeline + escalation seams are otherwise INTERNAL (mounted, enforced, ungrantable in practice).

---

## 5. Which harness tools are mounted in our boot → SYSTEM ACCESS determination

Composition = dsh-base patch + dsh-headless overrides (disables only hmr/credentials/authorization/deepseek-account) + CRM insert. On darwin (this checkout):

| Harness tool package | Row evidence | Mounted in Cyraops boot? |
|---|---|---|
| `dsh-tool-bash` | dsh-base patch L281–283 (`disabled` only on win32) | **MOUNTED — model-callable** (workspace-write-confined; escalation ungrantable) |
| `dsh-tool-bash-persistent` | no row in dsh-base; package absent from `vendor/dsh/node_modules/@deepseek-ai/` | **NOT MOUNTED** (not even vendored; exists only as a global-CLI dependency) |
| `dsh-tool-fs` | dsh-base patch L296–300 (`applyPatch: false`) | **MOUNTED — model-callable** (read/glob/write/edit fenced by workspace-write) |
| `dsh-tool-fs-search` | dsh-base patch L302–305 | **MOUNTED — model-callable** |
| `dsh-tool-terminal` | no row anywhere; `dsh-terminal`/`dsh-terminal-bash` not in vendored tree (interactive-TUI deps of the global CLI only) | **NOT MOUNTED** |
| `dsh-tool-web` | dsh-base patch L486–490 (`fetch: true`, search 60s) + web providers L467–484 | **MOUNTED — model-callable** (web_search + web_fetch) |
| `dsh-tool-skill` | dsh-base patch L318–319, with `skill` L312–313 and `skill-filesystem` L315–316 | **MOUNTED — model-callable** |
| `dsh-tool-pwsh` | dsh-base patch L285–287 (disabled on non-win32) | Not mounted on darwin (win32-only) |
| `dsh-tool-executor-native` / `-ptc` | L501–502 / L504–506 (`disabled: true`) | native executor MOUNTED; ptc not mounted |
| Cyraops CRM tools | CRM bundle patch L12–14; `lib/index.js` L50–54, registered L497–503 | **MOUNTED** — 4 read-only DB tools + `cyraops_update_ticket` (ask-gated) |

Also mounted and model-callable from dsh-base: `tool-todo` (L437–440), `tool-jobs` (L289–290), `tool-goal` (L444–445), `tool-subagent` + `subagent_fork` + control (L363–395), `tool-workflow` (L405–406), `tool-working-directory` (L169–170), `user-questions`/ask_user_question (L79–80), `plan-mode` (L336–340), slash commands incl. `/permission` (L212–237 of permission-presets), `/compact`, `/goal`.

- **Native boot evidence:** the only captured boot log (`scratch/vendored-boot/boot.err.log`) predates the CRM bundle (its profile lists only dsh-base + dsh-headless) and shows those two as the sole bundle layers; no log anywhere shows a `bundle layer: @cyraops/harness-crm` line. For the current profile, the bundle is resolvable only through the profile symlink (§Composition).
- **SYSTEM ACCESS EXISTS TODAY — YES, in both runtime paths.** The model can execute bash (Seatbelt-confined: read-only `/` + writable repo root + tmp on macOS), read/write files under the workspace root (repo root = server cwd), fetch/search the web, spawn subagents, run workflows, list jobs, and query the Cyraops DB (4 read-only tools + 1 approval-gated write). Workspace root is `process.cwd()` of the Next server (`dsh-headless/cordis.patch.yml` L32; sandbox-policy `resolve` L166–174 pins session cwd).
- **Runtime selection reality:** default is the **CLI** runtime (`src/lib/harness/runtime.ts` L99–105: unset/unknown `HARNESS_RUNTIME` → `cli`), which spawns the **global** `dsh` binary with the stock headless profile (`client.ts` L46–58) — same base tool set, no CRM tools, approval never. The native path runs only when `HARNESS_RUNTIME=native` (or `HARNESS_BOT=native`); the chat endpoint uses the harness at all only when `HARNESS_BOT=1|cli|native` (`src/app/api/assistant/chat/stream/route.ts` L23–33). `/api/harness/run` uses `runtimeFactory()` (default cli) (`src/app/api/harness/run/route.ts` L28–29).
- **Production Docker caveat:** the runner stage copies no `vendor/` and installs no `dsh` (`Dockerfile` L16–29) → `vendoredTreePresent` fails (runtime.ts L89–95) → native falls back to CLI, whose `dsh` spawn has no binary on PATH in that image (cli-runtime `healthCheck` L207–214). In the production container the harness has no working system-access path at all; on dev machines with the global dsh installed, the CLI path is live.

---

## 6. dsh-authorization / dsh-credentials

- Both rows are mounted by dsh-base (`credentials` → dsh-credentials-local L125–126; `authorization` → dsh-authorization L117–118) and **disabled by the dsh-headless layer** (`dsh-headless/cordis.patch.yml` L38–43, comment L38: "One-shot jobs use launch-time credentials instead of the interactive store."). `deepseek-account` (OAuth platform flow) is also disabled (L44–46), and `hmr` (L35–36).
- **Consequence for API keys:** `dsh-llm-deepseek-api-key` resolves `DEEPSEEK_API_KEY` via the credential store when `ctx.get("credentials")` exists, **else from the launch environment layer** (env vars + project `.env` loaded by `loadLayeredEnv`, `native-host.mjs` L513) — and throws `MISSING_CREDENTIAL` only if neither supplies it (`vendor/dsh/node_modules/@deepseek-ai/dsh-llm-deepseek-api-key/lib/index.js` L53–63).
- `dsh-authorization/lib/index.js` L1–40+: `ctx.authorization` is a registry of credential-*obtaining* flows (OAuth conversations) requiring the credentials store — the disabled rows remove interactive/OAuth key provisioning entirely.
- **Classification:** **INTERNAL ONLY** — API-key access still works from the deployment environment (env/`.env`); no user-visible credential store, no authorization flows, no Model-page key entry.

---

## 7. Permission UI (dsh-client-ui-*)

- `dsh-client-ui-approval` and `dsh-client-ui-permission-presets` (and every other `dsh-client-ui-*` package) **do not exist in the vendored tree** (`vendor/dsh/node_modules/@deepseek-ai/` listing contains zero `dsh-client-ui-*`); they exist only in the global checkout because the web app needs them.
- No patch layer in our composition references any client-ui row: dsh-base has none, dsh-headless adds none, the CRM bundle adds none, and the profile patches are empty. They would only arrive via `dsh-web-app`, which is not a bundle in any Cyraops profile. The headless patch header confirms "It mounts no Host, HTTP server, Web runtime, or browser plugin" (`dsh-headless/cordis.patch.yml` L1–7).
- Cyraops substitutes its own approval surface: synthetic SSE `approval`/`approval_decided` events → V1-compatible approval card (`bot-stream.ts` L20–25) → `POST /api/harness/approve`.
- **Classification:** **NOT MOUNTED** — the harness permission UI packages are entirely absent; Cyraops' custom approval card is the only user-facing permission surface.

---

## Bottom line: what Cyraops V2 actually exposes today

1. **One user-facing permission interaction exists**: the allow-once/reject decision for `cyraops_update_ticket`, and only in the native runtime (`approvalPolicy: "ask"`, `native-runtime.ts` L229) with the vendored tree present. Every other approval ask — bash/fs sandbox escalation, any hypothetical new ask gate — fails closed because no answerer handles it, and the CLI runtime runs `--approval-policy never` (auto-reject).
2. **Everything else in the harness permission stack is mounted but internal**: preset catalog (`read-only` / `workspace-write` / `danger-full-access`) is fixed at `workspace-write` + `ask` by deployment defaults (`DSH_PERMISSION_MODE`), with no Cyraops surface to switch it; the sandbox (policy + Seatbelt/bwrap/Landlock bash confinement + in-process fs fence) actively bounds the model to the server cwd + temp; the observation policy is not mounted.
3. **System access is real and bounded, not absent**: the model can call bash, fs, web fetch/search, subagents, workflow, jobs, todo, skills — confined to workspace-write against the repo root — plus 4 read-only CRM DB tools and 1 ask-gated CRM write tool. In the default CLI path the same access exists via the global dsh install (without CRM tools and with approvals disabled); in the production Docker image the harness has no runnable system-access path at all (no vendored tree, no dsh binary).
4. **Credentials/authorization are env-only**: no interactive key store or OAuth; `DEEPSEEK_API_KEY` must come from the deployment environment.
