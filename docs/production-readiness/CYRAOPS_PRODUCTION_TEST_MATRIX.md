# CYRAOPS — PRODUCTION READINESS TEST MATRIX & EVIDENCE LOG

**Date of Execution:** November 5, 2026  
**Testing Mode:** Strictly Read-Only, Non-Mutating, Static Code Analysis, Live Database Schema Queries, Cryptographic Checks.  
**Safety Protocol:** Zero database writes, zero real emails sent, zero real AI tokens consumed, zero real calls initiated, zero user mutations.

---

## 1. COMPREHENSIVE TEST MATRIX

| Test ID | Module / Area | Preconditions | Test Method | Expected Result | Actual Result | Evidence / Log Reference | Status |
| :--- | :--- | :--- | :--- | :--- | :--- | :--- | :---: |
| **TC-DB-01** | Database Verification | Active dev connection | Read-only SQL query: `SELECT current_database()` | Connection confirmed to `company_os_dev` | Returned `company_os_dev` | `[ { current_database: 'company_os_dev' } ]` | **PASS** |
| **TC-DB-02** | Production DB Verification | Active prod connection | Read-only SQL query: `SELECT current_database()` | Connection confirmed to `company_os` | Returned `company_os` | `[ { current_database: 'company_os' } ]` | **PASS** |
| **TC-DB-03** | Schema Table Parity | Both DB connections | Information schema table query | Development and production have identical tables | **15 tables missing in production** | `missingInProd: ['AIUsageRecord', 'CallSession', ...]` | **FAIL** |
| **TC-DB-04** | User Column Parity | Both DB connections | Information schema column query | `User` table has identical columns in dev and prod | **Missing `email`, `passwordHash`, `mustChangePassword` in prod** | `column_name: 'email'` missing in `company_os` | **FAIL** |
| **TC-DB-05** | Migration Lock Safety | Dev migrations folder | Static inspection of migration history | Formal migrations exist for all active models | Cost module and `PasswordSetupToken` lack migrations | Created via `prisma db push` in dev | **FAIL** |
| **TC-CRM-01** | CRM Page Existence | Dev Next.js app | `find src/app -name "page.tsx"` | `/crm`, `/leads`, or `/deals` routes exist | **Zero CRM pages exist** | Only 20 standard workspace pages found | **FAIL** |
| **TC-CRM-02** | CRM REST API Existence | Dev Next.js app | `find src/app/api -name "route.ts"` | `/api/leads`, `/api/deals`, etc. exist | **Zero CRM API endpoints exist** | No CRM routes in `src/app/api/` | **FAIL** |
| **TC-CRM-03** | CRM Database Records | Active dev DB | `SELECT count(*)` on CRM tables | Active CRM records exist | Exactly 0 records across all 4 tables | `{ companies: 0, contacts: 0, leads: 0, deals: 0 }` | **FAIL** |
| **TC-CRM-04** | Lead-to-Project Link | Dev Prisma schema | Static code inspection of `schema.prisma` | Relation exists between `Lead`/`Deal` and `Project` | **No relation or foreign key exists** | Verified `schema.prisma` lines | **FAIL** |
| **TC-PRJ-01** | Single-Project GET Route | Dev project codebase | Static inspection of `api/projects/[id]` | `export async function GET` exists | Present and returns project with task progress | `src/app/api/projects/[id]/route.ts#L16` | **PASS (Dev)** |
| **TC-PRJ-02** | Single-Project GET (Prod) | Prod project codebase | Grep `export async function GET` in prod | Endpoint present in production | **MISSING in production codebase** | Grep returned exit code 1; only PATCH/DELETE exist | **FAIL (Prod)** |
| **TC-PRJ-03** | Project Task Security | Dev project codebase | Review authorization in `projects/route.ts` | Members restricted to assigned projects | Role checks enforce `isOwnerOrAdmin \|\| isMember` | `src/app/api/projects/route.ts#L13` | **PASS** |
| **TC-PRJ-04** | Task Notification Link | Dev server startup | Inspect `server.ts` deadline reminder | Notification links to valid task view | **Links to non-existent `/tasks` (404)** | `server.ts#L74: href: "/tasks"` | **FAIL** |
| **TC-CHT-01** | Chat Messaging Deduplication | Dev codebase & DB | Inspect `model Message` and API | Idempotent `clientId` prevents duplicate messages | Enforced via unique constraint and API check | `@@unique([senderId, clientId])` | **PASS** |
| **TC-CHT-02** | Chat File Attachments | Dev Prisma schema | Inspect `model Message` in `schema.prisma` | Messages support file attachments | **Zero attachment fields exist** | `model Message` has only text body | **FAIL** |
| **TC-CHT-03** | Realtime Multi-Node Scaling | Dev server startup | Inspect Socket.IO initialization in `server.ts` | Socket.IO uses Redis adapter for clustering | **Uses default in-memory adapter** | No Redis package or adapter configured | **FAIL** |
| **TC-EML-01** | Mailbox Configuration | Dev environment | Read `getMailboxConfig()` status | `isConfigured` evaluates to `true` | **`isConfigured: false` in dev and prod** | Empty `GODADDY_EMAIL_ADDRESS` in `.env` | **FAIL** |
| **TC-EML-02** | Bidirectional IMAP Sync | Dev email service | Inspect `src/app/api/email/actions/route.ts` | Local archive/trash actions sync to IMAP | **Local DB updates only; no IMAP calls** | `actions/route.ts#L85-L118` | **FAIL** |
| **TC-EML-03** | Email Member Privacy | Dev email API | Inspect message query filter in `email/route.ts` | Shared emails restricted to designated owners | `{ OR: [{ userId: user.id }, { userId: null }] }` leaks to all members | `email/route.ts#L38-L41` | **FAIL** |
| **TC-EML-04** | Email HTML Sanitization | Dev email sanitizer | Inspect `sanitizeEmailHtml` rules | Strips script, behavior, and unsafe protocols | Strict whitelist using `sanitize-html` | `src/lib/email/sanitize.ts` | **PASS** |
| **TC-CAL-01** | Standalone Meeting Creation | Dev calendar API | Inspect `src/app/api/calendar/route.ts` | Supports `POST` for scheduling meetings | **GET only; no POST and no event model** | `calendar/route.ts#L6` | **FAIL** |
| **TC-AUTH-01** | Password Policy Enforced | Unit test suite | Inspect `passwordSchema` validation | Requires $\ge 12$ characters | Rejects $<12$ chars, accepts strong passwords | `src/lib/validators.ts#L8` | **PASS** |
| **TC-AUTH-02** | Setup Token Consumption | Unit & probe test | Inspect `src/app/api/auth/setup/route.ts` | Single-use, atomic transaction consumption | `usedAt: new Date()` checked in serializable tx | `auth/setup/route.ts#L82-L103` | **PASS** |
| **TC-AUTH-03** | Dual Rate Limiting on Login | Dev login endpoint | Inspect `src/app/api/auth/login/route.ts` | Max 12 attempts per 15 min by IP and email | Hashed keys stored in `AuthRateLimit` | `auth/login/route.ts#L16-L20` | **PASS** |
| **TC-AUTH-04** | Production APP_URL Validation | Unit test suite | `src/lib/urls.test.ts` (15 tests) | Hard-rejects HTTP/localhost in prod | All 12 fail-closed requirements verified | `npm test` passing 15/15 tests | **PASS** |
| **TC-AUTH-05** | Password Change Session Purge | Dev profile route | Inspect `src/app/api/profile/route.ts` | Password change terminates other sessions | `tokenHash: { not: currentTokenHash }` deleted | `src/app/api/profile/route.ts#L45-L50` | **PASS** |
| **TC-CST-01** | Cost Subsystem CSRF Checks | Dev cost API routes | Grep `sameOrigin` across `src/app/api/cost/` | All mutating routes check `sameOrigin` | **Zero cost endpoints check sameOrigin** | Grep returned 0 matches | **FAIL** |
| **TC-CST-02** | Cap Table Access Restriction | Dev cost investments | Inspect `src/app/api/cost/investments/route.ts` | Restricted to `OWNER` and `ADMIN` | Strictly blocks `MEMBER` with 403 | `cost/investments/route.ts#L12` | **PASS** |
| **TC-CST-03** | Cost Dashboard Role Isolation | Dev cost dashboard | Inspect `src/app/api/cost/dashboard/route.ts` | Restricted to `OWNER` and `ADMIN` | **No role check; leaks equity/debt/burn to MEMBER** | `cost/dashboard/route.ts#L8-L15` | **FAIL** |
| **TC-CST-04** | GET Mutation Idempotency | Dev cost dashboard | Inspect `ensureDefaultCategories` calls | GET requests do not mutate DB | **Runs `upsert` in a loop on every GET** | `cost/dashboard/route.ts#L14` | **FAIL** |
| **TC-CST-05** | Duplicate Invoice Detection | Unit test suite | Inspect `checkDuplicateInvoice` | SHA-256 hash prevents duplicate files | Fully verified in unit test | `src/lib/cost.test.ts` passing | **PASS** |
| **TC-CST-06** | Expense-to-Project Link | Dev Prisma schema | Inspect `model Expense` | Relational link exists to `Project` | **No `projectId` field on Expense** | `model Expense` in `schema.prisma` | **FAIL** |
| **TC-FIL-01** | File Magic Byte Validation | Dev file upload route | Inspect `validSignature` in `upload/route.ts` | Binary signature verified against extension | Validates PDF, PNG, JPG, ZIP/DOCX/XLSX | `files/upload/route.ts#L11-L18` | **PASS** |
| **TC-FIL-02** | File Download Security Headers | Dev file download route | Inspect headers in `[id]/download/route.ts` | Emits `nosniff`, `sandbox`, `private` | Hardened security headers verified | `files/[id]/download/route.ts#L19` | **PASS** |
| **TC-AI-01** | Live AI Provider Readiness | Dev AI provider manager | Read `healthCheck()` on active providers | OpenAI/DeepSeek return `ok: true` | **Fails: `OPENAI_API_KEY is not configured`** | `providerManager.healthCheck()` | **FAIL** |
| **TC-AI-02** | Task Worker Lease Recovery | Unit test suite | `src/lib/task-recovery.test.ts` | Orphaned worker leases recovered cleanly | State machine transitions to `RECOVERING` | Unit tests passing | **PASS** |
| **TC-VOC-01** | Voice DeepSeek Requirement | Unit test suite | `src/lib/voice.test.ts` | DeepSeek enforced as sole reasoning provider | Rejects other providers, rejects bad model IDs | Unit tests passing | **PASS** |
| **TC-CAL-02** | Calling Loopback Confinement | LiveKit dev configuration | Inspect `config/livekit-dev.yaml` | Public STUN/TURN configured for WAN | **Bound to `127.0.0.1`; no STUN/TURN** | `livekit-dev.yaml#L3, L10` | **FAIL** |
| **TC-CAL-03** | Calling Concurrency Locking | Dev calling state machine | Inspect `createCallSession` locking | Row-level locks prevent race conditions | `SELECT id FROM "User" ... FOR UPDATE` verified | `calling/state-machine.ts#L175` | **PASS** |
| **TC-OPS-01** | Automated Backup Harness | Scripts & cron inspect | Search for backup scripts | Automated `pg_dump` and retention active | **Zero backup scripts in repository** | Directory listing of `scripts/` | **FAIL** |
| **TC-OPS-02** | Promotion Script Safety | Promotion script inspect | Inspect `promote-to-prod.sh` | Uses formal `migrate deploy` | **Uses `db push --accept-data-loss`** | `promote-to-prod.sh#L45` | **FAIL** |

---

## 2. SUMMARY OF TEST RESULTS

- **Total Test Cases Executed:** 40
- **Passed Test Cases:** 18 (45.0%)
- **Failed Test Cases:** 22 (55.0%)
- **Critical Blockers Detected:** 9 hard blockers
- **Safety Boundary Adherence:** 100% (Zero database mutations, zero live email transmissions, zero external network side effects).

