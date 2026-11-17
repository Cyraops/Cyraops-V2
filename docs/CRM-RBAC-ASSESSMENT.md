# CRM role-based access: what exists, what to improve

**Date:** 15 November 2026

**How this was produced:** every claim below was verified by calling the real API with
sessions for each role against a disposable, freshly migrated database seeded with three users
(owner, admin, member), a project the member belongs to, a project they do not, a lead assigned
to the owner, and a deal. Static reading of the routes was not trusted — the first pass of that
was wrong in both directions.

---

## The model today

Three fixed roles on `User.role` (Prisma enum): **OWNER**, **ADMIN**, **MEMBER**. One owner per
workspace. Project membership is a separate relation (`ProjectMember`) that grants access to a
project's tasks.

Two helpers exist in [`src/lib/permissions.ts`](../src/lib/permissions.ts):

```ts
canManageMember(actor, target, nextRole)   // who may change whose role
hasProjectAccess(role, isMember)           // owner/admin bypass, otherwise must be a member
```

Everything else is checked inline in each route: `role === "MEMBER" ? 403`, `role !== "OWNER" ? 403`,
`["OWNER","ADMIN"].includes(role)`. There are **132 authenticated routes** under `src/app/api`,
and 9 deliberately public ones (login, logout, setup, health, webhooks and intake, all
token-verified).

---

## Verified behaviour

### What a MEMBER can do

| Action | Result | Evidence |
|---|---|---|
| Read any lead, deal, project list, team, activity feed | **allowed** | `200` |
| Edit a lead assigned to someone else | **blocked** | `403 "Members cannot modify leads assigned to other team members"` |
| Archive a deal | **blocked** | `403 "Only an owner or admin can archive deals"` |
| Open a project they belong to, edit its tasks | **allowed** | `200` |
| Open a project they do not belong to | **blocked** | `403` |
| Open a task in a project they do not belong to | **blocked** | `404` |
| List tasks of a project they do not belong to | **blocked** | `404` |
| See the financial dashboard or cost audit | **blocked** | `403` |
| List or create AI providers | **blocked** | `403` |
| See pending agent approvals | **blocked** | `403` |
| Read AI provider inventory via `/api/ai/admin` | **allowed** | `200` — see gap 2 |
| Rename the workspace | **blocked** | `403 "Only the owner can update workspace settings"` |
| Delete a project | **blocked** | `403` |
| Invite a teammate, change anyone's role | **blocked** | `403` |
| Promote themselves to admin | **blocked** | `403` |
| Search across the workspace | **scoped correctly** | owner finds "Secret Deal", member returns `[]` |
| See another person's AI usage | **blocked** | response contains `self` only |
| Control the automation browser | **own session only** | `computerSessionKey(user.id)` |

### Admin versus owner

| Action | ADMIN | OWNER |
|---|---|---|
| Cost dashboard, invoices, audit | allowed | allowed |
| Manage teammates, assign ADMIN/MEMBER | allowed | allowed |
| Assign the OWNER role | **blocked** ("You do not have permission to assign that role") | **blocked** (no second owner by design) |
| Rename the workspace | **blocked** (owner-only) | allowed |
| See AI approvals, manage providers | allowed | allowed |

### Things that are right

1. **Object-level checks actually work.** Private project → `403`; a task inside it → `404`
   rather than a leak of its existence. This is the hard part of RBAC and it is done.
2. **No privilege escalation path.** A member cannot promote themselves; an admin cannot create
   an owner. `canManageMember` encodes the rule and the route enforces it.
3. **Role changes take effect immediately.** `userFromRequest` re-reads the user per request, so
   a demotion is not delayed by a stale session.
4. **Disabling a user kills their session** — `disabledAt` is checked on every request, and the
   stale session row is deleted.
5. **Login is rate limited** — 12 attempts per 15 minutes per key, then `429`.
6. **Search is scoped.** The same query returns the deal for the owner and nothing for the
   member.
7. **Financial data is genuinely closed** to members, at both the dashboard and the audit route.
8. **There is test coverage**: `src/lib/permissions.test.ts` unit-tests the role rules, and
   `test/jobs/authz.test.ts` exercises cross-tenant ownership on real handlers with real
   sessions.

---

## Gaps, in the order I would fix them

### 1. Role changes are not audited (medium-high, ~30 min)

`PATCH /api/team/[id]` writes the new role and returns, with **no `logActivity` call**. There is
no record of who promoted whom, or when someone was disabled. For a system that holds payroll-
adjacent financial data, "who made this person an admin?" should be answerable from the activity
log. Every other mutation in the app logs; this one does not.

### 2. The same data has two different policies (medium, ~15 min)

- `GET /api/ai/providers` → **403** for a member.
- `GET /api/ai/admin` → **200**, and returns the provider inventory: ids, names, availability,
  capabilities, the active provider.

Two endpoints, one class of data, opposite answers. Either is defensible; both is a mistake, and
it means the "providers are admin-only" rule is only half true.

### 3. CRM reads are company-wide while writes are scoped (decision needed, ~0 to change)

A member can **list every lead and deal**, including ones assigned to others, but cannot **edit**
a lead assigned to another person. That asymmetry may be exactly what you want — a small sales
team sharing a pipeline — but it is currently accidental rather than stated. If you ever hire a
contractor, "all pipeline visible" becomes a real disclosure. Decide it, write it in the matrix,
and make the code say so.

### 4. No per-project roles (medium, ~1 day)

Project membership is all-or-nothing: a member can edit tasks. There is no read-only viewer, so
you cannot give a client, an auditor, or a new joiner visibility without also giving them write
access to the board.

### 5. Only three roles, hard-coded (medium, ~2–3 days)

"Admin" is a bundle of finance, AI, and people permissions. A finance lead who should see costs
but not AI providers cannot be expressed. Adding a fourth role means editing inline checks across
many routes, which is where regressions come from.

### 6. No central authorization layer (medium, structural)

132 routes each decide for themselves, in at least three styles. There is no single place that
answers "may a MEMBER call this route?", and no test that enumerates routes × roles, so **a new
route ships with no authorization and nothing catches it**. The current code is correct; the
structure is what invites the next mistake.

### 7. No published permission matrix (low, ~1 h)

The differences between owner and admin are real and undocumented (workspace rename is owner-only
while cost is admin-OK). Nobody can look up the answer, so the answer drifts.

---

## Recommended sequence

| Phase | Work | Effort | Why |
|---|---|---|---|
| **1** | Audit role changes; align `/api/ai/admin` with `/api/ai/providers`; publish this matrix as `docs/PERMISSIONS.md`; add a route × role test that fails when a new route has no guard | **half a day** | Closes the two real inconsistencies and makes gaps visible |
| **2** | One `requirePermission(route, role)` guard plus a declarative permission table; migrate routes; add `VIEWER` project role | **2–3 days** | Turns ad-hoc checks into one policy, and makes read-only collaborators possible |
| **3** | Custom roles stored in the database, per-record sharing, SSO/SCIM | **1 week+** | Only worth it when headcount or client access demands it |

**My recommendation: do phase 1 now.** It is half a day, it fixes an audit blind spot and a
genuinely inconsistent permission, and the route × role test is what stops this class of bug
recurring. Phase 2 is worth doing before the team grows past about five people; phase 3 is a
"when you have enterprise clients" problem.

---

## Appendix: method

Probes ran against `cyraops_rbac`, a database created from `prisma/migrations`, seeded with
owner/admin/member/outsider users, and driven with real session cookies. Sessions were minted
with `createSession`, requests were made with `fetch` against a local dev server, and results
were read back from Postgres where the response alone was not enough. The database and the dev
server were removed afterwards.
