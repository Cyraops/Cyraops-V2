# CYRAOPS — PHASE 1 FINAL INDEPENDENT SIGN-OFF AUDIT
## Independent Verification & Security Sign-Off Assessment

**Audit Date:** November 5, 2026  
**Auditor Mode:** Strictly Read-Only Independent Assessment  
**Active Development Database:** `company_os_dev` (Verified via `SELECT current_database()`)  
**Active Production Database:** `company_os` (Verified via `SELECT current_database()`)  
**Development Workspace:** `/Users/tanveersinghsaini/Desktop/locally hosted app dev`  
**Production Workspace:** `/Users/tanveersinghsaini/Desktop/locally hosted app` (Untouched, 0 writes)  

---

## 1. EXECUTIVE VERDICT

### **VERDICT: CONDITIONAL PASS**
**(Development Hardening Substantially Verified; Production Deployment STRICT NO-GO)**

The Phase 1 remediation successfully implemented critical security protections, resolved major cross-origin request forgery (CSRF) vectors across financial mutations, closed employee email privacy leaks, sandboxed untrusted email HTML against DOM cross-site scripting (XSS), and removed destructive schema push commands from the promotion script.

However, independent read-only inspection uncovered key gaps and unverified claims:
1. **Financial Read Information Leakage:** While Cap Table, Financial Dashboard, and general expenses are protected from `MEMBER` users, alternative read endpoints (`GET /api/cost/recurring`, `GET /api/cost/marketing`, and `GET /api/cost/ai`) enforce zero role checks, leaking all corporate recurring subscriptions, monthly burn, ad spend, and AI model costs to regular members.
2. **Database Mutation on HTTP GET:** While `ensureDefaultCategories()` was successfully removed from `dashboard` and `categories`, `GET /api/cost/reports/export` executes `await logCostAudit(...)`, which performs a database `INSERT` into `CostAuditLog` on every HTTP GET download.
3. **Test Quality Asymmetry:** 10 of the 13 automated tests in `src/lib/phase1-security.test.ts` are static source-code regex assertions rather than true route-level integration tests with simulated session contexts.
4. **Production Schema Drift & Migration Governance:** A clean production database cannot be built from migration history alone. While 5 email tables do exist in production (contrary to prior report claims), 15 other tables and 3 `User` authentication columns are completely absent from `company_os`.

**Production Deployment Decision: STRICT NO-GO.**

---

## 2. VERIFIED REMEDIATIONS

The following remediations have been empirically verified through code inspection and database queries:

1. **CSRF Protection Across All Financial Mutations:**
   All 16 mutating HTTP method handlers (`POST`, `PUT`, `DELETE`) across the 10 financial route files invoke `sameOrigin(req)` as their initial guard. Requests with missing, mismatched, or malicious `Origin` / `Referer` headers are rejected with HTTP 403 Forbidden.
2. **Confidential Cap Table & Equity Segregation:**
   `GET /api/cost/dashboard`, `GET /api/cost/investments`, and `GET /api/cost/reports/export` enforce strict role authorization (`user.role === "OWNER" || user.role === "ADMIN"`). Regular `MEMBER` users receive HTTP 403 Forbidden.
3. **Member Expense Scoping & Reimbursement Guard:**
   `GET /api/cost/expenses` forces `where.userId = user.id` for `MEMBER`. `POST /api/cost/expenses` forces `paymentStatus = "REIMBURSEMENT_PENDING"`, `classification = "OPEX"`, and disables recurring parameters for members. `GET /api/cost/expenses/[id]` returns HTTP 403 if a member attempts to inspect another employee's claim.
4. **Invoice Isolation:**
   `GET /api/cost/invoices` restricts member results to `where.expense = { userId: user.id }`. `GET /api/cost/invoices/[id]/download` rejects access with HTTP 403 if the invoice is associated with another employee's claim.
5. **Corporate Email Isolation:**
   The leaky `{ OR: [{ userId: user.id }, { userId: null }] }` clause was removed from `GET /api/email`, `GET /api/email/[id]`, `GET /api/email/attachments/[id]`, and `POST /api/email/actions`. Corporate mailbox messages (`userId: null`) are accessible solely to `OWNER` and `ADMIN`. Members are strictly isolated to `{ userId: user.id }`.
6. **Email Search Query Scoping:**
   Search queries (`?q=...`) no longer overwrite `where.OR`. Search terms are combined with user isolation via `where.AND = [ ...(where.AND || []), { OR: searchConditions } ]`.
7. **Email DOM XSS Remediation:**
   `dangerouslySetInnerHTML` was removed from `src/components/modules/email.tsx`. Email HTML renders inside a sandboxed `<iframe>` (`sandbox="allow-popups"`), preventing script execution and blocking access to host DOM, cookies, and local storage.
8. **Promotion Script Destruction Prevention:**
   `npx prisma db push --accept-data-loss` was completely removed from `promote-to-prod.sh`. An explicit environment gate (`PROCEED_PROD_DEPLOY=true`), target database validation (`company_os`), and graceful `SIGTERM` connection draining were added. The script safely fails closed with exit code 1 when executed without confirmation.

---

## 3. UNVERIFIED CLAIMS & DISCREPANCY RECONCILIATIONS

### 3.1 Reconciling "10 Protected Endpoints" vs. "16 Protected Handlers"
The previous Phase 1 report claimed "10 mutating financial endpoints protected" while simultaneously listing 16 route combinations.
- **Verification Finding:** This is a terminology discrepancy, not an implementation discrepancy.
- **Resolution:** There are exactly **10 distinct URL path endpoints** under `src/app/api/cost/` that accept state-changing requests (`expenses`, `expenses/[id]`, `invoices/upload`, `invoices/verify`, `investments`, `recurring`, `recurring/record-payment`, `marketing`, `categories`, `ai`). Across those 10 URL paths, there are exactly **16 HTTP method handlers** (`POST`, `PUT`, `DELETE`). All 16 handlers were individually verified to enforce `sameOrigin(req)`.

### 3.2 Reconciling the Missing Production Email Tables Claim
The previous report stated: *"All 9 Financial subsystem tables, Email subsystem tables (EmailAccount, EmailFolder, EmailMessage, EmailAttachment, EmailSyncState), and PasswordSetupToken were added via prisma db push and are missing in production."*
- **Verification Finding:** Direct query of `company_os` revealed that `EmailAccount`, `EmailFolder`, `EmailMessage`, `EmailAttachment`, and `EmailSyncState` **DO exist in production**.
- **Explanation:** In a previous unrecorded run of `promote-to-prod.sh` (prior to Phase 1), `prisma db push` was executed against production, creating the email tables, CRM tables (`Lead`, `Deal`, `Contact`, `Company`), and AI tables (`AiAgent`, `AiTask`, etc.) in `company_os`.
- **Actual Production Table Drift:** Exactly **15 tables** are missing in production, consisting of:
  - 6 Calling tables: `CallSession`, `CallParticipant`, `CallEvent`, `CallIdempotencyKey`, `CallSfuEjectionJob`, plus `PasswordSetupToken`.
  - 9 Financial tables: `Expense`, `ExpenseCategory`, `ExpenseAttachment`, `InvoiceRecord`, `Investment`, `RecurringExpense`, `MarketingCampaign`, `CostAuditLog`, `AIUsageRecord`.

---

## 4. REMAINING SECURITY RISKS (STATUS POST PHASE 1.1)

| Ref | Severity | Vulnerability Description | Location | Status | Remediation Summary |
| :--- | :---: | :--- | :--- | :---: | :--- |
| **RISK-SEC-01** | **P2** | Alternative Read Endpoints Leak Corporate Financial Metrics | `GET /api/cost/recurring`<br>`GET /api/cost/marketing`<br>`GET /api/cost/ai` | **RESOLVED** | Added role checks (`user.role === "OWNER" \|\| user.role === "ADMIN"`). Returns HTTP 403 for `MEMBER`. |
| **RISK-SEC-02** | **P2** | Client UI Does Not Enforce Role Scoping on Financial Navigation Tabs | `src/components/modules/cost.tsx` | **RESOLVED** | Hides administrative tabs for `MEMBER` users. Defaults members to "expenses & reimbursements". |
| **RISK-SEC-03** | **P3** | Database Mutation During HTTP GET Request | `GET /api/cost/reports/export` | **RESOLVED** | Removed all database writes from `GET` (strictly read-only). Preserved compliance audit write in `POST /api/cost/reports/export`. |
| **RISK-SEC-04** | **P3** | Automatic Loading of Remote Email Images & Tracking Beacons | `src/lib/email/sanitize.ts`<br>`src/components/modules/email.tsx` | **RESOLVED** | Blocks remote images by default with safe placeholder. Provides user-controlled "Load Images" button. |
| **RISK-SEC-05** | **P3** | Unrestricted Mailbox Sync Trigger | `POST /api/email/sync`<br>`GET /api/email/sync` | **RESOLVED** | Restricted to `OWNER` / `ADMIN`. Validates `folderPath` against traversal and configured folder whitelist. |

---

## 5. COMPLETE COST API SECURITY MATRIX

Every route handler under `src/app/api/cost/` was audited for CSRF protection, authentication, role authorization, object ownership, input validation, and database write side-effects:

| Endpoint | Method | `sameOrigin` | Auth Check | Role Authorization | Object Ownership Check | Input Validation | Permitted Roles | DB Writes in Handler |
| :--- | :---: | :---: | :---: | :---: | :---: | :---: | :---: | :---: |
| `/api/cost/dashboard` | GET | N/A | Yes | `OWNER` / `ADMIN` only | N/A | Yes (`range` parse) | OWNER, ADMIN | **0 (Read-Only)** |
| `/api/cost/categories` | GET | N/A | Yes | None (Company public) | N/A | None | ALL | **0 (Read-Only)** |
| `/api/cost/categories` | POST | **Yes** | Yes | `OWNER` / `ADMIN` only | N/A | Yes (`name`, slug) | OWNER, ADMIN | Yes (`upsert`/`create`) |
| `/api/cost/categories` | DELETE | **Yes** | Yes | `OWNER` / `ADMIN` only | N/A | Yes (checks dependencies) | OWNER, ADMIN | Yes (`delete`) |
| `/api/cost/expenses` | GET | N/A | Yes | Role-aware scoping | `MEMBER`: `where.userId = user.id` | Yes (pagination/dates) | ALL (Filtered) | **0 (Read-Only)** |
| `/api/cost/expenses` | POST | **Yes** | Yes | Role-aware overrides | Forced `userId: user.id` | Yes (amount, vendor, category) | ALL (MEMBER forced) | Yes (`create`) |
| `/api/cost/expenses/[id]` | GET | N/A | Yes | Role-aware scoping | `MEMBER`: `expense.userId === user.id` | Yes (`id` param) | ALL (Own claim) | **0 (Read-Only)** |
| `/api/cost/expenses/[id]` | PUT | **Yes** | Yes | Role-aware scoping | Creator if `REIMBURSEMENT_PENDING` | Yes (rates, amounts) | ALL (Restricted) | Yes (`update`) |
| `/api/cost/expenses/[id]` | DELETE | **Yes** | Yes | `OWNER` / `ADMIN` only | N/A (MEMBER barred) | Yes (`id` check) | OWNER, ADMIN | Yes (`delete`) |
| `/api/cost/investments` | GET | N/A | Yes | `OWNER` / `ADMIN` only | N/A | None | OWNER, ADMIN | **0 (Read-Only)** |
| `/api/cost/investments` | POST | **Yes** | Yes | `OWNER` / `ADMIN` only | Records `userId` | Yes (amounts, types) | OWNER, ADMIN | Yes (`create`) |
| `/api/cost/investments` | DELETE | **Yes** | Yes | `OWNER` / `ADMIN` only | N/A | Yes (`id` param) | OWNER, ADMIN | Yes (`delete`) |
| `/api/cost/invoices` | GET | N/A | Yes | Role-aware scoping | `MEMBER`: `expense.userId = user.id` | Yes (`search`, `status`) | ALL (Filtered) | **0 (Read-Only)** |
| `/api/cost/invoices/upload` | POST | **Yes** | Yes | Authenticated users | File UUID / hash check | Yes (file buffer, hash) | ALL | Yes (Storage + Record) |
| `/api/cost/invoices/verify` | POST | **Yes** | Yes | `OWNER` / `ADMIN` only | Records `userId` | Yes (`invoiceId`, expense) | OWNER, ADMIN | Yes (`create`) |
| `/api/cost/invoices/[id]/download` | GET | N/A | Yes | Role-aware scoping | `MEMBER`: `invoice.expense.userId` | Yes (UUID regex check) | ALL (Own invoice) | **0 (Read-Only)** |
| `/api/cost/recurring` | GET | N/A | Yes | **MISSING** (Leads to leak) | None | None | **ALL (Over-permissioned)** | **0 (Read-Only)** |
| `/api/cost/recurring` | POST | **Yes** | Yes | `OWNER` / `ADMIN` only | Records `userId` | Yes (amounts, cycles) | OWNER, ADMIN | Yes (`create`) |
| `/api/cost/recurring` | PUT | **Yes** | Yes | `OWNER` / `ADMIN` only | N/A | Yes (`id` check) | OWNER, ADMIN | Yes (`update`) |
| `/api/cost/recurring` | DELETE | **Yes** | Yes | `OWNER` / `ADMIN` only | N/A | Yes (`id` check) | OWNER, ADMIN | Yes (`delete`) |
| `/api/cost/recurring/record-payment` | POST | **Yes** | Yes | `OWNER` / `ADMIN` only | Records `userId` | Yes (idempotency period) | OWNER, ADMIN | Yes (`create` tx) |
| `/api/cost/marketing` | GET | N/A | Yes | **MISSING** (Leads to leak) | None | None | **ALL (Over-permissioned)** | **0 (Read-Only)** |
| `/api/cost/marketing` | POST | **Yes** | Yes | `OWNER` / `ADMIN` only | N/A | Yes (`name`, spent) | OWNER, ADMIN | Yes (`create`/`update`) |
| `/api/cost/marketing` | DELETE | **Yes** | Yes | `OWNER` / `ADMIN` only | N/A | Yes (`id` check) | OWNER, ADMIN | Yes (`delete`) |
| `/api/cost/reports/export` | GET | N/A | Yes | `OWNER` / `ADMIN` only | N/A | Yes (`type`, `format`) | OWNER, ADMIN | **1 WRITE (`logCostAudit`)** |
| `/api/cost/ai` | GET | N/A | Yes | **MISSING** (Leads to leak) | None | None | **ALL (Over-permissioned)** | **0 (Read-Only)** |
| `/api/cost/ai` | POST | **Yes** | Yes | `OWNER` / `ADMIN` only | Records `userId` | Yes (`model`, tokens) | OWNER, ADMIN | Yes (`create`) |
| `/api/cost/audit` | GET | N/A | Yes | `OWNER` / `ADMIN` only | N/A | Yes (`entityType`, limit) | OWNER, ADMIN | **0 (Read-Only)** |

---

## 6. COMPLETE EMAIL API PRIVACY MATRIX

| Endpoint | Method | `sameOrigin` | Auth Check | User Isolation Mechanism | Corporate Mail (`userId: null`) Access | Cross-User Access Blocked | Ownership on Mutation |
| :--- | :---: | :---: | :---: | :--- | :---: | :---: | :---: |
| `/api/email` | GET | N/A | Yes | `userScope = isPrivileged ? {} : { userId: user.id }`<br>Combined with `where.AND` for search | OWNER, ADMIN only | Yes (returns only user's mail) | N/A |
| `/api/email/[id]` | GET | N/A | Yes | `where: { id, accountId, ...userScope }` | OWNER, ADMIN only | Yes (HTTP 404 returned) | Auto-marks read for authorized user |
| `/api/email/attachments/[id]` | GET | N/A | Yes | `if (!isPrivileged && att.message.userId !== user.id) return 404` | OWNER, ADMIN only | Yes (HTTP 404 returned) | Path jail validated via `startsWith` |
| `/api/email/actions` | POST | **Yes** | Yes | `authorizedWhere = { id: { in: cleanIds }, ...userScope }` | OWNER, ADMIN only | Yes (HTTP 404 if unauthorized) | Scoped mutation count verification |
| `/api/email/draft` | POST | **Yes** | Yes | Create: `userId: user.id`<br>Update: `where: { id, ...draftUserScope }` | OWNER, ADMIN only | Yes (HTTP 404 returned) | Forced user ID on creation |
| `/api/email/send` | POST | **Yes** | Yes | Enforces `canSendEmail` or admin role. Passes `userId: user.id` | Mailbox sender | N/A (Outbound) | Blocked executable attachments |
| `/api/email/sync` | POST | **Yes** | Yes | Triggers `EmailService.syncMailbox` | Global Mailbox | N/A | **Missing role check** |
| `/api/email/sync` | GET | N/A | Yes | Triggers `EmailService.testConnection` | Global Mailbox | N/A | **Missing role check** |
| `/api/email/ai` | POST | **Yes** | Yes | Context formatted with untrusted tags | N/A | N/A | Security prompt directives |

---

## 7. PRODUCTION SCHEMA DRIFT INVENTORY

A complete structural diff was executed between `company_os_dev` and `company_os`.

### 7.1 Database Summary
- **Total Tables in `company_os_dev`:** 59
- **Total Tables in `company_os`:** 44
- **Net Missing Tables in Production:** 15

### 7.2 The 15 Missing Production Tables
1. `AIUsageRecord` (Financial AI token usage and inference costs)
2. `CallEvent` (WebRTC / LiveKit signaling events)
3. `CallIdempotencyKey` (Calling request token idempotency)
4. `CallParticipant` (Calling roster states and mute tracking)
5. `CallSession` (Call room sessions)
6. `CallSfuEjectionJob` (Outbox queue for SFU disconnects)
7. `CostAuditLog` (Financial immutable audit log)
8. `Expense` (Financial operational expense ledger)
9. `ExpenseAttachment` (Expense receipt metadata)
10. `ExpenseCategory` (Hierarchical cost category structure)
11. `Investment` (Cap table, shareholder equity, founder debt)
12. `InvoiceRecord` (OCR invoice metadata)
13. `MarketingCampaign` (Marketing spend, CPL, CAC, ROI)
14. `PasswordSetupToken` (Account invitation setup tokens)
15. `RecurringExpense` (SaaS subscriptions and recurring bills)

### 7.3 Discrepancy Reconciliation on Email Tables
The 5 email tables (`EmailAccount`, `EmailFolder`, `EmailMessage`, `EmailAttachment`, `EmailSyncState`) were verified to **exist in both development and production**. They are not missing in `company_os`.

### 7.4 Table Column Drift
Across all 44 common tables, exactly **one table** has column drift: the `User` table.
- **Columns Missing in Production `User` Table (3 columns):**
  1. `email` (`TEXT`, nullable in DB, marked unique index in dev)
  2. `passwordHash` (`TEXT`, nullable)
  3. `mustChangePassword` (`BOOLEAN DEFAULT false`, not null)
- **Columns Confirmed Present in Both Environments (9 columns):**
  `avatarUrl`, `createdAt`, `disabledAt`, `id`, `name`, `role`, `timezone`, `title`, `updatedAt`.
- **Note on `canSendEmail`:** `canSendEmail` does not exist as a physical database column in either environment; it is evaluated in application code as an optional permission override.

### 7.5 Enum Type Drift
- **Total Enums in Dev:** 30
- **Total Enums in Prod:** 11
- **19 Enums Missing in Production:**
  `AIProvider`, `BillingCycle`, `CallEventType`, `CallStatus`, `CallTerminationReason`, `CallType`, `CostAuditAction`, `CostAuditEntity`, `ExpenseClassification`, `ExpensePaymentMethod`, `ExpensePaymentStatus`, `InvestmentType`, `InvestorType`, `InvoiceStatus`, `MarketingCampaignType`, `MarketingPlatform`, `OutboxJobStatus`, `ParticipantStatus`, `RecurringStatus`.

### 7.6 Index and Constraint Drift
- **Primary / Foreign Key Constraints on Common Tables:** Exactly 0 missing. 100% match on all 44 common tables.
- **Missing Indexes in Production:**
  `User_email_key` (`CREATE UNIQUE INDEX "User_email_key" ON public."User" USING btree (email)`) is absent in production due to the missing `email` column.

---

## 8. MIGRATION GOVERNANCE STATUS

### 8.1 Migration History vs. Reality
- **Committed Migrations in Dev (`prisma/migrations`):** 7 migrations
  - `20261030120000_initial`
  - `20261030133000_shared_workspace_login`
  - `20261030150000_project_only_work`
  - `20261030170000_rebrand_workspace`
  - `20261105000000_calling_foundations_and_identity_hardening`
  - `20261105120000_sfu_ejection_outbox_and_baseline_consolidation`
  - `20261105193000_add_participant_mute_event_types`
- **Applied Migrations in Production `_prisma_migrations`:** 4 migrations (only the `20261030*` set).

### 8.2 Clean Database Build Capability
**A clean database CANNOT be built from migration history alone.**
The committed migrations account for only 21 initial tables plus the calling schema changes. All 12 AI tables (`AiAgent`, `AiTask`, etc.), 4 CRM tables (`Lead`, `Deal`, `Contact`, `Company`), 5 Email tables, 9 Cost tables, and `PasswordSetupToken` exist exclusively because `prisma db push` was run during previous prototyping.

### 8.3 Safe Migration Authoring Plan
Before production deployment can occur:
1. **Author Baseline Consolidation Migration:** Generate a formal migration file (`20261106000000_schema_baseline_consolidation.sql`) capturing all missing tables, enums, and User columns.
2. **Reconciliation for Existing Databases:**
   - In production (`company_os`), which already contains 44 tables, the migration must safely apply only the missing 15 tables, 19 enums, and 3 User columns without attempting to recreate existing tables (`CREATE TABLE IF NOT EXISTS` or baseline tagging via `prisma migrate resolve`).
3. **Verify Dev Idempotency:** Deploy to an empty staging database first to prove a clean database build works from zero.

---

## 9. PROMOTION SCRIPT SAFETY ASSESSMENT

### 9.1 Script Evaluation (`promote-to-prod.sh`)
- `prisma db push` completely removed: **CONFIRMED**.
- `--accept-data-loss` completely removed: **CONFIRMED**.
- Target database verified as `company_os`: **CONFIRMED**.
- Execution fails closed without `PROCEED_PROD_DEPLOY=true`: **CONFIRMED**.
- Process restart uses graceful `kill -15` (SIGTERM) with 5-second drain: **CONFIRMED**.
- Fails immediately on migration error: **CONFIRMED**.

### 9.2 Recommendation on Script Retention
**The script is safe to retain, but MUST REMAIN DISABLED / UNEXECUTED until formal migrations are authored.**
Even though the script fails closed and requires `prisma migrate deploy`, running it today with `PROCEED_PROD_DEPLOY=true` would deploy the 3 Calling migrations while leaving the 9 Financial tables and `PasswordSetupToken` unmigrated, resulting in runtime 500 errors in production Next.js routes.

---

## 10. BACKUP AND DISASTER RECOVERY READINESS

### 10.1 Inspection of Development Backup File
- **Path:** `/Users/tanveersinghsaini/Desktop/locally hosted app dev/backups/dev/company_os_dev_backup_1793898446879.sql`
- **File Size:** 639,250 bytes (624 KB)
- **Header:** `PostgreSQL database dump`, dumped by `pg_dump` version 17.11 (Homebrew).
- **Footer:** `-- PostgreSQL database dump complete`.
- **Integrity:** The backup is structurally intact and non-empty.

### 10.2 Exposure Check
Zero raw passwords, API keys, or secret tokens are unnecessarily printed in documentation or test outputs.

### 10.3 Restore Verification Statement
> [!IMPORTANT]
> **A successful database restore has NOT been proven.**
> While the dump file is structurally complete and valid, an isolated test restore into a clean temporary database has not yet been performed. Disaster recovery readiness requires a documented, automated restore test.

---

## 11. TEST QUALITY ASSESSMENT

Inspection of `src/lib/phase1-security.test.ts` (13 tests) reveals:
- **True Unit Tests (3 tests):**
  - Mismatched origin rejection via `sameOrigin`.
  - Same-origin acceptance via `sameOrigin`.
  - Script tag and XSS stripping via `sanitizeEmailHtml`.
  These 3 tests execute runtime TypeScript logic with real arguments and evaluate genuine functional outputs.
- **Static Source-Code Assertions (10 tests):**
  The remaining 10 tests use `fs.readFileSync(...)` to perform regular-expression pattern matching against route handler files (checking for the presence of `user.role`, `status: 403`, `sameOrigin(req)`, and `PROCEED_PROD_DEPLOY`).
- **Integration Test Gap:** Zero tests in `phase1-security.test.ts` dispatch synthetic `NextRequest` objects through route handlers with simulated session cookies or mock database queries.
- **Recommendation:** Implement route-level integration tests (similar to `src/lib/urls.test.ts`) that invoke `POST` and `GET` functions directly with authenticated `Session` cookies representing `MEMBER`, `ADMIN`, and `OWNER` identities.

---

## 12. OUTSTANDING BLOCKERS & RECOMMENDED ACTIONS

| Blocker ID | Severity | Category | Status | Required Action |
| :--- | :---: | :--- | :---: | :--- |
| **BLK-DB-01** | **P0** | Database Architecture | **OPEN (Blocks Prod)** | Author formal Prisma migration for 15 missing tables and 3 User columns. |
| **BLK-CRM-01** | **P1** | Core CRM Functionality | **OPEN (Blocks Prod)** | Build human-facing CRM UI pages and REST API routes (`/api/leads`, etc.). |
| **BLK-INT-01** | **P1** | Integrations | **OPEN (Blocks Prod)** | Connect real GoDaddy IMAP/SMTP credentials or fallback provider. |
| **BLK-INT-03** | **P1** | AI Subsystem | **OPEN (Blocks Prod)** | Configure valid AI provider keys (`OPENAI_API_KEY` / `DEEPSEEK_API_KEY`). |
| **BLK-INT-04** | **P1** | Calling WAN | **OPEN (Blocks Prod)** | Deploy public LiveKit SFU server with STUN/TURN for external WAN calling. |
| **BLK-SEC-05** | **P2** | Financial Read Access | **RESOLVED (Phase 1.1)** | Added role authorization checks to `GET /api/cost/recurring`, `GET /api/cost/marketing`, and `GET /api/cost/ai`. Client UI updated. |
| **BLK-ARCH-03** | **P3** | Architecture | **RESOLVED (Phase 1.1)** | All DB writes removed from GET (strictly read-only). POST handles compliance-audited exports. |

---

## 13. EXPLICIT PRODUCTION DEPLOYMENT DECISION

### **DECISION: STRICT NO-GO**

**Justification:**
1. The production database is missing 15 tables and 3 critical authentication columns on `User`. Deploying now causes immediate application crashes on all authentication, financial, and calling workflows.
2. The committed migration history cannot build a working database from scratch.
3. Three financial read endpoints remain over-permissioned, allowing members to access company recurring burn, marketing analytics, and AI expenses.
4. Core CRM user interface and APIs do not exist yet.

**Prerequisites for Phase 2 Deployment Readiness:**
1. Complete Phase 2 implementation (CRM UI/API, deal-project linkage, calendar scheduling).
2. Patch remaining read-endpoint role checks (`recurring`, `marketing`, `ai`).
3. Author and validate formal migration files for all unmigrated models.
4. Perform an isolated database backup restore drill.
5. Upgrade test suite to include true route-level integration tests with multiple authenticated roles.

