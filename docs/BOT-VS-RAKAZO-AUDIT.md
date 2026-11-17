# CyraOps bot vs Rakazo — experience audit

**Date:** 16 November 2026
**Scope:** the bot workspace (`/ai`) and every surface a workspace owner touches when using it.
**Method:** ten parallel auditors, one per surface, each probing the running app with real session
cookies and reading the code that renders it. Findings cite `file:line` or an HTTP result. The
central claim — what happens when you try to create an agent — I verified first-hand myself.

**No changes were made.** This is a report.

---

## Verdict in one paragraph

**The capability is mostly there; the product around it is not.** The bot can research live CRM
data, run tools with visible steps, produce a designed document, open it, version it, share it and
export it — I have measured all of that working. What is missing is the *workspace* around the
capability: you cannot reach agent creation from the bot, a created agent cannot be edited,
deleted, given different tools or a different model; approvals were deliberately meant to live
inside the bot but were never wired into it; routines cannot be created at all; the teammate list
is desktop-only. Individually these are small. Together they are why it feels like a demo of a
product rather than the product.

| Surface | Score | One line |
|---|---|---|
| Chat | **7/10** | Looks the part, is not yet dependable (no retry, fake Stop) |
| Documents/pages | **5/10** | Best-built surface; cannot be hand-edited, leaks HTML on export |
| Publishing/sharing | **5/10** | Works, but blind and irreversible |
| Memory/knowledge | **4/10** | Remembers silently, shows little, controls nothing |
| Approvals/autonomy | **4/10** | The promise is not kept |
| Models/cost | **4/10** | Model choice is decorative; spend is not controlled |
| **Agents** | **3/10** | Creation is hidden, then permanent and powerless |
| Automation | **3/10** | Routines exist in the database only |
| Reachability/mobile | **3/10** | The teammate roster does not exist on a phone |

---

## The direct question: can we create agents like Rakazo?

**Yes — and then you are stuck.** Four facts, all verified:

1. **The feature exists but nothing points to it.** `POST /api/ai/agents` creates a specialist
   (owner/admin only; a member gets `403`). The form is at `/ai/agents`, which is **not in the
   sidebar**, has no button on `/ai`, and no command-palette entry. The bot page's seven-teammate
   roster is read-only. The header's primary "+" is labelled **"Create a project"**
   (`workspace-shell.tsx:81`) — the one obvious create button in the app takes you away from agents.

2. **A created agent is permanent.** There is no edit and no delete: `PATCH`/`PUT`/`DELETE` on
   `/api/ai/agents/*` return 404/405. `agentRegistry.updateAgent()` exists and is called by
   nothing. A prompt typo means editing the database. Created agents accumulate forever in the
   roster and in every planner run.

3. **Every custom agent gets the same four powers.** The route hardcodes
   `tools: ["search_companies","search_leads","search_deals","create_task"]` and
   `permissions: ["tasks:write","leads:read"]` (`api/ai/agents/route.ts:47`). Ask for a *Proposal
   Writer* and it cannot draft email, cannot read documents, cannot browse, cannot create a page.
   There is no tools picker, no knowledge picker, no integrations. The stored `permissions` list is
   not enforced anywhere.

4. **Its model choice does nothing.** The form offers a "model profile", but `AiAgent` has no model
   column and the runtime passes `modelProfile: "general"` with the *assistant's* model
   (`assistant/runtime.ts:536`). A "Deep Reasoning" teammate reasons with `deepseek-flash`.

So the honest answer to "can we create agents like Rakazo": **the create button is the smallest
missing piece.** What makes Rakazo's bot creation feel like a product is that the bot you create is
then editable, tool-scoped, model-aware and deletable. Ours is a row that can only be born.

---

## Surface findings

### Agents — 3/10
- Roster is read-only; creation is URL-only; "Agent created!" then an unchanged roster (the new
  agent is invisible until reload).
- A member filling the form gets a **silent no-op** — no toast, no explanation.
- No lifecycle: no edit, rename, pause, delete. No "test this agent" step.

### Chat — 7/10
- **Works well:** streaming, per-step tool trail with timings, markdown tables with CSV export,
  voice input, paste/drag attachments, draft persistence, IME-safe Enter.
- **No retry.** Zero matches for retry/regenerate in `bot-workspace.tsx`. A failed turn returns
  your text to the composer and that is all.
- **Stop is cosmetic.** The SSE route never reads `request.signal`, so aborting cancels the browser
  while the server keeps generating and billing.
- **Every turn generates twice:** a blocking completion to discover tool calls, then a streamed
  regeneration. That is why the first visible token takes ~2–20 s.
- A file with no caption cannot be sent (`send()` returns early on empty text).

### Documents/pages — 5/10
- **Strongest surface:** server-rendered kit, sandboxed iframe, append-only versions, revocable
  public link, three export formats.
- **Cannot be hand-edited.** `PATCH /api/pages/:id` exists; no UI calls it. Fixing one word means
  asking the bot.
- **No page home:** no Documents nav entry, no authenticated permalink, global search finds nothing.
- **Export degrades on real bot pages.** The page tools store *rendered* HTML, so Markdown export
  leaks a literal `<nav class="cy-toc">` block and flattens a metrics row into three loose lines.
  I reproduced this directly: `create_page` → `sanitizePageHtml` (which now renders the kit) →
  `pageToMarkdown`. My earlier export tests used raw kit tags and therefore flattered it.

### Publishing — 5/10
- `shareExpiresAt` is schema-backed and API-supported, but **no UI or tool sets it**, and an expired
  link keeps its green "Shared" badge.
- "New link" publishes as a side effect; revoke and rotate are one unconfirmed click each.
- A shared page is anonymous: no title in the body, no OG tags, no favicon, 36-char URLs.
- No view counts, no password, no recipient gating, no list of live links.

### Memory/knowledge — 4/10
- Uploads are **write-only**: no list/delete/reuse endpoint; PDFs and images are never read;
  spreadsheet analysis fails from this path.
- "What it remembers" cannot be added to or edited, appears only ≥1280px, and its delete control is
  invisible until hover.
- "What it can see" is a hardcoded 10-chip list against 38 real tools.
- Silent background fact extraction on every message — no consent, archives rather than deletes.

### Approvals/autonomy — 4/10
- **No home.** The queue only renders on `/tasks`; `/ai/approvals` renders the legacy console;
  pending approvals in chat vanish on reload while the reply still says "approve below". The code
  comments say approvals deliberately live inside the bot — the intent is right, the wiring is not.
- "Ask me" does not gate background agent writes. Ask and Auto behave alike.
- No readable audit: `AiAuditLog` has no read endpoint or UI.
- Hidden, non-configurable $2/user/day chat cap that agent runs bypass.

### Automation — 3/10
- **Routines cannot be created or edited anywhere:** no POST API, no UI form, no bot tool — only a
  hardcoded seed. The Routines modal is read-only.
- No visible run history; failure notifications link to a page that does not exist.
- Goals have no entry point, ignore `?goal=` deep links, and execute the goal inside the request.

### Models/cost — 4/10
- Per-agent model selection does not exist (see above).
- `DEEPSEEK_MODEL` pins planning and goal work to flash regardless of what you pick.
- **Bring-your-own-key is dead in this deployment:** `POST /api/ai/providers` returns 400 because
  `AI_KEY_ENCRYPTION_SECRET` is unset.
- Streamed turns are recorded twice; goal runs pass `userId: ""` so their tokens vanish from usage.

### Reachability/mobile — 3/10
- The teammate roster is `hidden md:flex` with **no mobile drawer** — the agents do not exist on a
  phone, and their scoped threads are unreachable.
- The header row makes the page pan sideways at 390px; the page panel is unusable there.
- Panels lack dialog semantics and focus handling; 28px tap targets; 13px composer input triggers
  iOS zoom.

---

## What Rakazo has that we do not

| Rakazo | CyraOps today |
|---|---|
| Bots are the unit; "+" creates one from a plain-language chat | Agent creation hidden on an unlinked page |
| Templates with a sample output, instructions, skill, paused routine | Nothing — start from a blank five-field form |
| Per-bot tool enable/disable, space-wide connections with first-use approval | Four hardcoded tools for every agent, no connections |
| Model + reasoning effort per bot | One model for the assistant; profile ignored |
| Curated knowledge, inspectable | Memory + chat attachments, no curated list |
| Bot computer (Docker/sandbox), phone apps | Per-user browser session; no mobile app |
| Self-host (Apache-2.0) or hosted $15/mo | Ours, on Azure |

Rakazo is horizontal — it knows nothing about deals, leads or tickets without integrations. **We
are vertical and we already own the CRM data.** That is our advantage; it is not yet an experience
advantage.

---

## Gap register — priority order

| # | Gap | Why it matters | Effort |
|---|---|---|---|
| 1 | **New teammate entry in `/ai`** + sidebar link + palette action | Turns an existing feature into a found one | 2 h |
| 2 | **Agent lifecycle:** edit, pause, delete (API + UI) | A created agent is currently permanent | 1 d |
| 3 | **Tool & model selection per agent** (+ make model actually run) | Without it, every agent is the same agent | 1–2 d |
| 4 | **Chat turn control:** retry, real Stop (read `request.signal`), single generation per turn | Trust and cost | 1 d |
| 5 | **Approvals inside the bot**, rehydrated on reload + readable audit | The autonomy promise | 1–2 d |
| 6 | **Routine create/edit API + UI** | Automation is currently decorative | 2 d |
| 7 | **Store raw page content**; render at display time (fixes export) + hand editing + page permalink | Documents you can correct and keep | 1–2 d |
| 8 | **Mobile:** drawer for the roster, stacked header, real dialog semantics | The bot is unusable on a phone | 2 d |
| 9 | **Publishing controls:** confirm revoke, expiry UI, view counts, OG tags | Shipping something is currently a gamble | 1 d |
| 10 | **Memory:** list/delete uploads, editable memories, honest "what it can see", consent | Privacy, and grounding you can inspect | 2 d |
| 11 | **Cost truth:** fix double-recording, per-run attribution, visible cap, enable provider keys | You cannot trust the numbers today | 1 d |

**Highest value for the least work:** 1, 4 and 7. Together they are about two days and they change
the answer to "is this a product?" more than anything else on the list.

---

## Method and honesty notes

- Ten auditors, each writing structured findings to disk: agents, chat, pages, memory, approvals,
  automation, models, publishing, mobile/a11y, and Rakazo itself (researched from their site and
  docs, since the app is behind auth).
- **I personally verified:** agent creation reachability and the 403 for members; the hardcoded
  tools (`route.ts:47`); `PATCH` returning 404; no retry in the chat UI; the stream route ignoring
  `request.signal`; the deliberate no-nav comment for approvals; and the Markdown export
  degradation, by running the real `create_page` → render → export path.
- **Agent-reported, spot-checked but not exhaustively proven:** the $2/day cap, the double
  recording of streamed turns, the empty provider list, and the itemised mobile/layout issues.
- Test data lived in a disposable database (`cyraops_botaudit_test`), now removed, and the local
  server was stopped. **No product code, schema or configuration was changed.**
