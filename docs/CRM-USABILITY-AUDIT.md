# CRM usability and navigability audit

**Date:** 15 November 2026
**Subject:** the authenticated CRM (not the marketing site)
**Method:** the app was run locally against a **freshly migrated database** and driven with a
real authenticated session in a headless browser. 17 routes, two viewports, keyboard traversal,
and every sidebar link clicked.

### Why a fresh database matters

The first pass ran against the existing development database and reported 500s on `/ai`,
`/ai/tasks`, `/ai/approvals` and `/projects`. Those were **not product defects**. The server log
showed `PrismaClientKnownRequestError P2022: column "AiTask.goalId" does not exist` — that local
database is missing several migrations. Against a database built from `prisma/migrations`, every
one of the 500s disappeared.

That is itself a finding, recorded at the end under **Environment**.

---

## What works

| Check | Result |
|---|---|
| All 13 sidebar links | land on the correct route, no dead ends, no redirect loops |
| Active state on navigation | 12 of 13 mark themselves current; the brand logo correctly does not |
| Console errors | **0** across 17 routes |
| Failed network requests | **0** |
| HTTP errors | **0** |
| Horizontal overflow at 1440px | **0px** on every route |
| Horizontal overflow at 390px | **0px** on dashboard and CRM |
| Mobile navigation | "Open menu" opens a 390px drawer over the page — reachable and usable |
| Keyboard focus visibility | **22 of 22** tab stops show a visible focus ring |
| One `h1` per page | 13 of 17 routes |

Navigability is genuinely good: every entry in the sidebar goes somewhere real, the current page
is marked, and the mobile drawer works. The defects below are accessibility and structure, not
broken routing.

---

## Defects

### 1. No skip link — keyboard users must tab through the whole sidebar (high)

Measured tab order from the top of `/dashboard`:

```
1. Cyraops CRM CYRAOPS   ← brand
2. Dashboard             ← 13 sidebar links follow
3. CRM
   … (Tabs 1–13 are all navigation)
```

The first ten stops are navigation. A keyboard user reaches page content only after thirteen
links, and there is no "skip to content" control anywhere in the app. **WCAG 2.4.1 (Bypass
Blocks).**

**Fix:** one link at the top of the workspace shell, visually hidden until focused, pointing at
`#main`; give `<main>` `id="main"` and `tabIndex={-1}`.

### 2. Four pages have no `h1` (high)

`/email`, `/ai`, `/ai/tasks`, `/ai/approvals` render no `h1` — `/email` has no `h2` either.

These pages do have visible titles, so this is invisible to a sighted user and total for a screen
reader: no announcement of what page you are on, and nothing for "jump to heading" navigation.
**WCAG 1.3.1, 2.4.6.**

**Fix:** promote each page's visible title to `h1`. Where the title is an icon plus text, the text
becomes the `h1` and the icon gets `aria-hidden`.

### 3. Five icon-only buttons have no accessible name (medium)

Found by scanning every `button` for missing text and `aria-label`:

| Page | Count | Typical class |
|---|---|---|
| `/ai` | 3 | `flex h-9` |
| `/email` | 1 | `text-neutral-400 hover:text-neutral-600` |
| `/tasks` | 1 | `flex h-6` |

A screen reader announces these as "button" with no purpose. **WCAG 4.1.2 (Name, Role, Value).**

**Fix:** add `aria-label` to each (e.g. "Clear search", "Dismiss", "Advance task status"). The
project already follows this pattern elsewhere — the header's icon buttons are all labelled
("Notifications", "Switch to dark theme"), so these are gaps rather than a convention.

### 4. Two `main` landmarks on the same page (medium)

`/ai/tasks` and `/ai/approvals` each render **two** `main` elements: the workspace shell's
`<main>` and a second one inside the AI workspace component. Only one `main` per page is valid;
screen-reader landmark navigation becomes ambiguous. **WCAG 1.3.1.**

**Fix:** the inner one becomes a `<div>` or a `<section aria-labelledby=…>`.

### 5. The logo link announces itself twice (low)

The brand anchor's accessible name is `"Cyraops CRM CYRAOPS"` — the visible wordmark plus a
hidden second copy of the company name. Screen readers read it twice.

**Fix:** `aria-label="CyraOps — dashboard"` on the anchor, and `aria-hidden` on the decorative
inner text.

### 6. Empty states dominate most lists in this dataset (informational)

With the audit seed (one lead, one deal, one project, one task), most routes render under 450
characters: `/activity` 185, `/tasks` 234, `/projects` 253, `/crm` 535.

This is **not a defect** — it is the honest empty state. It does mean table behaviour, pagination,
sorting and long-name truncation were **not exercised** by this audit. Assessing those needs a
realistic dataset, and is worth a follow-up before launch.

---

## Environment

**The development database on this machine is stale and half-broken.** Any 500 on `/ai`,
`/ai/tasks`, `/ai/approvals`, `/projects` when running `npm run dev` locally comes from missing
columns (`AiTask.goalId`, the assistant tables), not from the code.

It also contains test fixtures as real users — `owner@test.cyraops.com`,
`member@test.cyraops.com`, `remed_owner_…@cyraops.test` — left over from test runs against what
should have been a disposable database. The founder account is not present.

**Fix:** rebuild it from migrations rather than patching:

```bash
dropdb company_os_dev && createdb company_os_dev
npm run db:migrate          # applies prisma/migrations
# then create the real owner account through /setup
```

Do not use `prisma db push` here: the schema has drifted (a pending unique constraint on
`AiRoutine.webhookToken` triggers a data-loss warning) and pushing would paper over it.

---

## Suggested order of work

| # | Fix | Effort | Why first |
|---|---|---|---|
| 1 | Skip link + `main` id | 15 min | Affects every page, single change in the shell |
| 2 | `h1` on the four pages | 30 min | Screen-reader correctness, visible no change |
| 3 | Five `aria-label`s | 15 min | Five one-line edits |
| 4 | Remove the duplicate `main` | 20 min | One component |
| 5 | Rebuild the dev database | 20 min | Unblocks everyone's local environment |
| 6 | Audit with realistic data | 1–2 h | Only way to judge tables, pagination, truncation |
