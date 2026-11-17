# Cyraops × DeepSeek Harness — Capability Matrix

Status: present=verified present in the install; proven=verified by execution;
partial=present but not exercised; unknown=not verified.

| Capability | Present? | Evidence | Reusable without Harness UI? | Cyraops adapter needed | External service/credential | Security implications | Test |
| --- | --- | --- | --- | --- | --- | --- | --- |
| Agent execution, multi-step orchestration | proven | `dsh --profile headless "task"` completes turns; `step_start/step_end` events | yes (headless profile mounts no UI packages) | `src/lib/harness/client.ts` spawn wrapper | DeepSeek API key (harness's own store) | none beyond LLM data policy | POC run "banana" + session resume |
| Tool/function calling | present | `dsh-tools`, `dsh-tool-*` family incl. bash/fs/web/skill | yes | port CRM tools as a plugin bundle (cordis) | none inherent | tool policy, approval required for consequential tools | not yet executed; needs a tool-calling turn |
| Plugin discovery/registration | present | `cordis`, `cordis-plugin-loader`, profiles + patch layers | yes | Cyraops bundle via `plugin_manager install_bundle` | none | plugin code runs in-runtime; audit bundles | none yet |
| Session creation/continuation/persistence | proven | `--session-id` resume: "banana" remembered | yes | map `sessionId` → our `AiConversation` row | local sqlite/jsonl under `DSH_HOME/sessions` | tenant isolation: one session per user+conversation | resume test passed |
| Conversation history & memory | present | `dsh-compaction*`, session formats v0→v4, projections | yes | our UI shows our stored messages; harness sees its session | none | prompt-injection via retrieved content; compaction policy | none yet |
| Streaming events | proven | NDJSON `session/status/thinking/text/final` | yes | forward events to our SSE | none | none | observed in POC |
| Cancellation / timeout | partial | `dsh-tool-call-timeout-policy`, `dsh-timeout`; our wrapper kills on timeout | yes | `cancelTurn` → kill child / SDK cancel | none | orphan processes | wrapper timeout untested |
| Model/provider config | present | `dsh-llm-deepseek`, `dsh-llm-deepseek-api-key`, retry | yes | env-only config | DeepSeek API (network required) | never expose keys to client | POC used harness's key store |
| Browser automation | **unknown** | no browser-driver package observed in install (`dsh-tool-web` = fetch/search; our extension covers browsing) | n/a | keep Cyraops's own local-browser bridge | none | see V1 bridge notes | none |
| File access / workspace | present | `dsh-fs*`, `dsh-workspace`, `dsh-sandbox`, `--add-dir` | yes | constrain cwd to a per-tenant scratch dir | none | sandbox policy, allowlists | none yet |
| Logging / telemetry | present | `dsh-otel`, `dsh-session-telemetry-otel`, `dsh-token-meter`, `dsh-session-log-export` | yes | route metrics to our logs | none | redact secrets | none yet |
| Secrets handling | present | `dsh-credentials(-local)`, env-driven config | yes | keep all keys server-side | none | never commit `.env` | POC: no key handled by us |
| Local shell/VM execution | present | `dsh-bash-local`, `dsh-bash-sandbox`, `dsh-subprocess-local`, `dsh-ptc-runtime-node` | yes | **must be off by default**; per-tenant opt-in | local binaries | highest risk: confine to sandbox | none |
| Subagents | present | `dsh-subagent*`, `dsh-experimental-agent-team` | yes | optional | none | per-subagent permissions | none yet |
| Scheduling/jobs | present | `dsh-jobs(-local)`, `dsh-schedule`, `dsh-goal` | yes | map to our calendar/routines | none | jobs need quotas | none yet |
| MCP interop | present | `dsh-mcp-client`, `dsh-mcp-resources` | partial | expose our CRM as MCP or consume external MCP | none | MCP servers are code + network | none yet |
| Speech-to-text (experimental) | present | `dsh-experimental-speech-to-text(-sensevoice)` | unknown | we already use DeepSeek ASR directly — keep ours | none | audio data policy | our ASR already tested |
