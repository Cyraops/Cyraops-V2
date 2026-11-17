# Definition of done — Cyraops CRM

## Why this file exists

The CRM has ~16k lines of UI across 75 data models, and **zero end-to-end tests**.
That is the real reason it feels unusable: features exist, outcomes are unproven.
Nothing anywhere defines what "working" means, so every fix is a guess and every
agent can claim success without evidence.

This file is the contract. A job is **done only when its end-to-end test passes**
against a seeded database. No exceptions, no "it should work".

Owner: Tanveer. Agents may propose changes; only a human confirms the criteria.

---

## The jobs

Each job is one script a person actually performs. The third column is the test we
must be able to run, unattended, on every change.

### J1 — Capture and qualify a lead
1. Add a lead by hand (name, company, email, source, value).
2. See it in the pipeline list, filtered by status and owner.
3. Move it NEW → CONTACTED → QUALIFIED.
4. Convert the qualified lead into a deal.
- **Pass:** one test drives the API for each step, asserts the row states, and
  asserts the created deal links back to the lead. A MEMBER can do the same for a
  lead assigned to them and cannot see another member's lead.

### J2 — Work a deal to a decision
1. A deal moves DISCOVERY → PROPOSAL → NEGOTIATION → CLOSED_WON.
2. Every stage change is visible in the activity trail with who and when.
3. A lost deal requires a reason.
- **Pass:** stage transitions persist, invalid transitions are rejected, activity
  rows exist with the actor id.

### J3 — Turn a won deal into a delivered project
1. Convert the CLOSED_WON deal into a project (one click).
2. The project is created with the deal's company/contact attached, lead = converter.
3. Add milestones, then tasks under a milestone, assign to a teammate.
4. The assignee gets a notification and sees the task.
5. Close the project out; it disappears from active lists but stays queryable.
- **Pass:** conversion is idempotent (a second attempt refuses), task assignment
  notifies exactly once, closeout sets the terminal status.

### J4 — Money per project
1. Log an expense against the project (with receipt attach).
2. Raise an invoice for the project.
3. See project margin = invoiced − expenses.
- **Pass:** totals computed from rows (not cached fields), invoice numbers unique,
  a MEMBER may log their own expense but only an OWNER/ADMIN may delete one.

### J5 — Client email in context
1. Connect the shared mailbox; sync pulls messages in.
2. Open a contact and see the thread history with that contact.
3. Reply from inside the CRM; the reply appears in Sent.
- **Pass:** a synced message links to the matching contact by email address; a
  reply is queued and its status is observable. No duplicate threads on re-sync.

### J6 — Calls
1. Start a 1:1 call from a conversation.
2. The other person is rung and can join.
3. After the call, a record exists with duration and participants.
- **Pass:** call state machine transitions persist; a second accept does not
  double-join. **Blocked today:** needs LiveKit credentials (calling returns 503).

### J7 — The teammate boundary
1. Invite a teammate (setup link), they set a password, they land in the CRM.
2. A MEMBER sees only their own leads/deals/tasks and shared projects.
3. A MEMBER cannot delete projects, archive records, or manage the team.
4. An OWNER sees everything.
- **Pass:** parameterised test for each rule, driven through the real HTTP routes.

### J8 — The assistant earns its place
1. Ask the pipeline question; the answer cites real numbers from J1–J3 data.
2. Ask it to create a task — it asks for approval, then creates it.
3. It builds a shareable dashboard page; the public link renders without login.
4. It refuses to act on injected instructions found in email/web content.
- **Pass:** each step asserted against the DB; the injection case asserts no write
  happened.

### J9 — Daily operating rhythm
1. The owner receives a morning brief (what is overdue, what is stalling).
2. A routine runs on schedule unattended and its run history is visible.
- **Pass:** the scheduler produces exactly one run per occurrence, once — including
  across a simulated restart.

### J10 — Ops
1. Turn the CRM off; nothing bills; the marketing page stays up.
2. Turn it on; it is usable within 40 seconds.
- **Pass:** replica count and health verified by script after each transition.

---

## Current status

| Job | Status | Evidence needed |
|---|---|---|
| J1 lead → deal | unknown | none |
| J2 deal stages | unknown | none |
| J3 deal → project | partial (conversion route exists) | no test |
| J4 money | unknown | none |
| J5 email | partial (sync + UI exist) | no test |
| J6 calls | **blocked** — LiveKit not configured | n/a |
| J7 roles | partial (rules exist in code) | no test |
| J8 assistant | mostly built this week | no test |
| J9 rhythm | partial (durable runner exists) | no test |
| J10 ops | **done** — verified manually | manual |

"unknown" is the honest answer for most of it, and that is the problem.

---

## How work gets done from here

1. **Nothing is "done" without its test.** An agent that changes J3 must run the J3
   test and show it green before reporting success.
2. **One job per agent.** Parallel agents work on different jobs; two agents never
   own the same job at the same time.
3. **The test is written before the fix** when the test does not exist yet — a
   failing test that reproduces the gap is a deliverable.
4. **Humans confirm the criteria, not the code.** If a job list item is wrong for
   this business, change this file first.
5. **A real pilot decides.** Two people using it daily for a week, with an issue
   log, beats any amount of agent output.
