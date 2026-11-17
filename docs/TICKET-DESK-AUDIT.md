# Ticket desk: usability audit

**Date:** 16 November 2026 · **Trigger:** a member, Adil, got "Task not found"
clicking the assignee. Root-caused, fixed, and the rest of the desk audited.

---

## The bug, reproduced first

| Step | Result |
|---|---|
| Member opens `/tasks` | sees 6 tickets, including ones in projects they are not in |
| Member changes an assignee | `PATCH /api/tasks/:id` → **404 "Task not found"** |
| Member changes a status | same 404 |

**Cause.** `PATCH /api/tasks/:id` is scoped to project membership
(`accessible()` returns null for a non-member). The ticket queue, however, lists
**every** task — `GET /api/tickets` has no membership filter. So the queue showed
rows the person was not allowed to touch. Not a crash: a design mismatch between
a shared queue and project-scoped writes.

## The fix

Triage moved to its own endpoint, because triage is a desk permission and not a
project permission.

`PATCH /api/tickets/:id`:

| Field group | Any teammate | Notes |
|---|---|---|
| status, priority, kind | **yes** | closing stamps `closedAt`, reopening clears it |
| source, type, group, category | **yes** | the service-desk properties |
| requester name / email, resolution | **yes** | |
| assignees | **yes** | any active teammate, not only project members |
| title, description, project move, archive | **no** | stripped; `/api/tasks/:id` keeps project rules |

`GET /api/tickets/:id` reads one ticket with assignees and comments.
`POST /api/tickets/:id/comments` lets any teammate add an internal note — a note
is part of triaging a queue.

Verified after the fix, as the member: assignee → 200, status → 200, priority →
200, type/source → 200, group/category → 200, resolution → 200, close → 200,
note → 201. Title and project unchanged in the database. `/api/tasks/:id` still
404s for that member, asserted in j13.

## What else the audit found

| # | Finding | Severity | Status |
|---|---|---|---|
| 1 | Member triage returned 404 on every row | **blocking** | fixed |
| 2 | Two users sharing a name were indistinguishable in the assignee list | medium | fixed (labels add the email only when names collide) |
| 3 | Toast provider was never mounted — all feedback silent app-wide | **high** | fixed earlier tonight |
| 4 | Queue stops at 60 tickets, with no pagination or "load more" | medium | **open** |
| 5 | No archive/delete of a ticket from the desk | medium | **open** |
| 6 | No "assign to me" shortcut; the list always starts at Unassigned | low | **open** |
| 7 | Columns cannot be sorted (only filtered) | low | **open** |
| 8 | Resolving takes two actions: Save resolution, then Resolve & close | low | **open** |
| 9 | Creating a ticket requires a project; tickets are conceptually project-free | medium | **open** — an automatic "Support inbox" project would remove the choice |
| 10 | No saved views; the same filter combination is rebuilt daily | low | **open** |

## The pattern behind items 1–3

All three were **visible state that disagreed with actual permission or feedback**:
a row you cannot act on, a name you cannot tell apart, an action that reports
nothing. None of them were logic errors in isolation — each was the UI promising
something the layer beneath did not do. That is worth a habit: whenever the queue
offers an action, the endpoint behind it should be the one with the same rule.

## What is not audited here

Email-to-ticket ingestion (the ALARM emails in the screenshots are a real workflow
for this desk), SLA timers, and any notification when a ticket is assigned to you.
Those are product decisions, not defects, and none of them exist yet.
