# CYRAOPS — PRODUCTION BLOCKER & RISK REGISTER

**Audit Date:** November 5, 2026  
**Scope:** Consolidated Findings Across Development and Production Workspaces  
**Classification Standards:**
- **P0 (Critical):** Immediate deployment crash, security exploit, or production data loss. Hard deployment blocker.
- **P1 (High):** Major functional defect, broken core workflow, or inoperable business capability. Hard deployment blocker.
- **P2 (Medium):** Significant operational, architectural, or usability defect. Conditional deployment blocker.
- **P3 (Low):** Minor usability defect, performance overhead, or code polish item. Non-blocking.
- **INFO:** Informational architectural context or baseline observation.

---

## 1. EXECUTIVE SUMMARY OF REGISTER

| Severity | Total Discovered | Resolved (Phase 1) | Remaining | Production Blocking Status |
| :--- | :---: | :---: | :---: | :--- |
| **P0 — Critical** | 2 | 1 (BLK-DB-02) | 1 (BLK-DB-01) | **BLOCKS PROD DEPLOYMENT** (Missing Prod Migrations) |
| **P1 — High** | 7 | 1 (BLK-SEC-01) | 6 | **BLOCKS PROD DEPLOYMENT** (Core Workflow Failures) |
| **P2 — Medium** | 9 | 4 (SEC-02..04, ARCH-01) | 5 | **REQUIRES PHASE 2 REMEDIATION** |
| **P3 — Low** | 5 | 0 | 5 | Non-blocking (Polish / Performance) |
| **INFO** | 2 | 0 | 2 | Architecture Notes |
| **TOTAL** | **25** | **6 RESOLVED** | **19** | **DEPLOYMENT VERDICT: STRICT NO-GO UNTIL PHASE 2 & MIGRATION** |

---

## 2. DETAILED FINDINGS REGISTER

### GROUP A: DATABASE & DEPLOYMENT SAFETY

#### Finding BLK-DB-01: Catastrophic Production Database Schema Desynchronization
- **Severity:** **P0 — Critical**
- **Affected Module:** Database Architecture / All Application Subsystems
- **Affected Objects:** `company_os` database schema (15 missing tables, 3 missing `User` columns)
- **Evidence:** 
  Direct read-only schema comparison query confirmed `company_os` has only 44 tables versus 59 in `company_os_dev`. Tables missing in production: `PasswordSetupToken`, `CallSession`, `CallParticipant`, `CallEvent`, `CallIdempotencyKey`, `CallSfuEjectionJob`, `Expense`, `ExpenseCategory`, `ExpenseAttachment`, `InvoiceRecord`, `Investment`, `RecurringExpense`, `MarketingCampaign`, `CostAuditLog`, `AIUsageRecord`. Columns missing in `User`: `email`, `passwordHash`, `mustChangePassword`.
- **Reproduction / Verification:**
  Execute `SELECT table_name FROM information_schema.tables WHERE table_schema = 'public';` against both databases.
- **Business Impact:**
  Deploying the application to production today causes an immediate application-wide crash on every auth, calling, and financial operation with PostgreSQL runtime exceptions (`relation does not exist` / `column does not exist`).
- **Recommended Correction:**
  Author formal, reproducible Prisma migrations for all new models and columns. Apply migrations to `company_os` using `npx prisma migrate deploy`. Never use direct push.
- **Dependencies:** None.
- **Blocks Production Deployment:** **YES (P0 Blocker)**.

---

#### Finding BLK-DB-02: Destructive Schema Push with `--accept-data-loss` in Promotion Script
- **Severity:** **P0 — Critical**
- **Status:** **RESOLVED IN DEVELOPMENT (Phase 1)**
- **Affected Module:** DevOps / Deployment Automation
- **Affected File:** `promote-to-prod.sh` (Line 45)
- **Evidence:**
  `promote-to-prod.sh` line 45 reads: `npx prisma db push --accept-data-loss`.
- **Reproduction / Verification:**
  Inspect line 45 of `promote-to-prod.sh`.
- **Business Impact:**
  `prisma db push` bypasses formal migration tracking. If an engineer renames or drops a column or table in development, running the promotion script will silently and permanently truncate or drop production customer, project, and financial data without backup.
- **Recommended Correction:**
  Remove `npx prisma db push --accept-data-loss` completely. Replace with `npx prisma migrate deploy`. Add a mandatory pre-migration database snapshot check before any migration execution.
- **Resolution Summary (Phase 1):**
  - Permanently removed `prisma db push` and `--accept-data-loss` from `promote-to-prod.sh`.
  - Added fail-safe gate requiring explicit `PROCEED_PROD_DEPLOY=true` confirmation.
  - Added target database identity validation ensuring deployment strictly aborts if target is not `company_os`.
  - Replaced arbitrary schema pushes with `npx prisma migrate deploy`.
  - Replaced hard `kill -9` pipeline with graceful `kill -15` (SIGTERM) process drain.
  - Verified with automated tests in `src/lib/phase1-security.test.ts`.
- **Dependencies:** BLK-DB-01.
- **Blocks Production Deployment:** **RESOLVED (Script Hardened; Production Migration Pending)**.

---

### GROUP B: FUNCTIONAL COMPLETENESS & CRM

#### Finding BLK-CRM-01: Core CRM Module Non-Existent in User Interface and REST API
- **Severity:** **P1 — High**
- **Affected Module:** CRM & Sales Pipeline
- **Affected Objects:** Entire CRM subsystem (Leads, Deals, Contacts, Companies)
- **Evidence:**
  - Search of `src/app/**/page.tsx` revealed 0 CRM pages.
  - Search of `src/app/api/**` revealed 0 CRM REST API routes (`/api/leads`, `/api/deals`, etc.).
  - Navigation menu in `src/components/workspace-shell.tsx` contains 0 CRM links.
  - Queries against both `company_os_dev` and `company_os` revealed exactly 0 records in `Lead`, `Deal`, `Contact`, and `Company`.
- **Reproduction / Verification:**
  Inspect `src/components/workspace-shell.tsx` and run `find src/app/api -name "route.ts"`.
- **Business Impact:**
  Despite branding as "Cyraops CRM", human sales representatives, account managers, and executives cannot enter, view, edit, or qualify customer leads or pipeline deals. The CRM exists solely as dead database models accessible only via internal AI tools.
- **Recommended Correction:**
  Develop human-facing CRM UI pages in `src/app/(workspace)/crm/` and create complete RESTful endpoints for CRUD operations on leads, contacts, companies, and pipeline stages.
- **Dependencies:** None.
- **Blocks Production Deployment:** **YES (P1 Blocker)**.

---

#### Finding BLK-CRM-02: Absence of Relational Linkage Between Sales Deals and Projects
- **Severity:** **P2 — Medium**
- **Affected Module:** CRM & Projects Integration
- **Affected Objects:** `prisma/schema.prisma` (`model Deal`, `model Lead`, `model Project`)
- **Evidence:**
  Inspection of `prisma/schema.prisma` confirms:
  - `Project` has no `dealId`, `leadId`, `companyId`, or `contactId` field.
  - `Deal` has no `projectId` field.
  - `Lead` has no `projectId` field.
- **Reproduction / Verification:**
  Read models `Project`, `Deal`, and `Lead` in `prisma/schema.prisma`.
- **Business Impact:**
  When a sales deal is won (`CLOSED_WON`), it cannot be converted into an active client project. Project delivery teams have zero automated visibility into customer contracts, agreed budgets, scope, or client relationships.
- **Recommended Correction:**
  Add `dealId String? @unique` and `companyId String?` to `model Project` in Prisma schema, with a 1-to-1 or 1-to-many relation to `Deal` and `Company`.
- **Dependencies:** BLK-CRM-01.
- **Blocks Production Deployment:** **NO (High Priority Enhancement)**.

---

#### Finding BLK-CAL-01: Calendar Module Cannot Schedule Standalone Meetings or Events
- **Severity:** **P2 — Medium**
- **Affected Module:** Calendar & Scheduling
- **Affected File:** `src/app/api/calendar/route.ts`
- **Evidence:**
  `src/app/api/calendar/route.ts` contains only a `GET` handler. There is no `POST` handler and no `CalendarEvent` table in `prisma/schema.prisma`. It only queries `db.task` and `db.project`.
- **Reproduction / Verification:**
  Read `src/app/api/calendar/route.ts` and verify absence of event creation logic.
- **Business Impact:**
  Employees cannot use the calendar to schedule client calls, team meetings, product demos, or recurring reviews. It functions merely as a date filter for project deadlines.
- **Recommended Correction:**
  Create a `CalendarEvent` model supporting title, description, start/end time, recurrence, location/call link, and attendee relationships. Expose `POST/PATCH/DELETE` in `/api/calendar`.
- **Dependencies:** None.
- **Blocks Production Deployment:** **NO (Conditional Blocker)**.

---

#### Finding BLK-CHAT-01: Chat Subsystem Lacks File and Media Attachment Support
- **Severity:** **P2 — Medium**
- **Affected Module:** Chat & Collaboration
- **Affected Objects:** `model Message` in `prisma/schema.prisma`, `src/app/api/conversations/[id]/messages/route.ts`
- **Evidence:**
  `model Message` has only `id`, `clientId`, `body`, `conversationId`, `senderId`, `createdAt`. There is no foreign key or column for files, images, or document attachments.
- **Reproduction / Verification:**
  Inspect `model Message` in `prisma/schema.prisma` and payload validation in `messages/route.ts`.
- **Business Impact:**
  Employees collaborating in 1:1 or group channels cannot send screenshots, PDFs, design files, or code snippets through chat, forcing them to use external tools.
- **Recommended Correction:**
  Add a `MessageAttachment` model referencing `DriveFile` and update chat UI and API to accept multipart attachment payloads.
- **Dependencies:** None.
- **Blocks Production Deployment:** **NO (Operational Limitation)**.

---

### GROUP C: SECURITY & VULNERABILITIES

#### Finding BLK-SEC-01: Missing CSRF / Same-Origin Verification Across Cost Module Endpoints
- **Severity:** **P1 — High**
- **Status:** **RESOLVED IN DEVELOPMENT (Phase 1)**
- **Affected Module:** Cost & Financial Management / API Security
- **Affected Files:** All mutating route handlers under `src/app/api/cost/**`
  - `POST /api/cost/expenses`
  - `PUT/DELETE /api/cost/expenses/[id]`
  - `POST /api/cost/invoices/upload`
  - `POST /api/cost/invoices/verify`
  - `POST/DELETE /api/cost/investments`
  - `POST/PUT/DELETE /api/cost/recurring`
  - `POST /api/cost/recurring/record-payment`
  - `POST/DELETE /api/cost/marketing`
  - `POST/DELETE /api/cost/categories`
  - `POST /api/cost/ai`
- **Evidence:**
  Static code search confirmed `sameOrigin(req)` is now enforced across every single mutating route handler under `src/app/api/cost/`.
- **Resolution Summary (Phase 1):**
  - Added `if (!sameOrigin(req)) return NextResponse.json({ error: "Invalid request origin" }, { status: 403 });` across all 10 mutating financial endpoints (including multipart invoice uploads).
  - Cross-origin form submissions and unauthorized external requests are strictly rejected with HTTP 403 Forbidden.
  - Verified by unit tests in `src/lib/phase1-security.test.ts`.
- **Dependencies:** None.
- **Blocks Production Deployment:** **RESOLVED**.

---

#### Finding BLK-SEC-02: Confidential Cap Table & Financial Metrics Leaked to Regular Members
- **Severity:** **P2 — Medium**
- **Status:** **RESOLVED IN DEVELOPMENT (Phase 1)**
- **Affected Module:** Cost & Financial Management / Access Control
- **Affected File:** `src/app/api/cost/dashboard/route.ts`, `src/app/api/cost/reports/export/route.ts`, `src/app/api/cost/expenses/route.ts`
- **Evidence:**
  Role-based access control is now strictly enforced:
  - `GET /api/cost/dashboard`: Returns HTTP 403 Forbidden for `MEMBER` users. Only `OWNER` and `ADMIN` can access equity capital, debt liabilities, burn rate, and runway metrics.
  - `GET /api/cost/reports/export`: Strictly restricted to `OWNER` and `ADMIN`.
  - `GET /api/cost/expenses`: `MEMBER` queries are forced to `where.userId = user.id`. Members cannot view company-wide payroll or executive expenses.
  - `POST /api/cost/expenses`: When submitted by `MEMBER`, `paymentStatus` is forced to `REIMBURSEMENT_PENDING`, `classification` is forced to `OPEX`, and recurring creation is blocked.
  - `DELETE /api/cost/expenses/[id]`: Requires `OWNER` or `ADMIN`.
  - `GET /api/cost/invoices`: Scoped to `where.expense = { userId: user.id }` for `MEMBER`.
- **Resolution Summary (Phase 1):**
  - Ordinary `MEMBER` users cannot access cap table, executive expenses, financial dashboard, or confidential ledgers.
  - Verified by unit tests in `src/lib/phase1-security.test.ts`.
- **Dependencies:** None.
- **Blocks Production Deployment:** **RESOLVED**.

---

#### Finding BLK-SEC-03: Corporate Shared Mailbox Privacy Leak to All Workspace Members
- **Severity:** **P2 — Medium**
- **Status:** **RESOLVED IN DEVELOPMENT (Phase 1)**
- **Affected Module:** Email Subsystem / Access Control
- **Affected Files:** `src/app/api/email/route.ts`, `src/app/api/email/[id]/route.ts`, `src/app/api/email/attachments/[id]/route.ts`, `src/app/api/email/actions/route.ts`, `src/app/api/email/draft/route.ts`
- **Evidence:**
  Server-side user isolation enforced:
  - In `src/app/api/email/route.ts`, removed leaky `{ OR: [{ userId: user.id }, { userId: null }] }`. `MEMBER` scope is strictly `{ userId: user.id }`. Corporate mail (`userId: null`) is accessible exclusively to `OWNER` and `ADMIN`.
  - Fixed search query override bug: `searchQuery` is now combined via `where.AND = [ ...(where.AND || []), { OR: searchConditions } ]`, preventing search filters from bypassing user isolation.
  - In `src/app/api/email/attachments/[id]/route.ts`, verified message ownership: ordinary members cannot download attachments for messages where `userId` is null or belongs to another user.
  - In `src/app/api/email/actions/route.ts`, message mutations for members are scoped strictly to `userId: user.id`.
  - In `src/app/api/email/draft/route.ts`, draft creation records `userId: user.id` and updates require ownership.
- **Resolution Summary (Phase 1):**
  - Complete server-side isolation between ordinary employee mail and confidential company executive mail.
  - Verified by unit tests in `src/lib/phase1-security.test.ts`.
- **Dependencies:** None.
- **Blocks Production Deployment:** **RESOLVED**.

---

#### Finding BLK-SEC-04: Direct DOM Injection of Email HTML (`dangerouslySetInnerHTML`)
- **Severity:** **P2 — Medium**
- **Status:** **RESOLVED IN DEVELOPMENT (Phase 1)**
- **Affected Module:** Email Subsystem / Frontend Security
- **Affected File:** `src/components/modules/email.tsx` (Line 979)
- **Evidence:**
  `dangerouslySetInnerHTML` was removed from `src/components/modules/email.tsx`. Untrusted email HTML is now rendered inside a fully isolated, sandboxed `<iframe>`:
  `<iframe sandbox="allow-popups" srcDoc={...} className="w-full min-h-[450px] h-[550px] rounded-lg border border-[var(--border)] bg-white text-neutral-900" title="Email Content" />`
- **Resolution Summary (Phase 1):**
  - Browser sandbox strictly prevents script execution (`allow-scripts` omitted).
  - Cross-origin isolation prevents the iframe from reading host cookies, local storage, session tokens, or parent DOM.
  - Email links remain functional with `allow-popups`.
  - Verified by unit tests in `src/lib/phase1-security.test.ts`.
- **Dependencies:** None.
- **Blocks Production Deployment:** **RESOLVED**.

---

### GROUP D: EXTERNAL INTEGRATIONS & REALTIME

#### Finding BLK-INT-01: GoDaddy Mailbox Completely Inoperable (`isConfigured: false`)
- **Severity:** **P1 — High**
- **Affected Module:** Email Subsystem
- **Affected File:** `src/lib/email/config.ts`
- **Evidence:**
  Execution of `getMailboxConfig()` in both dev and prod environments confirms `isConfigured: false`. Neither `GODADDY_EMAIL_ADDRESS` nor `GODADDY_EMAIL_PASSWORD` exists in `.env`.
- **Reproduction / Verification:**
  Run `npx tsx -e "import { getMailboxConfig } from './src/lib/email/config'; console.log(getMailboxConfig().config.isConfigured);"` (prints `false`).
- **Business Impact:**
  The email module is completely non-functional. Users cannot send outbound emails, receive client inquiries, or synchronize mailboxes. Background sync worker throws errors every 300 seconds.
- **Recommended Correction:**
  Configure valid corporate GoDaddy IMAP/SMTP credentials in `.env` and verify connectivity using a secure read-only test handshake.
- **Dependencies:** None.
- **Blocks Production Deployment:** **YES (P1 Blocker)**.

---

#### Finding BLK-INT-02: Unidirectional Email Action Synchronization
- **Severity:** **P2 — Medium**
- **Affected Module:** Email Subsystem / IMAP Sync
- **Affected File:** `src/app/api/email/actions/route.ts` (Lines 85–118)
- **Evidence:**
  In `actions/route.ts`, actions `archive`, `trash`, `deletePermanent`, and `move` only update PostgreSQL database records (`isArchived: true`, `folderId: ...`). They never make remote IMAP calls (`imapClient.messageMove` or `imapClient.messageDelete`).
- **Reproduction / Verification:**
  Inspect lines 85–118 of `src/app/api/email/actions/route.ts`.
- **Business Impact:**
  Emails trashed or archived by employees in Cyraops remain untouched in the remote GoDaddy mailbox. On subsequent sync cycles or when logging into webmail directly, messages reappear or desynchronize.
- **Recommended Correction:**
  Implement remote IMAP folder moves and message expunging in `EmailService.syncFlagsToRemote` for archive, trash, and delete actions.
- **Dependencies:** BLK-INT-01.
- **Blocks Production Deployment:** **NO (Functional Defect)**.

---

#### Finding BLK-INT-03: AI Workspace and Autonomous Agents Inoperable (No API Keys)
- **Severity:** **P1 — High**
- **Affected Module:** AI Workspace & Automation
- **Affected File:** `src/lib/ai/provider-manager.ts`
- **Evidence:**
  `providerManager.listProviders()` reports `available: false` for both OpenAI and DeepSeek. Health checks return: `OPENAI_API_KEY is not configured in .env`.
- **Reproduction / Verification:**
  Run `npx tsx -e "import { providerManager } from './src/lib/ai/provider-manager'; console.log(providerManager.listProviders());"`.
- **Business Impact:**
  The AI assistant, agent dispatching, autonomous task runners, and intelligent CRM analysis fail on every real prompt, forcing reliance on deterministic dummy plans.
- **Recommended Correction:**
  Provision valid `OPENAI_API_KEY` and `DEEPSEEK_API_KEY` in production environment configuration.
- **Dependencies:** None.
- **Blocks Production Deployment:** **YES (P1 Blocker)**.

---

#### Finding BLK-INT-04: Calling Subsystem Confined to Local Loopback (No STUN/TURN/WAN)
- **Severity:** **P1 — High**
- **Affected Module:** Video & Audio Calling Subsystem
- **Affected File:** `config/livekit-dev.yaml`
- **Evidence:**
  `config/livekit-dev.yaml` lines 1–10:
  `bind_addresses: ["127.0.0.1"]`, `node_ip: "127.0.0.1"`, `use_external_ip: false`.
  Zero STUN or TURN servers are declared.
- **Reproduction / Verification:**
  Read `config/livekit-dev.yaml`.
- **Business Impact:**
  WebRTC media packets cannot traverse symmetric NAT, enterprise firewalls, or physical home routers. Calling works only when two browser tabs run on the exact same host machine via loopback. Remote employees cannot connect to audio or video calls.
- **Recommended Correction:**
  Deploy LiveKit with public IP binding, valid TLS certificates, and configure standard coturn or managed STUN/TURN relay infrastructure.
- **Dependencies:** BLK-DB-01 (Calling tables must exist in DB).
- **Blocks Production Deployment:** **YES (P1 Blocker)**.

---

#### Finding BLK-INT-05: Company Presence Channels are Non-Functional Placeholders
- **Severity:** **P3 — Low**
- **Affected Module:** Company Presence
- **Affected File:** `src/app/api/presence/route.ts`
- **Evidence:**
  Lines 34–75 return static objects with `connected: false` and `status: "Not connected"` for Search, Social, Marketplaces, and GitHub.
- **Reproduction / Verification:**
  Read `src/app/api/presence/route.ts`.
- **Business Impact:**
  Users are presented with an integration checklist that has no backend OAuth or API connectivity.
- **Recommended Correction:**
  Clearly label channel cards as "Manual Audit Checklist" or implement real OAuth/API connections.
- **Dependencies:** None.
- **Blocks Production Deployment:** **NO (Usability / Informational)**.

---

### GROUP E: INFRASTRUCTURE, OPERATIONS & UX

#### Finding BLK-OPS-01: Complete Absence of Automated Database and File Backups
- **Severity:** **P1 — High**
- **Affected Module:** Backup, Recovery & Operations
- **Affected Objects:** PostgreSQL databases (`company_os`, `company_os_dev`), `uploads/` directory
- **Evidence:**
  Inspection of `scripts/` and root repository revealed 0 backup scripts, 0 cron jobs, and 0 WAL archiving configurations.
- **Reproduction / Verification:**
  Inspect `scripts/` directory.
- **Business Impact:**
  A disk failure, corruption event, or accidental truncation will cause irrecoverable data loss. RPO and RTO are completely undefined.
- **Recommended Correction:**
  Implement automated daily `pg_dump` jobs with SHA-256 integrity verification, 30-day rotation, and encrypted off-device synchronization to AWS S3 or Cloudflare R2. Document and test recovery procedures.
- **Dependencies:** None.
- **Blocks Production Deployment:** **YES (P1 Blocker)**.

---

#### Finding BLK-OPS-02: Lack of Process Supervision and Auto-Restart Harness
- **Severity:** **P2 — Medium**
- **Affected Module:** Infrastructure & Hosting
- **Affected Objects:** Node.js server (`server.ts`), LiveKit SFU daemon
- **Evidence:**
  No `systemd` service files, PM2 ecosystem configurations, or Docker Compose manifests exist in the project repository.
- **Reproduction / Verification:**
  Check repository root and `config/` for service definitions.
- **Business Impact:**
  If the Node.js application unhandled exception crashes, or if the server host restarts, services stay down until an engineer manually launches terminal sessions.
- **Recommended Correction:**
  Provide production `systemd` service units or a PM2 `ecosystem.config.js` with auto-restart, log rotation, and memory limits.
- **Dependencies:** None.
- **Blocks Production Deployment:** **NO (Operational Requirement)**.

---

#### Finding BLK-OPS-03: Realtime Socket.IO Subsystem Cannot Scale Across Multiple Nodes
- **Severity:** **P2 — Medium**
- **Affected Module:** Realtime & Infrastructure
- **Affected File:** `server.ts` (Line 26), `src/lib/realtime.ts`
- **Evidence:**
  `const io = new SocketServer(httpServer, ...)` initializes Socket.IO with the default in-memory adapter. There is no Redis adapter (`@socket.io/redis-adapter`) configured.
- **Reproduction / Verification:**
  Inspect `server.ts` line 26 and search for Redis in `package.json`.
- **Business Impact:**
  The application is locked to a single Node.js process. Deploying behind a load balancer with multiple containers or cluster workers will cause dropped realtime notifications and broken chat room messaging.
- **Recommended Correction:**
  Install `@socket.io/redis-adapter` and configure Redis connection pooling when `NODE_ENV=production`.
- **Dependencies:** Redis instance.
- **Blocks Production Deployment:** **NO (Architecture Scaling Limitation)**.

---

#### Finding BLK-UX-01: Deadline Reminder Notification Links to 404 Route (`/tasks`)
- **Severity:** **P3 — Low**
- **Affected Module:** Tasks & Notifications / UX
- **Affected File:** `server.ts` (Line 74)
- **Evidence:**
  Line 74 creates notifications with: `href: "/tasks"`. Inspection of `src/app/**/page.tsx` proves no `/tasks` page exists.
- **Reproduction / Verification:**
  Read line 74 of `server.ts`.
- **Business Impact:**
  When employees receive a "Task due within 24 hours" notification and click on it, Next.js displays a 404 "Page Not Found" error.
- **Recommended Correction:**
  Update `server.ts` line 74: `href: `/projects?project=${task.projectId}&tab=tasks``.
- **Dependencies:** None.
- **Blocks Production Deployment:** **NO (Bug / Polish)**.

---

#### Finding BLK-UX-02: Single-Project GET Route (`GET /api/projects/[id]`) Not Promoted to Prod
- **Severity:** **P2 — Medium**
- **Affected Module:** Projects Management / Promotion Parity
- **Affected File:** `/Users/tanveersinghsaini/Desktop/locally hosted app/src/app/api/projects/[id]/route.ts`
- **Evidence:**
  `GET` handler exists in dev (`locally hosted app dev`), but grep for `export async function GET` in prod returns code 1 (missing). Prod contains only `PATCH` and `DELETE`.
- **Reproduction / Verification:**
  Grep `export async function GET` in prod project.
- **Business Impact:**
  In production, direct navigation, deep linking, or refreshing an individual project URL (`/projects?project=...`) cannot fetch project data independently, breaking user workflows.
- **Recommended Correction:**
  Synchronize `src/app/api/projects/[id]/route.ts` from dev to prod during the Phase 1 promotion.
- **Dependencies:** BLK-DB-01.
- **Blocks Production Deployment:** **NO (Conditional Blocker)**.

---

#### Finding BLK-UX-03: Excessive Background Route Prefetching in Workspace Shell
- **Severity:** **P3 — Low**
- **Affected Module:** Frontend Performance / UX
- **Affected File:** `src/components/workspace-shell.tsx` (Line 72)
- **Evidence:**
  Sidebar `<Link>` components omit `prefetch={false}`, triggering automatic Next.js prefetching of 9 complex routes (`/dashboard`, `/ai`, `/projects`, `/chat`, `/email`, `/calendar`, `/activity`, `/website`, `/cost`) simultaneously on every page load.
- **Reproduction / Verification:**
  Inspect line 72 of `src/components/workspace-shell.tsx`.
- **Business Impact:**
  Increases server load, triggers unneeded background queries, and slows initial mobile load times on cellular connections.
- **Recommended Correction:**
  Add `prefetch={false}` to heavy dashboard and media routes in `workspace-shell.tsx`.
- **Dependencies:** None.
- **Blocks Production Deployment:** **NO (Optimization)**.

---

#### Finding BLK-ARCH-01: Cost Dashboard Performs Database Upserts on HTTP GET Requests
- **Severity:** **P2 — Medium**
- **Status:** **RESOLVED IN DEVELOPMENT (Phase 1)**
- **Affected Module:** Cost Subsystem / Architecture
- **Affected File:** `src/app/api/cost/dashboard/route.ts` (Line 14), `src/app/api/cost/categories/route.ts` (Line 11), `server.ts`
- **Evidence:**
  `await ensureDefaultCategories()` was permanently removed from `GET /api/cost/dashboard/route.ts` and `GET /api/cost/categories/route.ts`. Both HTTP GET endpoints are now strictly read-only idempotently. Default category seeding was relocated to `server.ts` startup hook.
- **Resolution Summary (Phase 1):**
  - Removed `await ensureDefaultCategories()` from all GET route handlers.
  - Added idempotent category initialization on server startup in `server.ts`.
  - Zero database writes occur during read requests.
  - Verified by unit tests in `src/lib/phase1-security.test.ts`.
- **Dependencies:** None.
- **Blocks Production Deployment:** **RESOLVED**.

---

#### Finding BLK-ARCH-02: Absence of Project Linkage on Expense Model (`projectId`)
- **Severity:** **P2 — Medium**
- **Affected Module:** Cost & Projects Integration
- **Affected Objects:** `model Expense` in `prisma/schema.prisma`
- **Evidence:**
  `model Expense` contains no `projectId` field or relation to `model Project`.
- **Reproduction / Verification:**
  Inspect `model Expense` in `prisma/schema.prisma`.
- **Business Impact:**
  The business cannot track project-level expenditure, allocate cloud or contractor costs to client deliverables, or calculate gross project profitability margins.
- **Recommended Correction:**
  Add `projectId String?` and `project Project? @relation(fields: [projectId], references: [id])` to `model Expense`.
- **Dependencies:** BLK-DB-01.
- **Blocks Production Deployment:** **NO (Functional Enhancement)**.

---

#### Finding BLK-SEC-05: Over-Permissioned Financial Read Endpoints Leak Corporate Metrics
- **Severity:** **P2 — Medium**
- **Status:** **RESOLVED (Phase 1.1 Remediation)**
- **Affected Module:** Cost & Financial Management / Access Control
- **Affected Files:** `src/app/api/cost/recurring/route.ts`, `src/app/api/cost/marketing/route.ts`, `src/app/api/cost/ai/route.ts`, `src/components/modules/cost.tsx`
- **Resolution:**
  - Added strict role authorization (`user.role !== "OWNER" && user.role !== "ADMIN"`) returning HTTP 403 Forbidden on all three endpoints.
  - Updated `src/components/modules/cost.tsx` to fetch current user profile on load, hiding administrative tabs ("overview", "investments", "recurring", "marketing", "ai", "reports", "categories") from `MEMBER` users.
  - Automatically defaults `MEMBER` view to "expenses & reimbursements".
  - Verified with 8 route-level integration tests in `src/lib/phase1-1-integration.test.ts`.

---

#### Finding BLK-ARCH-03: Financial Export Endpoint Performs Database Write on HTTP GET
- **Severity:** **P3 — Low**
- **Status:** **RESOLVED (Phase 1.1 Remediation & Final Verification)**
- **Affected Module:** Cost Subsystem / Database Hygiene
- **Affected Files:** `src/app/api/cost/reports/export/route.ts`, `src/components/modules/cost.tsx`
- **Resolution:**
  - Completely removed `logCostAudit()` and all database write operations from `GET /api/cost/reports/export`, rendering HTTP GET strictly read-only and idempotent.
  - Retained `POST /api/cost/reports/export` with `sameOrigin` CSRF protection, admin authorization, and synchronized compliance audit logging via `logCostAudit()`.
  - Updated client UI in `src/components/modules/cost.tsx` to initiate exports via `POST` with blob streaming.
  - Documented that legacy `GET` downloads are not recorded in the compliance audit log and serve solely as an un-audited fallback for direct browser navigation.
  - Verified by route-level integration tests in `src/lib/phase1-1-integration.test.ts` proving 0 records written on `GET` and exactly 1 record written on `POST`.

---

#### Finding RISK-SEC-04: Automatic Loading of Remote Email Images & Tracking Beacons
- **Severity:** **P3 — Low**
- **Status:** **RESOLVED (Phase 1.1 Remediation)**
- **Affected Module:** Email Subsystem / Privacy & Security
- **Affected Files:** `src/lib/email/sanitize.ts`, `src/components/modules/email.tsx`
- **Resolution:**
  - In `sanitizeEmailHtml`, added `allowRemoteImages: boolean = false` option. When false, remote `http/https` image URLs are replaced with safe SVG placeholders and stored in `data-blocked-src`.
  - Added `hasRemoteImages()` helper to detect remote image links.
  - Preserved inline `cid:` attachments and base64 data URIs.
  - In `src/components/modules/email.tsx`, added a warning banner indicating remote images are blocked, with a user-controlled "Load Images" button.
  - Sandboxed `<iframe>` strictly maintains `sandbox="allow-popups"` with zero script execution privileges.
  - Verified with 4 unit/integration tests in `src/lib/phase1-1-integration.test.ts`.

---

#### Finding RISK-SEC-05: Unrestricted Mailbox Sync Trigger & Folder Path Traversal
- **Severity:** **P3 — Low**
- **Status:** **RESOLVED (Phase 1.1 Remediation)**
- **Affected Module:** Email Subsystem / Access Control & Input Validation
- **Affected Files:** `src/app/api/email/sync/route.ts`, `src/components/modules/email.tsx`
- **Resolution:**
  - Restricted both `POST /api/email/sync` and `GET /api/email/sync` strictly to `OWNER` and `ADMIN` (HTTP 403 for `MEMBER`).
  - Added strict path validation rejecting path traversal (`..`), slashes, null bytes, and illegal control characters (HTTP 400).
  - Validated `folderPath` against actual configured mailbox folders from `db.emailFolder` (HTTP 400 for unknown folders). Cleanly separated explicit folder input from default folder lookup, eliminating the unconfigured INBOX whitelist bypass exception.
  - Hid "Sync Mailbox" and settings triggers in `src/components/modules/email.tsx` for regular `MEMBER` users.
  - Verified with 9 route-level integration tests in `src/lib/phase1-1-integration.test.ts` covering missing folder path with/without configured INBOX, explicit configured folder, explicit unknown INBOX, explicit unknown non-INBOX folder, path traversal, and role blocks.

