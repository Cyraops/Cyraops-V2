# Tier-2 Part 2 — Jobs/Goals panel verdict (evidence-based)

Probe: `scratch/tier2-jobs-goal-probe/probe-jobs-goal.mjs` (plain node, the SAME
vendored native host the chat route's native AgentRuntime executes — one fresh
cordis tree per turn, exactly our request-scoped architecture). Evidence dump:
`scratch/tier2-jobs-goal-probe/evidence-jobs-goal.json`.

## Architecture fact

Every chat turn boots a fresh vendored harness tree in-process and **disposes
it at the end of the turn**. The only state that survives across turns is the
harness **session journal** (`$DSH_HOME/sessions/<cwd-encoded>/<session-id>/session.v4.jsonl.zstd`),
keyed by the harness session id the chat route persists per conversation
(`HarnessSessionStore` → Prisma).

## Jobs — EPHEMERAL. No panel data source.

- `@deepseek-ai/dsh-jobs-local` is an **in-memory registry**: *"Live registry
  records disappear when the harness process exits"*; *"Jobs end when their
  owner or the harness shuts down"* (package README).
- Live evidence (T3/T4): T3 ran `bash sleep 300` with `run_in_background` →
  `job_list` returned `bash-96b584d3687f44c6 [bash] running — sleep 300`
  (tool_result quoted verbatim). T4 resumed the **same session id** in a fresh
  tree → `job_list` returned **"(no background jobs)"** — the job died with
  the previous turn's tree disposal. Model reply: "EMPTY JOB LIST".
- The session journal does record job lifecycle *events* (`job/start`,
  `job/settled`), but they are log records, not resumable state: *"Events
  already persisted remain available after process exit; live jobs and output
  rings are not resumed."*
- Conclusion: in a request-scoped architecture there is **no durable data
  source for a jobs panel**. Any panel would show an empty registry. → build
  NOTHING for jobs.

## Goals — durable state EXISTS, but not serviceably reachable from our routes.

- `@deepseek-ai/dsh-goal` is **event-sourced in the session log**: every
  mutation appends a durable `goal/change` event; *"After session resume or
  fork, the goal, its phase, its revisions, and its admitted-round count are
  all still there."*
- Live evidence (T1/T2): T1 `create_goal` → tool_result
  `{"goal":{"id":"goal-83c9b097…","revision":1,"objective":"Improve the Cyraops
  CRM onboarding flow…","phase":"active"}}` and a durable `goal/change` event in
  the session journal. T2 (fresh tree, same session id) `get_goal` →
  **objective / phase active / id all read back correctly**. Goal state IS
  durable per conversation across request-scoped turns.
- **But** there is no usable backend data source for a panel:
  1. No API: the state is only served in-tree via `ctx.goals`; outside a turn
     it lives in a **zstd-compressed JSONL** file (`session.v4.jsonl.zstd`),
     which is an internal journal format, not a query surface
     (`dsh-session-query-sqlite` is configured `path: ':memory:'`,
     `openAt: never` in the vendored base composition — sqlite is never opened).
  2. The goal tools are effectively unusable in a request-scoped turn anyway:
     creating an ACTIVE goal arms the `dsh-goal-round-driver`, which
     immediately opens autonomous continuation rounds. Live evidence: T1's
     session log shows `turn/end (completed)` followed by the driver's
     `<goal_round>` message and a `turn/start {turn: 2}` — the one-shot turn
     does not quiesce, the runner exits non-zero, and our host's turn timeout
     would end a chat turn in an error. Automatic continuation is also
     *"process-local rather than durable"* and disarmed after every
     session-start edge, so even the continuation does not behave as a
     durable background system.
  3. Request-scoped turns cannot enumerate goals: there is no
     cross-session goal registry (one goal per session, session-scoped).

## Verdict

- **Jobs:** ephemeral per process/tree → a jobs panel has **no backend data
  source today**. Implement nothing.
- **Goals:** durable per-session state exists, but it is unreachable from our
  request-scoped routes through any supported API, and the round driver makes
  the goal tools hostile to request-scoped turns. → **No panel is built.**
  Documented finding + the minimal-panel design below, which stays out of the
  codebase until a real data source exists.

### The minimal panel we would build IF a real data source existed

A single "Goals" card (jobs stay out entirely): a read-only summary for the
CURRENT conversation — objective, phase, rounds started vs cap — sourced from
a new `/api/harness/goal` route that the harness exposes through a small
read-only in-tree adapter (the route would have to boot a tree or the vendor
would have to expose a session-journal reader; neither exists). Actions
(pause/resume/complete) are deliberately excluded: they are turn-scoped
mutations with the round-driver continuation hazard described above.
