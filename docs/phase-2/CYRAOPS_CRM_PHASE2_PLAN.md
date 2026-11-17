# CYRAOPS — PHASE 2: CRM FOUNDATION IMPLEMENTATION PLAN
## Stage One: Comprehensive Architecture Inspection & Execution Blueprint

**Date:** November 6, 2026  
**Auditor / Lead Engineer:** Antigravity AI Engineering Pair  
**Development Workspace:** `/Users/tanveersinghsaini/Desktop/locally hosted app dev` (Port 3001)  
**Development Database:** `company_os_dev` (Port 5432 — Verified `SELECT current_database()`)  
**Production Target:** `/Users/tanveersinghsaini/Desktop/locally hosted app` (Port 3000 / `company_os` — **Strictly Untouched & Read-Only**)  
**Pre-Implementation Baseline Backup:** `backups/company_os_dev_phase2_pre_baseline_1793910210.sql` (629 KB)

---

## 1. EXISTING FUNCTIONALITY & CODEBASE REUSE

Thorough inspection of the existing codebase revealed significant foundational assets that can be leveraged without redundant reimplementation:

### 1.1 Prisma Schema & Database Models
- **`Company`** (`prisma/schema.prisma:563`):
  Existing fields: `id`, `name`, `domain`, `industry`, `size`, `website`, `phone`, `address`, `notes`, `createdAt`, `updatedAt`.
  Relations: `contacts Contact[]`, `deals Deal[]`.
- **`Contact`** (`prisma/schema.prisma:581`):
  Existing fields: `id`, `firstName`, `lastName`, `email`, `phone`, `title`, `status` (`ContactStatus`: `LEAD`, `CUSTOMER`, `PARTNER`, `INACTIVE`), `companyId`, `notes`, `createdAt`, `updatedAt`.
  Relations: `company Company?`, `deals Deal[]`, `leads Lead[]`.
- **`Lead`** (`prisma/schema.prisma:601`):
  Existing fields: `id`, `title`, `contactId`, `companyName`, `email`, `phone`, `status` (`LeadStatus`: `NEW`, `CONTACTED`, `QUALIFIED`, `UNQUALIFIED`, `CONVERTED`), `score`, `source`, `estimatedValue`, `assignedToId`, `notes`, `createdAt`, `updatedAt`.
  Relations: `contact Contact?`, `assignedTo User?` (`LeadAssignee`).
- **`Deal`** (`prisma/schema.prisma:623`):
  Existing fields: `id`, `title`, `value`, `stage` (`DealStage`: `DISCOVERY`, `PROPOSAL`, `NEGOTIATION`, `CLOSED_WON`, `CLOSED_LOST`), `probability`, `expectedCloseDate`, `companyId`, `contactId`, `ownerId`, `notes`, `createdAt`, `updatedAt`.
  Relations: `company Company?`, `contact Contact?`, `owner User?` (`DealOwner`), `fitAssessments ProjectFitAssessment[]`.
- **`Activity`** (`prisma/schema.prisma:480`):
  Existing fields: `id`, `action`, `entity`, `entityId`, `summary`, `userId`, `projectId`, `taskId`, `createdAt`.
  Polymorphic `entity` and `entityId` fields allow logging actions for `"lead"`, `"contact"`, `"company"`, and `"deal"`.
- **`Project` & `Task`** (`prisma/schema.prisma:196, 241`):
  Projects support `archivedAt`, `ownerId`, `members`, and can link to an originating `dealId`.

### 1.2 Existing Services & AI Tools
- **`src/lib/ai/voice/crm-tools.ts`**:
  Voice AI already has registered schemas and logic for `search_contacts_and_leads`, `create_contact_or_lead`, and `update_lead_status`.
- **`src/app/api/dashboard/route.ts`**:
  Already queries `db.deal.findMany()` and `db.lead.findMany()` for pipeline metrics, qualified leads, and lost reasons analysis.
- **`src/lib/auth.ts`**:
  Provides `currentUser()`, `userFromRequest()`, `sameOrigin()`, and `logActivity()`.
- **`src/lib/validators.ts`**:
  Provides `jsonError()`, `emailSchema`, `nameSchema`.

### 1.3 UI Components & Design Architecture
- **`src/components/ui.tsx`**:
  Rich reusable primitives: `Button`, `IconButton`, `Field`, `Textarea`, `Select`, `Modal`, `Avatar`, `SectionTitle`, `EmptyState`, `Loading`, `formatDate`, `formatRelative`, `useToast`.
- **`src/components/workspace-shell.tsx` & `src/components/workspace-view.tsx`**:
  App Router navigation shell with dark theme, responsive sidebar, notifications drawer, and tab mapping.

---

## 2. MISSING FUNCTIONALITY & GAPS

1. **Dedicated CRM REST APIs**:
   No REST endpoints currently exist under `/api/crm/` for Leads, Contacts, Companies, Deals, or CRM stats.
2. **Archiving Architecture**:
   Unlike `Project` and `Task`, CRM models currently lack `archivedAt DateTime?`.
3. **Currency & Company Association**:
   `Deal` model lacks an explicit `currency String @default("INR")` field. `Lead` lacks a direct foreign-key `companyId` to `Company`.
4. **Deal-to-Project Conversion**:
   No workflow exists to convert a `CLOSED_WON` deal into an active delivery `Project` while preserving link traceability.
5. **UI CRM Module**:
   No CRM interface exists in `src/components/modules/` or route under `src/app/(workspace)/crm`.
6. **Duplicate Prevention**:
   No validation prevents duplicate email or phone numbers on Leads or Contacts.

---

## 3. PROPOSED MINIMAL SCHEMA DELTA

All schema modifications are strictly additive and backward-compatible:

```prisma
// Delta 1: Company
model Company {
  ...
  archivedAt DateTime?
  leads      Lead[]
  @@index([archivedAt])
}

// Delta 2: Contact
model Contact {
  ...
  archivedAt DateTime?
  @@index([archivedAt])
}

// Delta 3: Lead
model Lead {
  ...
  companyId    String?
  company      Company?  @relation(fields: [companyId], references: [id], onDelete: SetNull)
  archivedAt   DateTime?
  @@index([companyId])
  @@index([archivedAt])
}

// Delta 4: Deal
model Deal {
  ...
  currency          String    @default("INR")
  archivedAt        DateTime?
  convertedProjectId String?
  convertedProject   Project?  @relation("DealConvertedProject", fields: [convertedProjectId], references: [id], onDelete: SetNull)
  @@index([archivedAt])
  @@index([convertedProjectId])
}

// Delta 5: Project
model Project {
  ...
  dealId   String?
  deal     Deal?   @relation(fields: [dealId], references: [id], onDelete: SetNull)
  convertedFromDeals Deal[] @relation("DealConvertedProject")
  @@index([dealId])
}
```

---

## 4. API ENDPOINTS SPECIFICATION

All endpoints enforce authentication via `userFromRequest()`, CSRF mitigation via `sameOrigin()` on mutations, input validation via Zod schemas, and structured error responses via `jsonError()`.

1. **`GET /api/crm/stats`**:
   Aggregates live database metrics: total leads, new leads, qualified leads, open deals, total active pipeline value (summed by currency), won deals, lost deals, conversion rate.
2. **`GET /api/crm/leads` & `POST /api/crm/leads`**:
   - `GET`: Search (`q`), status filter (`NEW`, `CONTACTED`, `QUALIFIED`, `UNQUALIFIED`, `CONVERTED`), assignee filter, pagination (`page`, `limit`).
   - `POST`: Create lead with duplicate check on email/phone, link to contact/company, validation, audit log.
3. **`GET /api/crm/leads/[id]` & `PATCH /api/crm/leads/[id]` & `DELETE /api/crm/leads/[id]`**:
   - `GET`: Lead details, contact card, company card, assignee, and activity history.
   - `PATCH`: Status update, notes, lead assignment, archive/unarchive.
   - `DELETE`: Safe soft-archive.
4. **`GET /api/crm/contacts` & `POST /api/crm/contacts`**:
   - `GET`: Search, company filter, pagination.
   - `POST`: Create contact with duplicate check on email/phone, company association, validation, audit log.
5. **`GET /api/crm/contacts/[id]` & `PATCH /api/crm/contacts/[id]` & `DELETE /api/crm/contacts/[id]`**:
   - Detail, update, company re-linking, and archiving.
6. **`GET /api/crm/companies` & `POST /api/crm/companies`**:
   - `GET`: Search, industry filter, size filter, pagination.
   - `POST`: Create company with duplicate name/domain check, validation, audit log.
7. **`GET /api/crm/companies/[id]` & `PATCH /api/crm/companies/[id]` & `DELETE /api/crm/companies/[id]`**:
   - Detail showing related contacts, deals, leads, and activity.
8. **`GET /api/crm/deals` & `POST /api/crm/deals`**:
   - `GET`: Stage filter, owner filter, company filter, pagination (supports pipeline view retrieval).
   - `POST`: Create deal with company, contact, value, currency (`INR` default), stage, probability, close date, owner, audit log.
9. **`GET /api/crm/deals/[id]` & `PATCH /api/crm/deals/[id]` & `DELETE /api/crm/deals/[id]`**:
   - Detail view with stage pipeline progress, activity history, and owner assignment.
10. **`POST /api/crm/deals/[id]/convert`**:
    - Converts `CLOSED_WON` deal into a `Project`. Requires explicit user confirmation, creates the project record, sets `dealId` and `convertedProjectId`, copies description/deadline, creates initial activity, logs audit, and returns created project.

---

## 5. USER INTERFACE ARCHITECTURE

A unified, responsive CRM module (`src/components/modules/crm.tsx`) structured into 5 cohesive sub-tabs:

1. **Overview**:
   - Real-time KPI stat cards: Total Leads, Qualified Leads, Active Pipeline Value (in ₹), Open Deals, Won Deals, Lost Deals, Win Rate.
   - Recent CRM activity feed.
   - Quick action shortcuts: "New Lead", "New Deal", "New Contact", "New Company".
2. **Leads**:
   - Filter bar: search, status dropdown, owner dropdown, active/archived toggle.
   - Data table / list with score indicators, value, source, owner avatar.
   - Modal for lead creation/editing.
   - Slide-over / detail view with lead details and activity history.
3. **Contacts**:
   - Search and company filter.
   - Contact cards / table with job title, company link, email, and phone.
   - Modal for contact creation/editing with company selector.
   - Detail view showing associated company, deals, and leads.
4. **Companies**:
   - Search and industry filter.
   - Company table with website, industry, size, and address.
   - Modal for company creation/editing.
   - Detail view displaying all linked contacts, deals, and leads in one view.
5. **Deals (Pipeline & Table)**:
   - Toggle between **Pipeline (Kanban)** view and **Table** view.
   - Pipeline view: Drag or quick-advance stage columns (`DISCOVERY` → `PROPOSAL` → `NEGOTIATION` → `CLOSED_WON` / `CLOSED_LOST`) with aggregate stage value counters.
   - Deal detail view with activity timeline, client contact info, and stage progress.
   - **Convert to Project Action**: One-click conversion modal for won deals with confirmation and pre-filled project scope.

---

## 6. PERMISSIONS & AUTHORIZATION POLICY

| Action / Resource | OWNER | ADMIN | MEMBER | API Enforcement |
| :--- | :---: | :---: | :---: | :--- |
| **View CRM Records & Dashboard** | Allowed | Allowed | Allowed | `userFromRequest(req)` |
| **Create Leads, Contacts, Companies, Deals** | Allowed | Allowed | Allowed | `userFromRequest(req)` |
| **Update Assigned / General CRM Records** | Allowed | Allowed | Allowed (Assigned / General) | Role check in PATCH handler |
| **Reassign Record Owners** | Allowed | Allowed | Denied | 403 Forbidden if MEMBER |
| **Archive / Delete CRM Records** | Allowed | Allowed | Denied | 403 Forbidden if MEMBER |
| **Convert Deal to Project** | Allowed | Allowed | Denied | 403 Forbidden if MEMBER (matches Project creation policy) |

---

## 7. TEST STRATEGY

Author a comprehensive test suite `src/lib/crm.test.ts` covering:
1. **Live PostgreSQL Integration Tests (`company_os_dev`)**:
   - Full CRUD lifecycle for Lead, Contact, Company, Deal.
   - Relationship integrity: Contact linked to Company, Deal linked to Company & Contact, Lead linked to Company & Contact.
   - Duplicate prevention logic: rejection of conflicting contact email and lead phone.
   - Stage transitions and pipeline math.
   - Deal-to-project conversion with bidirectional link preservation and idempotency.
   - Statistics endpoint calculations against actual database rows.
2. **Route-Level Security & Authorization Tests**:
   - 401 Unauthorized for unauthenticated requests.
   - 403 Forbidden for MEMBER attempting archive/delete.
   - 403 Forbidden for MEMBER attempting deal conversion.
   - CSRF origin rejection for mutations without valid origin header.
3. **Full Regression Verification**:
   - Run complete suite: `node --import tsx --test src/lib/*.test.ts`.
   - Run type checker: `npx tsc --noEmit`.

---

## 8. RISKS & DEPENDENCY CONTROLS

1. **Zero Production Mutation:** All work takes place in `/Users/tanveersinghsaini/Desktop/locally hosted app dev` against `company_os_dev`. Production files and database remain 100% untouched.
2. **Database Migration Safety:** Migrations are applied using proper Prisma migration tooling. `prisma db push --accept-data-loss` is strictly prohibited.
3. **Currency Integrity:** Base currency is standardized to `INR` (`₹`), aligning with `src/lib/cost.ts`.

