# Cyraops × DeepSeek Harness — Source Audit

Evidence gathered 2026-11-18 from the installed package. Every claim below was
observed; nothing is inferred from marketing or prior conversation.

## 1. Package identity

| Field | Value | Evidence |
| --- | --- | --- |
| Name | `@deepseek-ai/dsh` | `package.json` |
| Version | `0.2.2-rc.1` | `package.json` |
| License | MIT, Copyright (c) 2026 DeepSeek | `LICENSE` (MIT text) |
| Module type | ESM (`"type": "module"`) | `package.json` |
| Entry points | **none** — no `main`, no `exports` | `package.json` |
| Binary | `dsh` → `lib/bin.js` | `package.json` `bin` |
| Engines | `node >= 24.9.0` | `package.json` |
| Dependencies | 90 runtime + 54 dev | `package.json` |
| Bundled workspace | ~270 `@deepseek-ai/*` packages | `node_modules/@deepseek-ai/` |
| On npm? | **No** — `npm i @deepseek-ai/dsh` → `notarget No matching version found` | npm output |
| Source shipped? | **No** — compiled, content-hashed bundles (`lib/bin.js`, `lib/plugin-*.js`, …) | `lib/` listing |

**Consequence:** this is an *application*, not a library. `require("...dsh")` fails.
The supported interface is the CLI; a JSON-RPC SDK is shipped for process
clients (see §4).

## 2. Runtime model

`dsh` boots a **profile**: an ordered stack of plugin-bundle patch layers.

```
dsh [--profile <name>] [options] [app-args...]
dsh plugin --profile <name> <pnpm-args...>
dsh --profile <name> --dump-config          # composed profile tree
dsh --profile <name> --dump-config-schema   # JSON Schema, without mounting
```

Shipped profiles (`$DSH_HOME/profiles`): **`headless`** and **`web`**. Each is
`cordis.yml` (empty root list) + `package.json` `dsh.profile.bundles` +
`cordis.patch.yml` (user patch layer) + `--patch` overlays.

| Profile | Bundles | Purpose |
| --- | --- | --- |
| `headless` | `dsh-base`, `dsh-headless` | engine only, CLI, no UI packages |
| `web` | `dsh-base`, `dsh-web-app` | full Harness Web UI |

`dsh-base` is the shared backend (agent, sessions, tools, plugins, model
connectivity). The UI lives only in `dsh-web-app` and the `dsh-client-ui-*`
package family — **none of which the headless profile mounts**. This is the
evidence that the backend runs headlessly without modification.

## 3. Headless CLI surface (verified)

```
Usage: dsh --profile headless [options] [task...]
  task                       joined into one task; `-` reads stdin
  --json                     newline-delimited run events on stdout
  --session-id <id>          adopt a persisted Session (resume)
  --permission-mode <preset> permission preset for the task
  --approval-policy <policy> ask | never
  --add-dir <path>           allow an extra directory under workspace-write
```

Observed event stream (one run): `session` (carries `sessionId`),
`status(turn_start|step_start|step_end|turn_end)` with `usage` on `step_end`,
`thinking`, `text`, `final` (text + reason). Diagnostics go to stderr.

Measured (see CYRAOPS_POC_REPORT.md):

- cold run 3.24 s wall, 237 MB max RSS; warm 1.63 s, 224 MB
- session resume verified: "banana" remembered across runs
- model used: DeepSeek API through the harness's own `llm-deepseek` credentials
  (`DSH_HOME/llm-deepseek`), not ours

## 4. Backend packages of interest (all present in this install)

| Area | Packages |
| --- | --- |
| Agent loop / orchestration | `dsh-agent`, `dsh-agent-loop`, `dsh-agent-instructions`, `dsh-plan-mode`, `dsh-system-prompt` |
| Tools | `dsh-tools`, `dsh-tool-bash`, `dsh-tool-fs`, `dsh-tool-web`, `dsh-tool-skill`, `dsh-tool-subagent`, `dsh-tool-schedule`, `dsh-tool-jobs`, `dsh-tool-session-query`, `dsh-tool-goal`, `dsh-tool-workflow`, `dsh-tool-ask-user`, `dsh-tool-todo`, `dsh-tool-str-replace-editor`, `dsh-tool-terminal` |
| Sessions | `dsh-session`, `dsh-session-persistence(-jsonl)`, `dsh-session-query(-sqlite)`, `dsh-session-format*` (v0→v4 migrations), `dsh-session-projection`, `dsh-session-title` |
| Memory / compaction | `dsh-compaction`, `dsh-compaction-basic`, `dsh-compaction-image-offload`, `dsh-compaction-tool-result-pruner` |
| Plugins | `cordis`, `cordis-plugin-loader`, `cosmokit`, `schemastery` (config schema) |
| Model connectivity | `dsh-llm`, `dsh-llm-deepseek`, `dsh-llm-deepseek-api-key`, `dsh-llm-retry`, `dsh-deepseek-account(-platform)` |
| Subagents | `dsh-subagent`, `dsh-subagent-fork-in-process`, `dsh-subagent-spawn-in-process`, `dsh-experimental-agent-team` |
| Permissions / approvals | `dsh-permission-presets`, `dsh-user-approval`, `dsh-authorization`, `dsh-sandbox`, `dsh-sandbox-policy`, `dsh-fs-observation-policy`, `dsh-tool-call-timeout-policy` |
| Local execution | `dsh-bash-local`, `dsh-bash-sandbox`, `dsh-fs-local`, `dsh-fs-sandbox`, `dsh-subprocess-local`, `dsh-ptc-runtime-node` |
| Jobs / scheduling | `dsh-jobs`, `dsh-jobs-local`, `dsh-schedule`, `dsh-goal`, `dsh-goal-round-driver` |
| Web / search | `dsh-web`, `dsh-web-fetch-http`, `dsh-web-search-deepseek`, `dsh-http-proxy` |
| Interop | `dsh-mcp-client`, `dsh-mcp-resources`, `dsh-sdk-protocol`, `dsh-sdk-jsonrpc-server`, `dsh-sdk-app`, `dsh-sdk-minimal`, `dsh-ptc-protocol` |
| Observability | `dsh-otel`, `dsh-session-telemetry(-otel)`, `dsh-token-meter`, `dsh-host-product-telemetry-otel` |
| Speech (experimental) | `dsh-experimental-speech-to-text(-sensevoice)`, `dsh-experimental-api-speech-to-text`, `dsh-experimental-voice-input-bundle` |
| Desktop-ish (experimental) | `dsh-experimental-forge*`, `dsh-experimental-liveshare*`, `dsh-experimental-worktree` |

## 5. Out-of-process SDK (production path)

- `dsh-sdk-protocol` — "the SDK wire protocol … newline-delimited JSON-RPC
  transport … spoken between a Harness runtime and its SDK clients" (package
  README, library).
- `dsh-sdk-jsonrpc-server` — "the stdio JSON-RPC serving plugin for deployments
  that let out-of-process SDK clients open sessions and drive agents in a
  DeepSeek Harness runtime" (package README, package-reference).

These exist in this install; a boot profile mounting the JSON-RPC server is the
intended way to keep one runtime alive and serve many Cyraops turns. (Not yet
exercised — see POC report.)

## 6. Unknowns and how to verify

| Item | Status | How to verify |
| --- | --- | --- |
| Exact event schema beyond observed fields | partial | run `--json` with a tool call; inspect events |
| JSON-RPC SDK server invocation (profile name / app args) | **unknown** | `dsh --help` on a profile mounting `dsh-sdk-jsonrpc-server`; read its README/lib |
| Per-dependency licenses of the 90 deps | **unknown** | run `license-checker` / `pnpm licenses list` against the install; record each |
| Whether headless exposes MCP serving | **unknown** | inspect `dsh-mcp-client` README and try a config |
| Plugin API for adding our own CRM tools | known pattern | skill `cordis-plugin-development`; a Cyraops bundle declares tools, installed into a Cyraops profile via `install_bundle` |
