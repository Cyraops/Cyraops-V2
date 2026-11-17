# CYRAOPS — PHASE 2 FINAL INDEPENDENT SIGN-OFF AUDIT
## Comprehensive Independent Security, Data Integrity & Architecture Audit of the CRM Foundation

**Date:** November 6, 2026  
**Auditor:** Antigravity Independent Quality & Security Auditor  
**Audit Target:** Cyraops CRM Foundation (Phase 2 Delivery)  
**Development Workspace:** `/Users/tanveersinghsaini/Desktop/locally hosted app dev` (Port 3001)  
**Development Database:** `company_os_dev` (Port 5432 — Verified `SELECT current_database()`)  
**Production Target:** `/Users/tanveersinghsaini/Desktop/locally hosted app` (Port 3000 / `company_os` — **Strictly Untouched & Read-Only**)  
**Audit Mode:** Strictly Read-Only (Zero Code, Database, or Migration Modifications)

---

## 1. EXECUTIVE VERDICT: CONDITIONAL PASS

The Cyraops CRM Foundation (Phase 2) is awarded a **CONDITIONAL PASS**.

### Summary Assessment
The engineering team successfully established a real, functional CRM subsystem natively embedded in Cyraops:
- The Prisma datamodel was cleanly extended with non-destructive, backward-compatible fields.
- 10 authenticated, validated REST endpoints were built under `/api/crm/` with CSRF protection and audit logging.
- A comprehensive multi-view UI was developed in `src/components/modules/crm.tsx` and integrated into the application shell.
- 20 live PostgreSQL route-integration tests were authored in `src/lib/crm.test.ts`, expanding the repository test suite to 117 passing tests (0 failures).
- Production code and the production database remained 100% isolated and untouched.

However, sign-off is **CONDITIONAL** because the audit revealed critical concurrency and data-integrity architectural gaps that must be remediated before production readiness:
1. **Lack of Database-Level Uniqueness Constraints:** Application-level duplicate checks for leads, contacts, and companies, as well as deal-to-project conversion idempotency, are not backed by database `UNIQUE` constraints, creating race conditions under concurrent requests.
2. **Deal Conversion Race Condition:** `Deal.convertedProjectId` and `Project.dealId` lack unique constraints, permitting simultaneous requests to create duplicate projects and orphan records.
3. **Mixed-Currency Aggregation:** The pipeline and statistics calculation loops blindly sum deal amounts across currencies (e.g. adding USD and INR directly) and label the total in INR.
4. **Missing UI Edit Modals:** In `src/components/modules/crm.tsx`, "Edit Details" and "Edit Deal" buttons set state flags, but their corresponding modal forms were omitted from the JSX.

---

## 2. FINDINGS SUMMARY BY SEVERITY

| Finding ID | Severity | Category | Description | Primary File Reference |
| :--- | :---: | :---: | :--- | :--- |
| **F-P2-01** | **HIGH** | Concurrency / Integrity | Deal-to-Project conversion lacks database uniqueness constraints on `Deal.convertedProjectId` and `Project.dealId`, enabling duplicate projects under concurrent execution. | `src/app/api/crm/deals/[id]/convert/route.ts:43` |
| **F-P2-02** | **HIGH** | Data Integrity | Application-level duplicate prevention for leads, contacts, and companies lacks database unique constraints, permitting duplicate entries under concurrent requests. | `src/app/api/crm/leads/route.ts:102`<br>`src/app/api/crm/contacts/route.ts:89`<br>`src/app/api/crm/companies/route.ts:86` |
| **F-P2-03** | **MEDIUM** | Financial Accuracy | Stats endpoint and Kanban view blindly sum different currencies (e.g. USD + INR) without conversion, returning miscalculated totals labeled as INR. | `src/app/api/crm/stats/route.ts:51-59`<br>`src/components/modules/crm.tsx:673` |
| **F-P2-04** | **MEDIUM** | UI / Usability | "Edit Details" and "Edit Deal" buttons in detail views trigger state toggles, but their corresponding modal forms were omitted from the component JSX. | `src/components/modules/crm.tsx:98, 400, 718` |
| **F-P2-05** | **MEDIUM** | Business Logic | Deal conversion API does not verify that a deal is in `CLOSED_WON` status prior to conversion, and permits converting `CLOSED_LOST` deals into active projects. | `src/app/api/crm/deals/[id]/convert/route.ts:40-48` |
| **F-P2-06** | **LOW** | Authorization Scope | While archive and owner reassignment are restricted, `MEMBER` users can modify commercial values, stages, and notes of deals owned by other team members. | `src/app/api/crm/deals/[id]/route.ts:60-95` |
| **F-P2-07** | **LOW** | Test Coverage | Automated tests dispatch synthetic `NextRequest` in-process; no concurrent race-condition stress tests or browser-level UI automation tests exist. | `src/lib/crm.test.ts` |

---

## 3. VERIFICATION OF DATABASE MIGRATION

A forensic examination of the development database `company_os_dev` and migration history was conducted.

### 3.1 Investigation of Migration Execution Sequence
During the Phase 2 implementation turn, the test log recorded `npx prisma migrate status` exiting with code 1, followed by a command to resolve an applied migration, and then deployment of the CRM migration. The audit investigated this sequence:

1. **Which exact migration was marked as applied?**  
   Migration `20261105193000_add_participant_mute_event_types`.
2. **Why was it marked as applied?**  
   The migration folder existed on disk in `prisma/migrations/20261105193000_add_participant_mute_event_types/migration.sql`, but had not been recorded in `_prisma_migrations`. Because Prisma detected an unapplied migration directory, `migrate status` exited with code 1.
3. **Was its SQL actually executed previously?**  
   Yes. The SQL in that migration added `PARTICIPANT_MUTED` and `PARTICIPANT_UNMUTED` to the `CallEventType` enum. Querying `pg_enum` in `company_os_dev` confirmed that both labels were already physically present in PostgreSQL. Running `prisma migrate dev` or creating another migration would have conflicted. Therefore, executing `prisma migrate resolve --applied` safely aligned Prisma's tracking table with the actual database state.
4. **Does the migration history accurately reflect the database schema?**  
   Yes. Querying `_prisma_migrations` confirms:
   - Row 7: `20261105193000_add_participant_mute_event_types` (applied on Nov 6, 02:01:04, `applied_steps_count = 0`).
   - Row 8: `20261106020500_crm_foundation` (applied on Nov 6, 02:01:27, `applied_steps_count = 1`).
5. **Is the CRM migration recorded as successfully applied?**  
   Yes. It was applied with `applied_steps_count = 1` and `rolled_back_at = NULL`.
6. **Are there any unresolved migrations or schema drift?**  
   No. `npx prisma migrate status` reports:
   ```
   8 migrations found in prisma/migrations
   Database schema is up to date!
   ```
7. **Does the migration SQL match the actual CRM schema?**  
   Yes. All column additions (`Company.archivedAt`, `Contact.archivedAt`, `Deal.archivedAt`, `Deal.currency`, `Deal.convertedProjectId`, `Lead.archivedAt`, `Lead.companyId`, `Project.dealId`) match the Prisma datamodel and physical PostgreSQL columns.
8. **Are all foreign keys and indexes present?**  
   Yes. Querying `pg_indexes` and `pg_constraint` confirmed:
   - Indexes: `Company_archivedAt_idx`, `Contact_archivedAt_idx`, `Deal_archivedAt_idx`, `Deal_convertedProjectId_idx`, `Lead_companyId_idx`, `Lead_archivedAt_idx`, `Project_dealId_idx`.
   - Foreign Keys: `Project_dealId_fkey` -> `Deal(id)`, `Lead_companyId_fkey` -> `Company(id)`, `Deal_convertedProjectId_fkey` -> `Project(id)`.
9. **Are there any unexpected changes or data loss risks?**  
   None. All columns added were nullable or had defaults (`currency` defaults to `'INR'`). No existing columns or tables were altered or dropped.

---

## 4. CRM DATA INTEGRITY AUDIT

### 4.1 Foreign Key Relationships & Cascades
- `Contact.companyId` -> `Company.id` (`ON DELETE SET NULL`) — Verified.
- `Deal.companyId` -> `Company.id` (`ON DELETE SET NULL`) — Verified.
- `Deal.contactId` -> `Contact.id` (`ON DELETE SET NULL`) — Verified.
- `Lead.companyId` -> `Company.id` (`ON DELETE SET NULL`) — Verified.
- `Lead.contactId` -> `Contact.id` (`ON DELETE SET NULL`) — Verified.
- `Lead.assignedToId` -> `User.id` (`ON DELETE SET NULL`) — Verified.
- `Deal.ownerId` -> `User.id` (`ON DELETE SET NULL`) — Verified.
- `Deal.convertedProjectId` -> `Project.id` (`ON DELETE SET NULL`) — Verified.
- `Project.dealId` -> `Deal.id` (`ON DELETE SET NULL`) — Verified.

### 4.2 Duplicate Prevention & Concurrency Gap (Finding F-P2-02)
- **Application Validation:**
  - `src/app/api/crm/leads/route.ts:102-124`: Queries `db.lead.findFirst(...)` for matching email or phone.
  - `src/app/api/crm/contacts/route.ts:89-112`: Queries `db.contact.findFirst(...)` for matching email or phone.
  - `src/app/api/crm/companies/route.ts:86-105`: Queries `db.company.findFirst(...)` for matching name or domain.
- **Database Reality:**
  - Querying `pg_constraint` where `contype = 'u'` across `Company`, `Contact`, `Lead`, `Deal`, and `Project` returned **0 rows**.
  - No unique index exists in PostgreSQL for `Contact.email`, `Lead.email`, `Company.name`, or `Company.domain`.
- **Vulnerability:** Under concurrent network requests (e.g., two submissions sent within milliseconds), both requests execute the `findFirst` query before either completes `create`. Both succeed, resulting in duplicate active records in the database.

### 4.3 Soft-Archiving Behavior
- List endpoints (`/api/crm/leads`, `/api/crm/contacts`, `/api/crm/companies`, `/api/crm/deals`) apply `where: { archivedAt: null }` by default unless `includeArchived=true` is requested.
- Detail endpoints (`/api/crm/leads/[id]`, etc.) allow retrieving archived records by direct ID, but exclude archived sub-records in related collections (e.g. `company.contacts` excludes `archivedAt != null`).
- Statistics endpoint (`/api/crm/stats`) strictly filters `where: { archivedAt: null }`.

---

## 5. DEAL-TO-PROJECT CONVERSION AUDIT

Inspection of [`src/app/api/crm/deals/[id]/convert/route.ts`](file:///Users/tanveersinghsaini/Desktop/locally%20hosted%20app%20dev/src/app/api/crm/deals/[id]/convert/route.ts) revealed two critical findings:

### 5.1 Concurrency & Uniqueness Flaw (Finding F-P2-01)
- **Mechanism:**
  - In `convert/route.ts`, the idempotency check is performed at line 43:
    ```typescript
    if (deal.convertedProjectId && deal.convertedProject) {
      return jsonError(`This deal has already been converted...`, 400);
    }
    ```
    This check occurs **outside** the database transaction.
  - Inside `db.$transaction` (lines 94-145), the code creates a `Project` with `dealId: deal.id` and updates the `Deal` with `convertedProjectId: newProject.id`.
  - In PostgreSQL, neither `Deal.convertedProjectId` nor `Project.dealId` has a `UNIQUE` constraint or unique index.
- **Race Condition:**
  If two authorized users (or a double-click event) submit concurrent conversion requests:
  1. Both requests read `deal.convertedProjectId == null`.
  2. Both enter transactions.
  3. Two separate `Project` records are created in PostgreSQL, both pointing to `dealId`.
  4. The deal's `convertedProjectId` is updated twice, leaving the first created project orphaned and untracked.

### 5.2 Stage Invariant Violation (Finding F-P2-05)
- The conversion route handler does not assert that `deal.stage === "CLOSED_WON"`.
- It converts deals in `DISCOVERY`, `PROPOSAL`, `NEGOTIATION`, and even `CLOSED_LOST`.
- At line 118, it unconditionally overrides the deal's stage to `CLOSED_WON` and probability to `100`.
- While the UI shows the conversion button in the won context, an API caller can convert any abandoned or lost deal into an active project.

---

## 6. CURRENCY & FINANCIAL CALCULATIONS AUDIT

Inspection of [`src/app/api/crm/stats/route.ts`](file:///Users/tanveersinghsaini/Desktop/locally%20hosted%20app%20dev/src/app/api/crm/stats/route.ts) and [`src/components/modules/crm.tsx`](file:///Users/tanveersinghsaini/Desktop/locally%20hosted%20app%20dev/src/components/modules/crm.tsx) revealed Finding **F-P2-03**:

### 6.1 Multi-Currency Acceptance
- `src/app/api/crm/deals/route.ts:22`:
  ```typescript
  currency: z.string().trim().min(3).max(3).optional().default("INR")
  ```
  The API permits deals to be created in `USD`, `EUR`, `GBP`, or any 3-letter currency code.

### 6.2 Blind Currency Summation Bug
- In `stats/route.ts:51-59`:
  ```typescript
  let pipelineValueINR = 0;
  for (const d of openDealsList) {
    pipelineValueINR += d.value;
  }
  let wonValueINR = 0;
  for (const d of wonDealsList) {
    wonValueINR += d.value;
  }
  ```
- The code queries `select: { value: true, currency: true }`, but completely ignores `d.currency` during accumulation.
- If Deal A is \$10,000 USD and Deal B is ₹10,000 INR, `pipelineValueINR` evaluates to `20,000`, and the endpoint responds with `{ currency: "INR", pipelineValue: 20000 }`.
- In `crm.tsx:673`, the Kanban column header performs the same blind summation (`stageDeals.reduce((sum, d) => sum + d.value, 0)`) and renders it with a literal `₹` prefix.

---

## 7. SECURITY & AUTHORIZATION AUDIT

| Endpoint | Method | Unauthenticated (401) | CSRF sameOrigin (403) | MEMBER Permission Bounds | Input Validation |
| :--- | :---: | :---: | :---: | :--- | :---: |
| `/api/crm/stats` | GET | Enforced (`userFromRequest`) | N/A (GET) | Can view stats | N/A |
| `/api/crm/leads` | GET | Enforced (`userFromRequest`) | N/A (GET) | Can view leads | Clean pagination/filters |
| `/api/crm/leads` | POST | Enforced (`userFromRequest`) | Enforced (`sameOrigin`) | Can create; can only assign to self | Zod `createLeadSchema` |
| `/api/crm/leads/[id]` | GET | Enforced (`userFromRequest`) | N/A (GET) | Can view details | Clean ID lookup |
| `/api/crm/leads/[id]` | PATCH | Enforced (`userFromRequest`) | Enforced (`sameOrigin`) | Forbidden to archive (403); forbidden to reassign others (403). **Can edit general fields (F-P2-06).** | Zod `updateLeadSchema` |
| `/api/crm/leads/[id]` | DELETE | Enforced (`userFromRequest`) | Enforced (`sameOrigin`) | Forbidden (403) | Clean soft-archive |
| `/api/crm/contacts` | GET | Enforced (`userFromRequest`) | N/A (GET) | Can view directory | Clean pagination |
| `/api/crm/contacts` | POST | Enforced (`userFromRequest`) | Enforced (`sameOrigin`) | Can create contacts | Zod `createContactSchema` |
| `/api/crm/contacts/[id]` | PATCH | Enforced (`userFromRequest`) | Enforced (`sameOrigin`) | Forbidden to archive (403) | Zod `updateContactSchema` |
| `/api/crm/contacts/[id]` | DELETE | Enforced (`userFromRequest`) | Enforced (`sameOrigin`) | Forbidden (403) | Clean soft-archive |
| `/api/crm/companies` | GET | Enforced (`userFromRequest`) | N/A (GET) | Can view directory | Clean pagination |
| `/api/crm/companies` | POST | Enforced (`userFromRequest`) | Enforced (`sameOrigin`) | Can create companies | Zod `createCompanySchema` |
| `/api/crm/companies/[id]` | PATCH | Enforced (`userFromRequest`) | Enforced (`sameOrigin`) | Forbidden to archive (403) | Zod `updateCompanySchema` |
| `/api/crm/companies/[id]` | DELETE | Enforced (`userFromRequest`) | Enforced (`sameOrigin`) | Forbidden (403) | Clean soft-archive |
| `/api/crm/deals` | GET | Enforced (`userFromRequest`) | N/A (GET) | Can view deals/pipeline | Clean pagination/filters |
| `/api/crm/deals` | POST | Enforced (`userFromRequest`) | Enforced (`sameOrigin`) | Can create; can only assign to self | Zod `createDealSchema` |
| `/api/crm/deals/[id]` | PATCH | Enforced (`userFromRequest`) | Enforced (`sameOrigin`) | Forbidden to archive (403); forbidden to reassign others (403). **Can edit value/stage (F-P2-06).** | Zod `updateDealSchema` |
| `/api/crm/deals/[id]` | DELETE | Enforced (`userFromRequest`) | Enforced (`sameOrigin`) | Forbidden (403) | Clean soft-archive |
| `/api/crm/deals/[id]/convert`| POST | Enforced (`userFromRequest`) | Enforced (`sameOrigin`) | **Strictly Forbidden (403)** | Zod `convertDealSchema` |

---

## 8. API BEHAVIOR & DESIGN AUDIT

1. **Zero GET Mutation Invariant:** All 9 `GET` endpoints execute exclusively `findUnique`, `findMany`, and `count`. Zero database writes occur during read requests.
2. **Pagination Bounds:** All list routes safely clamp `page` with `Math.max(1, parseInt(...) || 1)` and `limit` with `Math.min(100, Math.max(1, parseInt(...) || 20))`. Empty collections correctly yield `totalPages = 1` rather than `NaN` or `0`.
3. **Audit Trail Completeness:** All successful `POST`, `PATCH`, and `DELETE` operations invoke `logActivity` with distinct actions (`created`, `updated`, `archived`, `converted`) and descriptive summaries.
4. **Data Leakage:** Endpoints utilize `publicUserSelect` (`id`, `name`, `email`, `role`, `avatarUrl`, `title`), preventing exposure of password hashes, setup tokens, or session tokens.

---

## 9. USER INTERFACE AUDIT

Inspection of [`src/components/modules/crm.tsx`](file:///Users/tanveersinghsaini/Desktop/locally%20hosted%20app%20dev/src/components/modules/crm.tsx):

### 9.1 Missing Edit Modals (Finding F-P2-04)
- Lines 98, 100, 102, 104 define state variables: `editLeadOpen`, `editContactOpen`, `editCompanyOpen`, `editDealOpen`.
- Detail views render buttons targeting these states:
  - Line 400: `<Button variant="secondary" onClick={() => setEditLeadOpen(true)}>Edit Details</Button>`
  - Line 510: `<Button variant="secondary" onClick={() => setEditContactOpen(true)}>Edit Details</Button>`
  - Line 598: `<Button variant="secondary" onClick={() => setEditCompanyOpen(true)}>Edit Company</Button>`
  - Line 718: `<Button variant="secondary" onClick={() => setEditDealOpen(true)}>Edit Deal</Button>`
- **Defect:** No corresponding modal components (`<Modal open={editLeadOpen} ...>`, etc.) exist in the JSX. Clicking any of these edit buttons performs a silent state update without opening an interface for the user.

### 9.2 Truthful Metric Rendering
- Inspection confirmed that zero hardcoded metric values exist in `crm.tsx`. All stat cards bind directly to `stats.pipelineValue`, `stats.wonValue`, `stats.totalLeads`, etc., returned from `/api/crm/stats`.

### 9.3 Browser Automation Status
- No Playwright or Cypress browser automation tests were implemented for `crm.tsx`. UI verification is based on static JSX/TSX inspection and Next.js build compilation (`npm run build` completed with 0 errors).

---

## 10. TEST QUALITY AUDIT

Inspection of [`src/lib/crm.test.ts`](file:///Users/tanveersinghsaini/Desktop/locally%20hosted%20app%20dev/src/lib/crm.test.ts):

### 10.1 Test Classification & Reality
- **Classification:** **Live Route-Handler / Database Integration Tests** (20 tests).
- **Execution Mechanism:** The tests instantiate genuine `NextRequest` objects and directly call exported Next.js route handlers (`leadsPOST`, `convertPOST`, `statsGET`, etc.).
- **Live Database:** All operations interact with real tables in `company_os_dev` via Prisma `db`. Real records are inserted, read, updated, and deleted.
- **Cleanup:** An `after()` hook cleans up all created test records in reverse foreign-key dependency order.
- **Not Full Network E2E:** Tests do not dispatch HTTP packets over TCP sockets to port 3001; they invoke handlers in-process.

### 10.2 Missing Test Scenarios (Finding F-P2-07)
- No concurrent duplicate submission test (`Promise.all` calling `leadsPOST` simultaneously).
- No concurrent conversion test (`Promise.all` calling `convertPOST` simultaneously).
- No multi-currency test verifying that USD deals are separated or converted.
- No rollback verification test simulating transaction failure.

---

## 11. REGRESSION AUDIT OF EXISTING SUBSYSTEMS

| Subsystem | File Inspected | Regression Check | Status |
| :--- | :--- | :--- | :---: |
| **Dashboard** | `src/app/api/dashboard/route.ts` | Filtered `archivedAt: null` for active deals/leads; fixed hardcoded `$` to respect deal currency. | **PASSED (No Regression)** |
| **Global Search** | `src/app/api/search/route.ts` | Added CRM entity queries (leads, deals, contacts, companies) alongside existing projects, tasks, members, files. | **PASSED (No Regression)** |
| **Activity Feed** | `src/app/api/activity/route.ts` | Added optional `entity` and `entityId` query parameters; preserved existing project/user filtering. | **PASSED (No Regression)** |
| **Projects** | `src/app/api/projects/route.ts` | Additive foreign key `dealId` added to schema; zero existing logic modified. | **PASSED (No Regression)** |
| **Tasks** | `src/app/api/tasks/route.ts` | Untouched. | **PASSED (No Regression)** |
| **Team Management**| `src/app/api/team/route.ts` | Untouched. | **PASSED (No Regression)** |
| **Authentication** | `src/lib/auth.ts` | Untouched. | **PASSED (No Regression)** |
| **AI / Voice CRM** | `src/lib/ai/voice/crm-tools.ts` | Compatible with additive schema changes. All 3 voice tests pass 100%. | **PASSED (No Regression)** |
| **Repository Tests** | `src/lib/*.test.ts` | All 117 tests across 12 files pass with 0 failures (duration 1908ms). | **PASSED (No Regression)** |

---

## 12. PRODUCTION ISOLATION AUDIT

Forensic verification confirmed that production was strictly isolated and untouched:
- **Production Project:** `/Users/tanveersinghsaini/Desktop/locally hosted app`
  - Directory timestamp: `Nov 1 03:10` (unmodified).
  - Directory check: `ls -la ".../locally hosted app/src/app/api" | grep "crm"` returned **0 entries**.
- **Production Database:** `company_os`
  - Active connection verified via `SELECT current_database()` returning `company_os`.
  - Zero tables or columns were added to `company_os`.
- **Promotion Scripts:** `promote-to-prod.sh` was not executed.

---

## 13. EXACT REMEDIATION WORK REQUIRED FOR PHASE 2.1 (BEFORE PHASE 3)

Before proceeding to Phase 3 or deploying CRM to production, the following remediation work items must be executed:

1. **Database Uniqueness Constraints (Remediates F-P2-01 & F-P2-02):**
   - Create a Prisma migration adding unique constraints / partial indexes:
     - `CREATE UNIQUE INDEX "Deal_convertedProjectId_unique" ON "Deal"("convertedProjectId") WHERE "convertedProjectId" IS NOT NULL;`
     - `CREATE UNIQUE INDEX "Contact_email_unique_active" ON "Contact"(lower("email")) WHERE "archivedAt" IS NULL AND "email" IS NOT NULL;`
     - `CREATE UNIQUE INDEX "Lead_email_unique_active" ON "Lead"(lower("email")) WHERE "archivedAt" IS NULL AND "email" IS NOT NULL;`
     - `CREATE UNIQUE INDEX "Company_name_unique_active" ON "Company"(lower("name")) WHERE "archivedAt" IS NULL;`
     - `CREATE UNIQUE INDEX "Company_domain_unique_active" ON "Company"(lower("domain")) WHERE "archivedAt" IS NULL AND "domain" IS NOT NULL;`
2. **Deal Conversion Idempotency & Stage Guard (Remediates F-P2-01 & F-P2-05):**
   - In `convert/route.ts`, move the `convertedProjectId` check inside `db.$transaction` using row locking or handle Prisma `P2002` uniqueness errors.
   - Forbid converting deals in `CLOSED_LOST` status (`if (deal.stage === "CLOSED_LOST") return jsonError(...)`).
3. **Currency Normalization / Guard (Remediates F-P2-03):**
   - In `createDealSchema`, enforce `currency: z.literal("INR")` until multi-currency conversion is implemented, or update `stats/route.ts` to convert foreign currencies using the exchange rate service or group by currency.
4. **Implement Missing UI Edit Modals (Remediates F-P2-04):**
   - Author edit modal forms in `src/components/modules/crm.tsx` for leads, contacts, companies, and deals, wired to `editLeadOpen`, `editContactOpen`, `editCompanyOpen`, and `editDealOpen`.
5. **MEMBER Role Modification Boundary (Remediates F-P2-06):**
   - Restrict non-owners/non-admins from editing deals owned by other team members.
6. **Concurrent Stress Integration Tests (Remediates F-P2-07):**
   - Add tests to `src/lib/crm.test.ts` executing simultaneous `Promise.all` requests to prove uniqueness constraint enforcement and transaction atomicity under race conditions.

