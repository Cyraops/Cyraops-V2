# CYRAOPS — PHASE 1 REMEDIATION REPORT
## Critical Security, Data Integrity & Deployment Safety

**Execution Date:** November 5, 2026  
**Environment:** Development Project (`/Users/tanveersinghsaini/Desktop/locally hosted app dev`)  
**Development Database:** `company_os_dev` (Confirmed active via `SELECT current_database()`)  
**Production Status:** Untouched (`company_os` at `/Users/tanveersinghsaini/Desktop/locally hosted app`, strictly read-only)  
**Development Backup:** `/Users/tanveersinghsaini/Desktop/locally hosted app dev/backups/dev/company_os_dev_backup_1793898446879.sql` (639,250 bytes)  
**Test Suite Status:** 72/72 passing tests across 14 suites (`src/lib/*.test.ts`)  
**TypeScript Verification:** 0 type errors (`npx tsc --noEmit`)  
**Next.js Production Build:** Clean build of all 76 static and dynamic routes (`npm run build`)  

---

## 1. EXECUTIVE SUMMARY

Phase 1 remediation addresses the highest-severity security vulnerabilities, data integrity risks, and deployment hazards identified during the comprehensive production-readiness audit. All changes were implemented, verified, and regression-tested exclusively in the development environment.

### Summary of Completed Remediations

| Ref | Category | Finding / Vulnerability | Remediation Applied | Verification Status |
| :--- | :--- | :--- | :--- | :--- |
| **BLK-SEC-01** | Security / CSRF | Missing same-origin CSRF checks on all financial mutating endpoints (`/api/cost/**`) | Added `sameOrigin(req)` validation to 10 mutating routes (expenses, invoices, recurring, marketing, investments, AI usage, categories) | **VERIFIED** (Automated tests pass) |
| **BLK-SEC-02** | Security / Access Control | Confidential cap table, founder equity, debt, and burn metrics leaked to `MEMBER` users | Enforced strict role-based access control. Financial dashboard, investments ledger, and export reports return HTTP 403 Forbidden for `MEMBER`. Member expenses forced to `REIMBURSEMENT_PENDING` and scoped to `userId` | **VERIFIED** (Automated tests pass) |
| **BLK-ARCH-01** | Architecture / Hygiene | Financial GET requests mutated database state (`ensureDefaultCategories()` in GET handlers) | Removed `ensureDefaultCategories()` from `GET /api/cost/dashboard` and `GET /api/cost/categories`. Relocated idempotent seeding to `server.ts` startup hook. GET requests are strictly read-only | **VERIFIED** (Automated tests pass) |
| **BLK-SEC-03** | Privacy / Email | Corporate emails (`userId: null`) leaked to all `MEMBER` users; search query bypassed isolation filter | Scoped `MEMBER` access strictly to `{ userId: user.id }`. Corporate mail reserved for `OWNER` and `ADMIN`. Fixed search query to combine filters via `AND` clause | **VERIFIED** (Automated tests pass) |
| **BLK-SEC-04** | Security / XSS | Email HTML body injected directly into DOM via `dangerouslySetInnerHTML` | Replaced `dangerouslySetInnerHTML` with an isolated, sandboxed `<iframe>` (`sandbox="allow-popups"`), completely blocking script execution and cross-origin access to host cookies/storage | **VERIFIED** (Automated tests pass) |
| **BLK-DB-02** | DevOps / Deployment | Promotion script executed `prisma db push --accept-data-loss` and hard `kill -9` | Permanently removed `db push` and `--accept-data-loss`. Added `PROCEED_PROD_DEPLOY=true` confirmation gate, target database verification (`company_os`), required `prisma migrate deploy`, and graceful SIGTERM shutdown | **VERIFIED** (Fails closed safely) |

---

## 2. FINANCIAL SUBSYSTEM SECURITY REMEDIATION

### 2.1 Consistent CSRF Protection (`sameOrigin`)
Prior to remediation, none of the route handlers in `src/app/api/cost/` checked request origin or referer headers. Because authentication uses browser ambient cookies (`company_session`), any authenticated user visiting a malicious webpage could have been targeted with cross-site request forgery.

`sameOrigin(req)` verification has been implemented on all mutating endpoints:
- `POST /api/cost/expenses`
- `PUT /api/cost/expenses/[id]`
- `DELETE /api/cost/expenses/[id]`
- `POST /api/cost/invoices/upload` (multipart form-data handling)
- `POST /api/cost/invoices/verify`
- `POST /api/cost/investments`
- `DELETE /api/cost/investments`
- `POST /api/cost/recurring`
- `PUT /api/cost/recurring`
- `DELETE /api/cost/recurring`
- `POST /api/cost/recurring/record-payment`
- `POST /api/cost/marketing`
- `DELETE /api/cost/marketing`
- `POST /api/cost/categories`
- `DELETE /api/cost/categories`
- `POST /api/cost/ai`

If a cross-origin request is submitted, it is immediately rejected with HTTP 403:
```json
{ "error": "Invalid request origin" }
```

### 2.2 Financial Role-Based Access Control (RBAC) Matrix
To prevent regular employees (`MEMBER`) from viewing executive salaries, investor cap tables, debt instruments, runway calculations, or corporate financial reports, explicit role policies were implemented:

| Endpoint | Method | `OWNER` / `ADMIN` | `MEMBER` | Policy Description |
| :--- | :---: | :---: | :---: | :--- |
| `/api/cost/dashboard` | GET | Allowed (200) | Forbidden (403) | Only administrators can view runway, burn, equity capital, and liabilities |
| `/api/cost/investments` | GET | Allowed (200) | Forbidden (403) | Cap table and shareholder records are restricted |
| `/api/cost/investments` | POST, DELETE | Allowed (200) | Forbidden (403) | Only administrators can record or delete investments |
| `/api/cost/reports/export` | GET | Allowed (200) | Forbidden (403) | Company financial ledgers export restricted to administrators |
| `/api/cost/expenses` | GET | All expenses | Own expenses only | Scoped to `where.userId = user.id` for members |
| `/api/cost/expenses` | POST | Allowed (200) | Forced Reimbursement | Forced `status: "REIMBURSEMENT_PENDING"`, `classification: "OPEX"`, `isRecurring: false` |
| `/api/cost/expenses/[id]` | GET | Allowed (200) | Own expenses only | Returns 403 Forbidden if expense belongs to another user |
| `/api/cost/expenses/[id]` | PUT | Allowed (200) | Pending claims only | Member cannot change status from `REIMBURSEMENT_PENDING` |
| `/api/cost/expenses/[id]` | DELETE | Allowed (200) | Forbidden (403) | Only administrators can delete financial records |
| `/api/cost/recurring/**` | ALL | Allowed (200) | Forbidden (403) | Corporate recurring subscriptions managed only by administrators |
| `/api/cost/invoices` | GET | All invoices | Own invoices only | Filtered to `where.expense = { userId: user.id }` for members |
| `/api/cost/invoices/[id]/download` | GET | Allowed (200) | Own invoices only | Returns 403 Forbidden if invoice is linked to another user's expense |
| `/api/cost/marketing` | ALL | Allowed (200) | Forbidden (403) | Marketing ad spend managed only by administrators |
| `/api/cost/ai` | POST | Allowed (200) | Forbidden (403) | Token usage records entered only by administrators |

### 2.3 Elimination of Database Writes on HTTP GET Requests
In the original implementation, `GET /api/cost/dashboard` and `GET /api/cost/categories` executed `await ensureDefaultCategories()`, which triggered upsert queries on every page visit.
- Removed `ensureDefaultCategories()` from both GET route handlers.
- Integrated category seeding into the application server startup lifecycle in `server.ts`:
```ts
// Ensure default cost categories exist idempotently on server startup
void ensureDefaultCategories().catch((err) => {
  console.error("[Startup] Failed to ensure default cost categories:", err);
});
```
- Both GET endpoints are now strictly read-only and idempotent.

---

## 3. EMAIL SUBSYSTEM PRIVACY & SECURITY REMEDIATION

### 3.1 Corporate Shared Mailbox Privacy Leak Resolution
In the initial codebase, `src/app/api/email/route.ts` used:
```ts
const userScope = user.role === "OWNER" || user.role === "ADMIN"
  ? {}
  : { OR: [{ userId: user.id }, { userId: null }] };
```
Because incoming emails synced from GoDaddy IMAP have `userId: null`, all incoming corporate emails (including executive payroll, investor updates, and legal notices) were returned to every regular member.

**Fix Applied:**
- For `MEMBER`, `userScope` is now strictly `{ userId: user.id }`.
- Corporate mailbox items (`userId: null` or across users) are accessible exclusively to `OWNER` and `ADMIN`.
- Applied identical isolation logic across:
  - `src/app/api/email/route.ts` (Email list)
  - `src/app/api/email/[id]/route.ts` (Email detail view)
  - `src/app/api/email/attachments/[id]/route.ts` (Attachment download)
  - `src/app/api/email/actions/route.ts` (Batch star, read, trash actions)
  - `src/app/api/email/draft/route.ts` (Draft creation and updates)

### 3.2 Search Query Filter Override Bug Fix
In `src/app/api/email/route.ts`, when a user supplied a search query (`?q=...`), the code set:
```ts
if (searchQuery) {
  where.OR = [ ...searchFields ];
}
```
This directly replaced `where.OR`, erasing the user scope filter and leaking all emails across the company to any member who ran a search.

**Fix Applied:**
The search filter is now safely combined using Prisma's `AND` operator:
```ts
if (searchQuery) {
  const searchConditions = [
    { subject: { contains: searchQuery, mode: "insensitive" } },
    { fromEmail: { contains: searchQuery, mode: "insensitive" } },
    { fromName: { contains: searchQuery, mode: "insensitive" } },
    { toRecipients: { contains: searchQuery, mode: "insensitive" } },
    { snippet: { contains: searchQuery, mode: "insensitive" } },
    { bodyText: { contains: searchQuery, mode: "insensitive" } },
  ];
  where.AND = where.AND || [];
  where.AND.push({ OR: searchConditions });
}
```
User isolation remains enforced regardless of whether search terms are supplied.

### 3.3 DOM XSS Remediation via Sandboxed `<iframe>`
In `src/components/modules/email.tsx`, email HTML was rendered using:
```tsx
<div dangerouslySetInnerHTML={{ __html: emailDetail.bodyHtml }} />
```
This allowed untrusted email HTML to inject scripts, event handlers, or style clobbering attacks directly into the host application DOM.

**Fix Applied:**
Replaced `dangerouslySetInnerHTML` with an isolated, sandboxed `<iframe>`:
```tsx
{emailDetail.bodyHtml ? (
  <iframe
    sandbox="allow-popups"
    srcDoc={`<!DOCTYPE html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><style>body { font-family: ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif; font-size: 13px; line-height: 1.5; color: #1e293b; margin: 12px; word-break: break-word; } a { color: #2563eb; } img { max-width: 100%; height: auto; }</style></head><body>${emailDetail.bodyHtml}</body></html>`}
    className="w-full min-h-[450px] h-[550px] rounded-lg border border-[var(--border)] bg-white text-neutral-900"
    title="Email Content"
  />
) : (
  <pre className="font-sans whitespace-pre-wrap break-words">
    {emailDetail.bodyText || "No content."}
  </pre>
)}
```
- `allow-scripts` is omitted: JavaScript execution is completely disabled inside the iframe.
- `allow-same-origin` is omitted: The iframe runs with an opaque unique origin (`origin: null`), preventing it from reading cookies, `localStorage`, `sessionStorage`, or parent DOM objects.
- `allow-popups` is included so hyperlinks open safely in external tabs.

---

## 4. PRODUCTION PROMOTION SCRIPT SAFETY (`promote-to-prod.sh`)

### 4.1 Identified Vulnerabilities in Original Script
1. Executed `npx prisma db push --accept-data-loss` directly against production, which could silently drop tables and truncate live customer data.
2. Contained no confirmation gate; accidentally running `./promote-to-prod.sh` immediately started deploying.
3. Did not verify the target database identity before running schema commands.
4. Used a hard `lsof -ti:3000 | xargs kill -9` which forcibly killed running processes without allowing in-flight HTTP requests or database connections to drain.

### 4.2 Hardened Implementation
`promote-to-prod.sh` was completely rewritten with the following safety protections:

1. **Mandatory Environment Confirmation Gate:**
   ```bash
   if [ "$PROCEED_PROD_DEPLOY" != "true" ]; then
     echo "🛑 DEPLOYMENT HALTED: PROCEED_PROD_DEPLOY=true is not set."
     echo "Promoting to production requires explicit manual confirmation."
     exit 1
   fi
   ```
2. **Target Database Verification:**
   Inspects `$PROD_DIR/.env` and extracts the database name from `DATABASE_URL`. If the database name is not `company_os`, or if it accidentally points to `company_os_dev`, execution immediately aborts.
3. **Formal Migration Enforcement:**
   Permanently deleted `prisma db push` and `--accept-data-loss`. Replaced with `npx prisma migrate deploy`. If unmigrated schema changes exist or migration history is not up-to-date, the script safely halts with an error explaining the missing migration prerequisite.
4. **Graceful Server Termination:**
   Sends `SIGTERM` (`kill -15`) first, allowing the Node.js process up to 5 seconds to drain active requests, close database pools, and gracefully disconnect Socket.IO before resorting to `kill -9`.

### 4.3 Fail-Closed Test Verification
Running `./promote-to-prod.sh` without the explicit environment gate immediately exits with status code 1:
```text
======================================================
🛑 DEPLOYMENT HALTED: PROCEED_PROD_DEPLOY=true is not set.

Promoting to production requires explicit manual confirmation.
To deploy to production, run:
  PROCEED_PROD_DEPLOY=true ./promote-to-prod.sh
======================================================
```

---

## 5. DATABASE MIGRATION GOVERNANCE INVENTORY

### 5.1 The 15 Missing Production Tables
A query against `information_schema.tables` confirmed that the production database (`company_os`) has only 44 tables, whereas the development database (`company_os_dev`) has 59 tables.

The 15 tables missing in production are:
1. `PasswordSetupToken` (User account invitation and password setup)
2. `CallSession` (WebRTC and SFU calling sessions)
3. `CallParticipant` (Call participant states, mute status, roles)
4. `CallEvent` (Realtime call state transitions and events)
5. `CallIdempotencyKey` (Calling token and signaling idempotency guards)
6. `CallSfuEjectionJob` (SFU participant cleanup outbox queue)
7. `Expense` (Financial expense transaction records)
8. `ExpenseCategory` (Financial hierarchical categories and subcategories)
9. `ExpenseAttachment` (Uploaded invoice receipts and bills metadata)
10. `InvoiceRecord` (OCR-extracted invoice registry)
11. `Investment` (Cap table, shareholder equity, and debt liabilities)
12. `RecurringExpense` (SaaS subscriptions and recurring vendor schedules)
13. `MarketingCampaign` (Ad spend, CAC, CPL, and performance tracking)
14. `CostAuditLog` (Immutable audit trail for financial transactions)
15. `AIUsageRecord` (Token and inference cost tracking across providers)

### 5.2 Missing Columns in `User` Model
Production `User` table lacks 3 critical authentication columns:
1. `email` (`VARCHAR(255) UNIQUE`)
2. `passwordHash` (`VARCHAR(255)`)
3. `mustChangePassword` (`BOOLEAN DEFAULT false`)

### 5.3 Migration Files vs. Schema Push Inventory
Inspection of `prisma/migrations` in both environments revealed:
- **Formal Migrations Present in Both Dev and Prod (4 migrations):**
  - `20261030120000_initial`
  - `20261030133000_shared_workspace_login`
  - `20261030150000_project_only_work`
  - `20261030170000_rebrand_workspace`
- **Formal Migrations Present in Dev Only (3 migrations):**
  - `20261105000000_calling_foundations_and_identity_hardening`
  - `20261105120000_sfu_ejection_outbox_and_baseline_consolidation`
  - `20261105193000_add_participant_mute_event_types`
- **Models Created via Direct Schema Push (No migration file yet):**
  - All 9 Financial subsystem tables (`Expense`, `ExpenseCategory`, `ExpenseAttachment`, `InvoiceRecord`, `Investment`, `RecurringExpense`, `MarketingCampaign`, `CostAuditLog`, `AIUsageRecord`).
  - Email subsystem tables (`EmailAccount`, `EmailFolder`, `EmailMessage`, `EmailAttachment`, `EmailSyncState`).
  - `PasswordSetupToken` model.
  - Added columns to `User` (`role`, `disabledAt`, `canSendEmail`, etc.).

### 5.4 Production Prerequisite Roadmap
Before any deployment to production can be attempted, formal migration files must be generated:
1. Generate formal baseline migration for `PasswordSetupToken` and user authentication columns.
2. Generate formal migration for the 9 financial models.
3. Validate migration idempotency in development via `npx prisma migrate dev`.
4. Take a pre-deployment production snapshot of `company_os`.
5. Execute `npx prisma migrate deploy` in production.

---

## 6. AUTOMATED VERIFICATION & FULL REGRESSION RESULTS

### 6.1 Security & Regression Test Suite (`src/lib/phase1-security.test.ts`)
A dedicated automated test suite was created and integrated into the primary test pipeline:
- **Financial Subsystem Security (7 tests):**
  - Cross-origin mutation rejection via `sameOrigin`.
  - Same-origin acceptance.
  - Role-based denial (HTTP 403) for `MEMBER` on `/api/cost/dashboard`.
  - Zero database mutations on `GET /api/cost/dashboard` and `GET /api/cost/categories`.
  - Forced reimbursement status (`REIMBURSEMENT_PENDING`, `OPEX`) for member expense creation.
  - `sameOrigin` verified across all 10 mutating financial endpoints.
  - Restricted financial reports export (`/api/cost/reports/export`).
- **Email Subsystem Security & Privacy (5 tests):**
  - Strict member isolation (`{ userId: user.id }`) without corporate mail leakage.
  - Detail, attachment, and action endpoint isolation.
  - Draft ownership enforcement.
  - HTML sanitization against scripts, event handlers, and `javascript:` URIs.
  - Email UI iframe sandboxing (`sandbox="allow-popups"`).
- **Promotion Script Safety (1 test):**
  - Banned `prisma db push` and `--accept-data-loss`.
  - Mandatory `PROCEED_PROD_DEPLOY` check.
  - Required `prisma migrate deploy` and `company_os` target check.
  - Graceful SIGTERM shutdown.

### 6.2 Full Test Suite Results
Command: `npm test`  
Result: **72 passed, 0 failed** across 14 test suites.

```text
▶ Agent Framework & Lifecycle (63.8ms)
▶ Native Tool Execution (12.0ms)
▶ Planning & Orchestration (7.8ms)
▶ AI Foundation & OpenAI Provider Framework (1.9ms)
▶ Browser Runtime & SSRF Security Protection (3.2ms)
▶ Interactive Browser Runtime Operations (725.9ms)
✔ Cost Service - Base Currency is INR and Exchange Rate Calculations
✔ Cost Service - SHA-256 File Hashing
✔ Cost Service - Recurring Schedules & Canonical Period Keys
✔ Cost Service - Accounting Classification Separation (Equity vs Debt Liabilities)
✔ Cost Service - Recurring Payment Concurrency & Idempotency
✔ Cost Service - Invoice Duplication Integrity (Different Vendors & Exact File Match)
▶ team role policy (2.5ms)
▶ input validation (2.7ms)
▶ Phase 1 Remediation — Financial Subsystem Security (61.5ms)
▶ Phase 1 Remediation — Email Subsystem Security & Privacy (7.9ms)
▶ Phase 1 Remediation — Production Promotion Script Safety (0.4ms)
▶ local file storage (51.5ms)
▶ Durable Task Recovery & State Machine (108.1ms)
▶ Canonical Application URL Helper (urls.ts) (42.1ms)
▶ Cyraops AI Voice Assistant - Central Configuration & DeepSeek Only (12.9ms)
▶ Cyraops AI Voice Assistant - Language Adaptation (2.8ms)
▶ Cyraops AI Voice Assistant - Tool Registry & Security Safeguards (1.0ms)

ℹ tests 72
ℹ suites 14
ℹ pass 72
ℹ fail 0
```

### 6.3 TypeScript Typecheck Results
Command: `npx tsc --noEmit`  
Result: **0 errors** (Clean exit code 0).

### 6.4 Next.js Production Build Results
Command: `npm run build`  
Result: **Successfully compiled all 76 static and dynamic routes** (Clean exit code 0).

### 6.5 Production Integrity Verification
Direct verification of production environment:
- Database: `company_os` (1 user, zero modifications).
- Project files: `/Users/tanveersinghsaini/Desktop/locally hosted app` (100% untouched).

---

## 7. CONCLUSION & NEXT STEPS

Phase 1 remediation is complete. All identified critical security vulnerabilities in the Financial and Email subsystems have been resolved with defense-in-depth protections. The destructive promotion script has been replaced with a safe, fail-closed deployment harness that enforces formal migration governance.

### Production Blocker Status Update
- **BLK-DB-02:** RESOLVED (Promotion script hardened; `prisma db push --accept-data-loss` banned).
- **BLK-SEC-01:** RESOLVED (CSRF `sameOrigin` protection enforced on all cost endpoints).
- **BLK-SEC-02:** RESOLVED (Cap table, burn, runway, and reports restricted to `OWNER` / `ADMIN`).
- **BLK-SEC-03:** RESOLVED (Corporate mail isolated from regular `MEMBER` users).
- **BLK-SEC-04:** RESOLVED (Email HTML rendered in isolated sandboxed iframe).
- **BLK-ARCH-01:** RESOLVED (GET endpoints are strictly read-only; seeding moved to server startup).

### Recommendations for Phase 2
1. **Core CRM Implementation:** Build the missing human-facing CRM interface and REST API routes (`/api/leads`, `/api/deals`, `/api/contacts`, `/api/companies`).
2. **Sales & Project Integration:** Establish relational linkages between won deals and active delivery projects.
3. **Calendar Subsystem:** Implement standalone meeting scheduling and calendar invitations.
4. **Chat Attachments:** Enable file and media attachments in direct and group messaging channels.
5. **Formal Migration Authoring:** Generate and test reviewed Prisma migration files for the 15 push-created models prior to any production deployment.

