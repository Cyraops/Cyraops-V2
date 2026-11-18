# Tier-2 Part 1 — Plan preview: captured event-shape evidence

Probes (plain node, the SAME vendored native host the chat route executes):

1. `scratch/tier2-plan-probe/probe-plan-task.mjs` — default headless run on
   "Plan the steps to update the three open tickets' priorities, then tell me
   the plan" → `evidence-plan-task.json`.
2. `scratch/tier2-plan-probe/probe-plan-mode-active.mjs` — the same tree with
   the one-shot runner disabled, plan mode ACTIVATED via `ctx.planMode`, and
   the question broker stubbed → `evidence-plan-mode-active.json`.
3. `scratch/tier2-plan-probe/probe-host-plan-mode.mjs` — the new
   `runNativeTask({ planMode })` host path end to end →
   `evidence-host-plan-mode.json`.

## Event shapes captured

**Probe 1 (normal turn, plan mode inactive) — event-type census:**

```json
{"session":1,"status/turn_start":1,"status/step_start":2,"thinking":2,
 "text":2,"tool_call":2,"tool_result":2,"status/step_end":2,
 "status/turn_end":1,"final":1}
```

Quoted payloads:

```json
{"type":"tool_call","callId":"call_00_hCINi9w29Eci6AJeb6l49787","tool":"cyraops_open_tickets","input":{}}
{"type":"tool_result","callId":"call_00_hCINi9w29Eci6AJeb6l49787","status":"completed","result":"{\"count\":3,\"statuses\":{\"BACKLOG\":1,\"TODO\":1,\"IN_PROGRESS\":1}}"}
{"type":"status","phase":"step_end","turn":1,"step":2,"usage":{"inputTokens":310,"outputTokens":21,"cacheReadTokens":5504,"cacheWriteTokens":0,"totalTokens":5817}}
{"type":"thinking","text":"The user wants me to plan the steps to update three open tickets' priorities, then tell them the plan. …"}
```

**There are NO plan-typed events.** The "plan" only exists inside `thinking`
(reasoning) and the final `text`. No `exit_plan_mode`, no approval, nothing
plan-mode-specific. Why: plan mode is OFF for the session (inactive by
default), and the headless runner has no `/plan` commands adapter and never
touches `ctx.planMode` — verified in the vendored sources (dsh-headless
`agent.followup(createUserMessage(...))`; dsh-commands: "UI-less demo spines
… do not provide this command surface").

**Probe 2 (plan mode ACTIVATED) — the harness's real plan surface:**

- The model explores, then calls `exit_plan_mode` with the plan markdown as
  the tool argument (raw session event, arguments a JSON string):

  ```json
  {"type":"tool/call","callId":"call_00_MZ9IvGVTO1cQ2qQ6QjvT7459","name":"exit_plan_mode",
   "arguments":"{\"plan\": \"# Plan: Update priorities on the three open Cyraops tickets\\n\\n## Goal\\n…\"}"}
  ```

  (The NDJSON projector shapes this as
  `{"type":"tool_call","callId":"…","tool":"exit_plan_mode","input":{"plan":"…"}}`.)
- The review runs through the **user-questions/request waterfall** — the exact
  channel the cyraops-crm plugin bridges to the Next-side question broker. The
  stub broker recorded the bridged request verbatim:

  ```json
  {"questions":[{"id":"plan-review","question":"Approve this plan and leave plan mode?"}],
   "signal":{}}
  ```

  (The raw service question carries `header:"Plan review"`,
  `detail:<plan markdown>`, `options:[{"label":"Approve",…},{"label":"Keep planning",…}]`,
  `intent:{kind:"plan-review",approve:"Approve",callId:"…"}` — the plugin
  bridge now preserves all of these.)
- Answering `{answers:[{id:"plan-review","selected":["Approve"]}]}` →
  tool_result:

  ```json
  {"type":"tool/result","isError":false,"content":[{"type":"text",
   "text":"Plan approved — plan mode exited; carry out the plan starting with your next step."}]}
  ```

  and the model **proceeded to execute in the same turn** (its update attempts
  then failed closed only because the plain-node probe had no approval
  broker — the real runtime provides one). `turn/end` reason: `{"kind":"completed"}`.

**Conclusion:** plan mode does NOT proceed automatically — it requires an
approved review (`exit_plan_mode` → user-questions review → approve →
execution in the same turn). The harness therefore supports plan approval,
and the approve/continue loop runs through the existing question-broker
pattern. Because the headless runner never enters plan mode itself, the chat
route provides the harness's own `/plan` entry point: `/plan <message>` runs
the turn in plan mode (native runtime), bare `/plan` / `/plan off` switch the
mode. SSE additions (harness turns only): `{type:"plan", planId, text,
review}` when the plan is presented / the review opens, `{type:"plan_done",
planId, approved}` when the review settles. V1-engine turns never emit them.
