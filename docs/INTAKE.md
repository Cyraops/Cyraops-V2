# Getting leads into Cyraops automatically

Three ways a lead can arrive without anyone typing it in. All three end in the
same place — `createLeadWithProvenance` — so every lead carries a source, a
deterministic score, a linked contact, an activity row and dedup by email/phone.

---

## 1. Website form (already live)

`POST /api/public/inquiries` — the marketing site's form. Same-origin guarded,
honeypot field, rate-limited by IP and email. A returning prospect reactivates a
previously dismissed lead instead of creating a second one.

---

## 2. Intake token (forms, Zapier, Typeform, any HTTP client)

### Create a token

```bash
curl -X POST https://www.cyraops.com/api/intake/tokens \
  -H "cookie: company_session=<your session>" \
  -H "content-type: application/json" \
  -H "origin: https://www.cyraops.com" \
  -d '{"label":"Website form","source":"website"}'
```

Returns, **once**:

```json
{ "token": "cyi_...", "id": "…", "label": "Website form", "source": "website",
  "hint": "a1b2c3", "url": "/api/intake/cyi_..." }
```

Only the SHA-256 hash is stored, so the raw token cannot be recovered. If it is
lost, revoke it and make a new one.

Owners and admins can create tokens; anyone can see and revoke their own.

### Send a lead

```bash
curl -X POST https://www.cyraops.com/api/intake/cyi_… \
  -H "content-type: application/json" \
  -d '{
    "name": "Ana Ruiz",
    "company": "Northwind Logistics",
    "email": "ana@northwind.example",
    "message": "We need a warehouse integration before Q3",
    "estimatedValue": 18000,
    "signals": {
      "publicPain": { "value": "migration", "state": "observed" },
      "authority":  { "value": "exec",      "state": "observed" },
      "valueBand":  { "value": "l",         "state": "observed" }
    }
  }'
```

`title` and `name` are interchangeable, as are `company`/`companyName`,
`notes`/`message`, `value`/`estimatedValue` — webhook tools name things
differently and rejecting a lead over a field name is a silent lost sale.

Responses: `201` created, `200` deduped (email or phone already known),
`400` invalid, `401` bad or revoked token, `413` too large, `429` rate limited.

`GET /api/intake/<token>` reports whether the token is live without writing.

### Signals

A signal counts only when someone actually looked. Every signal is
`{ value, state }` where `state` is `observed`, `checked_absent` or
`not_checked`. Supplying no signals is fine: the lead is scored
`INSUFFICIENT_DATA` instead of being handed an invented band.

Available signals: `cloudFootprint`, `headcount`, `industryMatch`, `funding`,
`hiring`, `publicPain`, `authority`, `reachable`, `warmPath`, `valueBand`,
`timing`, and `knockout` (`competitor`, `repeatLost`, `freeMailOnly`, `cheapest`,
`archived`).

---

## 3. Inbound email

`POST /api/intake/<token>/email` — point a mail provider's inbound webhook, or a
forwarding rule, at this URL.

```json
{ "from": "Ana Ruiz <ana@northwind.example>",
  "subject": "Need help with our Azure migration",
  "text": "We are moving 40 services off on-prem…" }
```

`from`/`sender`, `text`/`body`/`plain` are accepted for the same reason as above.

**The guard list** rejects, writing nothing and answering `202`:

| Rejected | Why |
| --- | --- |
| `no-reply@`, `mailer-daemon@`, `postmaster@`, `notifications@`, … | machine mailboxes are never buyers |
| `*@cyraops.com` (and any configured internal domain) | our own staff are not prospects |
| "Out of office", "Automatic reply", "I am currently away" | nobody is reading |
| "Delivery Status Notification", "Undeliverable", "Returned mail" | bounces are not leads |
| empty body | nothing to sell to |

**The cap**: 60 accepted messages per token per hour, in its own bucket so a
noisy mailbox cannot starve form submissions. Over the cap returns `429`, which
tells a provider to retry rather than drop mail.

A sender on a free mailbox (`gmail.com`, `outlook.com`, …) becomes a lead with no
company and a `freeMailOnly` knock-out. That is deliberate: the address is real,
but it cannot be attributed to a business.

---

## Research before you write

`research_company_site` (available to the Research agent) reads a company's own
site and reports only what it found, each finding with a quote and source URL:
cloud provider mentioned, industry vocabulary, migration/cost/compliance pain
language, careers and pricing pages, title and headings.

It returns `suggestedSignals` and `evidence` that can be passed straight to
`create_lead`, so a researched lead keeps its provenance. Anything the site did
not say is reported as unchecked — a missing careers page is not evidence of no
hiring, so `hiring` stays unknown rather than becoming a false negative.

Safety: URLs go through the same SSRF check as the browser tools (scheme, private
addresses, cloud metadata), every redirect hop is re-validated, responses are
capped at 512 KB, requests time out after 8 s, and the page is parsed as text with
no JavaScript executed.

Because the content comes from outside the CRM, the tool taints the run: in
background work, any later write that the policy would want a person to see is
parked as an approval card instead of executed.

---

## Checking it worked

- Lead exists: `GET /api/crm/leads` (as the token owner).
- Token health: `GET /api/intake/tokens` shows `lastUsedAt` and `useCount`.
- Runs: `db.aiAuditLog` records tool executions and approval decisions.
