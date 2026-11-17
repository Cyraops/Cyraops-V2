# CYRAOPS — PHASE 1.1 FINAL DISCREPANCY CORRECTION REPORT
## Complete Reconciliation of Test Metrics, Folder Whitelisting & Architecture Hardening

**Date:** November 6, 2026  
**Auditor / Engineer:** Antigravity AI Engineering Pair  
**Development Workspace:** `/Users/tanveersinghsaini/Desktop/locally hosted app dev` (Port 3001)  
**Development Database:** `company_os_dev` (Port 5432)  
**Production Target:** `/Users/tanveersinghsaini/Desktop/locally hosted app` (Port 3000 / `company_os` — Strictly Untouched & Read-Only)  
**Sign-off Status:** **PHASE 1.1 HARDENING SIGNED OFF (DEVELOPMENT COMPLETE)**  
**Production Promotion Status:** **STRICT NO-GO (Blocked on Phase 2 DB Schema Alignment)**  

---

## 1. EXECUTIVE SUMMARY & RESOLUTION STATUS

This discrepancy correction pass was executed to reconcile all outstanding ambiguities identified following the Phase 1.1 hardening review. All four discrepancy items have been fully resolved, implemented, and verified in the development environment:

1. **Test Count Reconciliation (Exact Root Cause Resolved):**
   - The discrepancy between the previous report's claimed 94 tests and its category table total (47 + 10 + 13 + 20 = 90) was precisely tracked to:
     - 3 outer test runners in `voice.test.ts` counted as tests by Node TAP reporter (13 total vs 10 leaf tests counted).
     - 1 unnumbered test in `urls.test.ts` (`Production rejects localhost/private addresses even over HTTPS`) omitted from manual tally (15 total vs 14 counted).
     - Difference: 90 + 3 + 1 = 94.
   - Following the addition of 3 new route integration tests for mailbox synchronization folder edge cases, the entire test suite now totals **97 tests across 19 suites in 11 test files**, with **100% passing (0 failures)**. Every test is classified into non-overlapping categories.
2. **Mailbox Synchronization INBOX Whitelist Exception Eliminated (`/api/email/sync`):**
   - The dangerous whitelist bypass `&& rawFolderPath.toUpperCase() !== "INBOX"` was permanently removed from `src/app/api/email/sync/route.ts`.
   - Defaulting to `INBOX` when `folderPath` is omitted is preserved as standard API behavior, but the mailbox's configured folders (`account.folders`) MUST contain a valid INBOX.
   - When `folderPath` is explicitly provided, it MUST exist in `account.folders` (matching `rawPath` or `name` case-insensitively). An unconfigured folder can no longer be synchronized merely because its string is `"INBOX"`.
   - All 7 route scenarios were implemented and verified with automated integration tests.
3. **Rigorous Verification of Read-Only Report Export (`GET /api/cost/reports/export`):**
   - Code inspection of `buildReportData` and the `GET` handler confirms that all queries are strictly read-only Prisma `findMany` queries against financial ledgers (`Expense`, `Investment`, `RecurringExpense`, `AIUsageRecord`, `MarketingCampaign`). No mutating Prisma calls (`create`, `update`, `delete`, `upsert`) or `logCostAudit` calls exist in the execution path.
   - Automated integration tests confirm `CostAuditLog` count is unchanged before and after `GET` requests, while `POST` continues to create exactly one compliance audit record.
4. **Transparent Documentation of Remote-Image Testing Scope:**
   - Clearly documented that the project test suite executes inside Node.js without a DOM runner (JSDOM, React Testing Library, or Playwright).
   - Component state binding (`allowedRemoteImagesForId === selectedMessageId`), synchronous consent revocation upon email switching/closing, default blocking via `data-blocked-src`, inline data/CID preservation, and `sandbox="allow-popups"` iframe protections were verified through source code inspection and Node sanitizer unit tests.
5. **Database Backup & Environment Integrity:**
   - Pre-change backup created: `backups/dev/company_os_dev_backup_discrepancy_1793905442.sql` (641,011 bytes, verified Nov 6 00:34:02 IST 2026).
   - Database name verified prior to backup: `SELECT current_database()` -> `company_os_dev`.
   - Production project `/Users/tanveersinghsaini/Desktop/locally hosted app` and database `company_os` remain 100% untouched.

---

## 2. RECONCILIATION OF TEST COUNT DISCREPANCY

### 2.1 The Root Cause of the 90 vs 94 Discrepancy
The previous report recorded `ℹ tests 94` from Node's built-in test runner, but its summary categorization table listed:
- Unit / Utility: 47
- Static Source Regex: 10
- Subsystem / DB Integration: 13
- Route-Level Integration: 20
- **Table Sum: 90 tests** (Discrepancy: 4 tests).

A line-by-line TAP output inspection identified the exact origin of the 4 unaccounted tests:
1. **`src/lib/voice.test.ts` (+3 tests):**
   - The file structured tests using `test("suite description", async (t) => { await t.test("subtest", ...); })`.
   - Node's TAP reporter outputs each subtest as `type: 'test'` AND outputs each parent `test()` block as `type: 'test'`.
   - There are 3 parent tests and 10 subtests, totaling **13 tests** counted by Node.
   - The previous table counted only the 10 subtests, omitting the 3 parent tests (+3).
2. **`src/lib/urls.test.ts` (+1 test):**
   - The test file contains 15 tests.
   - 12 tests used numeric prefixes (`1.` to `12.`), and 3 did not (`normalizes trailing slashes...`, `verifies isPrivateOrLocalHost helper...`, and `Production rejects localhost/private addresses even over HTTPS`).
   - The previous audit miscounted the unnumbered tests, recording 14 instead of **15 tests** (+1).
3. **Reconciliation Proof:** 90 + 3 + 1 = **94 tests**.

### 2.2 Current Test Suite Status (97 Tests across 11 Files)
Following this discrepancy pass, 3 new integration tests were added to `src/lib/phase1-1-integration.test.ts` to test mailbox folder edge cases (missing folder path with/without INBOX, and explicit unknown INBOX). The new grand total is **97 tests**:

```bash
$ node --import tsx --test src/lib/*.test.ts
ℹ tests 97
ℹ suites 19
ℹ pass 97
ℹ fail 0
ℹ cancelled 0
ℹ skipped 0
ℹ todo 0
ℹ duration_ms 2550.062875
```

### 2.3 Comprehensive, Non-Overlapping Test Classification
Every single test across all 11 test files is classified into exactly one mutually exclusive category below, distinguishing TAP-reported test records from independently executable leaf tests:

| Category | File(s) | TAP Count | Leaf Count | Description & Verification Target |
| :--- | :--- | :---: | :---: | :--- |
| **Category A: Live Route-Level HTTP Integration Tests** | `phase1-1-integration.test.ts` (21) | **21** | **21** | Synthesizes `NextRequest` objects with real session cookies to test route handlers against live PostgreSQL `company_os_dev` states (`OWNER`, `ADMIN`, `MEMBER`, unauthenticated). Tests financial read authorization, export idempotency vs audit mutation, and email sync folder whitelisting. |
| **Category B: Subsystem State Machine & Database Integration** | `ai-orchestration.test.ts` (6)<br>`browser.test.ts` (3)<br>`cost.test.ts` (6)<br>`storage.test.ts` (1)<br>`task-recovery.test.ts` (5) | **21** | **21** | Multi-component subsystem tests verifying agent execution state transitions, task recovery sweeps, browser session isolation, financial concurrency/idempotency, and opaque file storage. |
| **Category C: Security, Authorization Policy & Boundary Tests** | `phase1-security.test.ts` (13)<br>`permissions.test.ts` (4)<br>`browser.test.ts` (2) | **19** | **19** | Evaluates sameOrigin rejection/acceptance, role hierarchy, email normalization, password security, SSRF loopback/private IP detection, and `promote-to-prod.sh` execution gates. |
| **Category D: Unit, Utility & Algorithmic Rules** | `urls.test.ts` (15)<br>`voice.test.ts` (13 TAP / 10 Leaf)<br>`ai.test.ts` (4)<br>`phase1-1-integration.test.ts` (4) | **36** | **33** | In-memory unit tests evaluating canonical URL parsing and mock-based handler fail-closed tests (`urls.test.ts`), AI model configurations, DeepSeek voice reasoning constraints, multilingual adaptation (Hindi/English/Hinglish), and HTML email sanitization helpers. *(Includes 3 parent TAP wrappers in voice.test.ts).* |
| **TOTAL** | **11 Test Files / 19 Suites** | **97** | **94** | **100% PASS across 97 TAP records / 94 Leaf Tests** |

*(Note on Chronology & Git History: Because this workspace is not initialized as a Git repository, the intermediate historical code states cannot be independently reconstructed from Git commit history. The current physical source state represents the verified baseline).*

---

## 3. EMAIL SYNC INBOX WHITELIST RESOLUTION (`/api/email/sync`)

### 3.1 Defect Analysis
In the previous implementation of `src/app/api/email/sync/route.ts`:
```typescript
if (!matchedFolder && rawFolderPath.toUpperCase() !== "INBOX") {
  return NextResponse.json(
    { error: `Folder '${rawFolderPath}' does not exist in configured mailbox folders.` },
    { status: 400 }
  );
}
```
If an administrator or client sent `{ folderPath: "INBOX" }`, the second clause `rawFolderPath.toUpperCase() !== "INBOX"` evaluated to `false`. Consequently, if a mailbox had **no configured INBOX** in `db.emailFolder`, the request bypassed folder validation and attempted to synchronize an unconfigured folder.

### 3.2 Corrected Route Implementation
The folder path validation was rewritten to clearly distinguish between **omitted** (implicit default) and **explicit** folder paths:

```typescript
// src/app/api/email/sync/route.ts
const body = await req.json().catch(() => ({}));
const isExplicitFolder = typeof body.folderPath === "string";
const explicitFolderPath = isExplicitFolder ? body.folderPath.trim() : null;

if (isExplicitFolder) {
  if (!explicitFolderPath) {
    return NextResponse.json({ error: "Folder path cannot be empty." }, { status: 400 });
  }

  // Prevent path traversal, slash injection, null bytes, and control characters
  if (
    explicitFolderPath.includes("..") ||
    explicitFolderPath.includes("/") ||
    explicitFolderPath.includes("\\") ||
    /[\x00-\x1f\x7f]/.test(explicitFolderPath)
  ) {
    return NextResponse.json(
      { error: "Invalid folder path. Folder path contains illegal or path-traversal characters." },
      { status: 400 }
    );
  }
}

// Validate folderPath against actual configured mailbox folders
const account = await EmailService.getOrCreateAccount();

let targetFolderPath: string;

if (isExplicitFolder) {
  const matchedFolder = account.folders.find(
    (f) =>
      f.rawPath.toLowerCase() === explicitFolderPath!.toLowerCase() ||
      f.name.toLowerCase() === explicitFolderPath!.toLowerCase()
  );

  if (!matchedFolder) {
    return NextResponse.json(
      { error: `Folder '${explicitFolderPath}' does not exist in configured mailbox folders.` },
      { status: 400 }
    );
  }
  targetFolderPath = matchedFolder.rawPath;
} else {
  // Defaulting to INBOX when missing is permitted, but INBOX must exist in configured folders
  const defaultFolder = account.folders.find(
    (f) =>
      f.type === "INBOX" ||
      f.rawPath.toUpperCase() === "INBOX" ||
      f.name.toUpperCase() === "INBOX"
  );

  if (!defaultFolder) {
    return NextResponse.json(
      { error: "No INBOX folder configured in mailbox." },
      { status: 400 }
    );
  }
  targetFolderPath = defaultFolder.rawPath;
}

const result = await EmailService.syncMailbox({ folderPath: targetFolderPath });
return NextResponse.json(result);
```

### 3.3 Test Suite Coverage of All 7 Scenarios
The test suite in `src/lib/phase1-1-integration.test.ts` exercises all 7 required scenarios:
1. **Missing folder path with configured INBOX:** `POST /api/email/sync` with `{}` defaults to configured INBOX and returns HTTP 200.
2. **Missing folder path without configured INBOX:** When `INBOX` is absent from `account.folders`, omitting `folderPath` returns HTTP 400 (`"No INBOX folder configured in mailbox."`).
3. **Explicit configured folder:** Sending `{ folderPath: "INBOX" }` or `{ folderPath: "Sent" }` when present in `account.folders` succeeds with HTTP 200.
4. **Explicit unknown INBOX:** When `INBOX` is absent from `account.folders`, sending explicit `{ folderPath: "INBOX" }` is strictly rejected with HTTP 400 (`"Folder 'INBOX' does not exist in configured mailbox folders."`), proving the bypass is eliminated.
5. **Explicit unknown non-INBOX folder:** Sending `{ folderPath: "UNKNOWN_GHOST_FOLDER" }` returns HTTP 400 (`"Folder 'UNKNOWN_GHOST_FOLDER' does not exist in configured mailbox folders."`).
6. **Path traversal and illegal characters:** Paths containing `..`, `/`, `\`, null bytes `\x00`, and control characters `\x1f` return HTTP 400 (`"Invalid folder path. Folder path contains illegal or path-traversal characters."`).
7. **MEMBER and unauthenticated access:** Unauthenticated requests return HTTP 401; `MEMBER` requests return HTTP 403 (`"Permission denied. Mailbox synchronization is restricted to administrators."`).

---

## 4. GET REPORT EXPORT ZERO-WRITE VERIFICATION (`/api/cost/reports/export`)

### 4.1 Source Code Verification
A comprehensive inspection of `src/app/api/cost/reports/export/route.ts` was conducted:
- The `buildReportData` function contains only `findMany` queries:
  - `db.expense.findMany(...)`
  - `db.investment.findMany(...)`
  - `db.recurringExpense.findMany(...)`
  - `db.aIUsageRecord.findMany(...)`
  - `db.marketingCampaign.findMany(...)`
- Neither `buildReportData` nor `GET` invokes `create`, `update`, `delete`, `upsert`, or `logCostAudit`.
- `userFromRequest(req)` performs a read-only session query via `db.session.findUnique`.
- Therefore, source inspection confirms that `GET /api/cost/reports/export` performs **zero database writes** (direct or indirect).

### 4.2 Automated Integration Test Verification
In `src/lib/phase1-1-integration.test.ts`:
- Automated test records `initialLogsCount` from `db.costAuditLog.count()`.
- Issues `GET /api/cost/reports/export?type=expenses&format=csv`.
- Confirms HTTP 200 response with CSV attachment header.
- Re-queries `db.costAuditLog.count()` and asserts `afterLogsCount === initialLogsCount`.
- In contrast, issuing `POST /api/cost/reports/export` creates exactly one `CostAuditLog` entry with action `EXPORT` and method `POST`.
- `POST` remains the primary, compliance-audited endpoint; `GET` remains strictly read-only for browser download compatibility.

---

## 5. REMOTE EMAIL IMAGE TESTING & PRIVACY SCOPE

### 5.1 Component State Lifecycle
In `src/components/modules/email.tsx`:
1. **Message-Bound State:**
   ```typescript
   const [allowedRemoteImagesForId, setAllowedRemoteImagesForId] = useState<string | null>(null);
   const showRemoteImages = Boolean(selectedMessageId && allowedRemoteImagesForId === selectedMessageId);
   ```
2. **Synchronous Reset on Selection:**
   When an email is clicked (`loadEmailDetail(id)`), `setSelectedMessageId(id)` and `setAllowedRemoteImagesForId(null)` are executed simultaneously. `showRemoteImages` evaluates immediately to `false`.
3. **Synchronous Reset on Folder Switching or Closing:**
   When navigating folders or closing the view, `setSelectedMessageId(null)` is called. `showRemoteImages` evaluates immediately to `false`.
4. **Explicit Consent Activation:**
   Only clicking "Load Images" triggers `setAllowedRemoteImagesForId(emailDetail.id)`, activating remote images exclusively for that specific message.
5. **Iframe Isolation:**
   The email body is rendered inside `<iframe sandbox="allow-popups" ... />`. Without `allow-scripts` or `allow-same-origin`, scripts and host storage cannot execute.

### 5.2 Test Environment Limitation
- **Automated Tests:** 4 unit tests in `phase1-1-integration.test.ts` verify that `sanitizeEmailHtml` blocks remote `src` attributes, stores blocked URLs in `data-blocked-src`, preserves inline `data:` URIs, and preserves `cid:` attachments.
- **Limitation:** The repository test harness runs inside Node.js without a DOM emulator (JSDOM) or browser runner (Playwright). There are **0 component/browser tests**. Interactive UI state transitions are validated through source inspection and manual runtime verification.

---

## 6. BACKUP & ENVIRONMENT EVIDENCE

### 6.1 Database Verification & Backup Details
- **Active Database Verified:** `company_os_dev` (via `SELECT current_database()`).
- **Backup Path:** `/Users/tanveersinghsaini/Desktop/locally hosted app dev/backups/dev/company_os_dev_backup_discrepancy_1793905442.sql`.
- **File Size:** `641,011 bytes`.
- **Creation Timestamp:** `November 6, 2026 00:34:02 IST`.
- **Integrity Check:** Dump file header verified (PostgreSQL 17.11 dump format).
- **Restore Verification Note:** No disposable test restore was executed in this pass; restore capability is therefore documented as unverified.

### 6.2 Production Boundary Verification
- Production project `/Users/tanveersinghsaini/Desktop/locally hosted app` remains completely untouched (all file modification timestamps remain Oct 30 - Nov 1, 2026).
- Production database `company_os` remains completely untouched (zero write operations or schema modifications).

---

## 7. FINAL VALIDATION & VERDICT

### 7.1 Compilation & Build Metrics
- **Test Suite:** `npm test` -> **97 tests across 19 suites passed (0 failures)**.
- **Type Check:** `npx tsc --noEmit` -> **0 errors**.
- **Production Build:** `npm run build` -> **All 76 pages/routes built successfully in 5.1s**.

### 7.2 Verdict
- **PHASE 1.1 DEVELOPMENT HARDENING:** **PASSED & COMPLETE**.
- **PRODUCTION DEPLOYMENT:** **STRICT NO-GO**. (Production database `company_os` is missing 15 tables and 3 User authentication columns; formal non-destructive schema migration is required in Phase 2).

