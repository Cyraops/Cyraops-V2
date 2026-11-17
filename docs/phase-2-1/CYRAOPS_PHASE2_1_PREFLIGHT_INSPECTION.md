# CYRAOPS — PHASE 2.1 PREFLIGHT INSPECTION REPORT
## Pre-Implementation Data, Schema & Concurrency Assessment

**Date:** November 6, 2026  
**Auditor / Engineer:** Antigravity AI Engineering Pair  
**Development Workspace:** `/Users/tanveersinghsaini/Desktop/locally hosted app dev` (Port 3001)  
**Development Database:** `company_os_dev` (Port 5432 — Verified `SELECT current_database()`)  
**Production Target:** `/Users/tanveersinghsaini/Desktop/locally hosted app` (Port 3000 / `company_os` — **Strictly Untouched & Read-Only**)  
**Pre-Remediation Database Backup:** `backups/company_os_dev_phase2_1_pre_remediation_1793913146.sql` (633 KB, 6274 lines)

---

## 1. EXISTING RECORD AUDIT & DUPLICATE ANALYSIS

A comprehensive query of all CRM tables in `company_os_dev` was executed:

```sql
SELECT 'Lead' AS model, COUNT(*) AS count, COUNT(DISTINCT email) AS distinct_emails FROM "Lead"
UNION ALL
SELECT 'Contact' AS model, COUNT(*) AS count, COUNT(DISTINCT email) AS distinct_emails FROM "Contact"
UNION ALL
SELECT 'Company' AS model, COUNT(*) AS count, COUNT(DISTINCT name) AS distinct_names FROM "Company"
UNION ALL
SELECT 'Deal' AS model, COUNT(*) AS count, COUNT(DISTINCT "convertedProjectId") AS distinct_converted_projects FROM "Deal"
UNION ALL
SELECT 'Project' AS model, COUNT(*) AS count, COUNT(DISTINCT "dealId") AS distinct_deals FROM "Project";
```

### Results:
- **`Lead`:** 0 rows.
- **`Contact`:** 0 rows.
- **`Company`:** 0 rows.
- **`Deal`:** 0 rows.
- **`Project`:** 2 rows (`cmvwhn8800001xt3x4ne3eu2l` - General Operations, `cmvzuynuh0001xtw7772tdqqb` - Enterprise Cloud Migration; both have `dealId = NULL`).

**Finding:** There are zero duplicate candidates and zero active CRM records in `company_os_dev`. No existing records will be rejected, altered, merged, or deleted during constraint application.

---

## 2. PROPOSED UNIQUENESS RULES & ARCHITECTURAL STRATEGY

### 2.1 Deal-to-Project Conversion (One-to-One Bi-Directional Guarantee)
- **`Deal.convertedProjectId`:** Add `@unique` in Prisma and `UNIQUE` constraint in PostgreSQL.
- **`Project.dealId`:** Add `@unique` in Prisma and `UNIQUE` constraint in PostgreSQL.
- **Effect:** Exactly one deal converts to exactly one project. Multiple NULLs are permitted in PostgreSQL, ensuring un-converted deals and un-linked projects coexist safely without constraint violations.

### 2.2 Active Record Duplicate Prevention
- **`Contact`:** Partial unique index on `lower(email)` where `archivedAt IS NULL AND email IS NOT NULL`.
- **`Lead`:** Partial unique index on `lower(email)` where `archivedAt IS NULL AND email IS NOT NULL`.
- **`Company` (Name):** Partial unique index on `lower(name)` where `archivedAt IS NULL`.
- **`Company` (Domain):** Partial unique index on `lower(domain)` where `archivedAt IS NULL AND domain IS NOT NULL`.
- **Effect:** Concurrent submissions attempting to insert the same active email, company name, or domain will be blocked at the database engine level (PostgreSQL `unique_violation` / Prisma `P2002`). Archiving a contact or company releases the unique constraint, allowing future re-engagement.

---

## 3. EXISTING CURRENCY DISTRIBUTION

Query of `SELECT DISTINCT currency FROM "Deal"` returned **0 rows** (no deals currently stored in development).

### Policy Decision:
To guarantee financial accuracy and prevent mixed-currency aggregation errors (F-P2-03):
1. The system standardizes on **INR (`₹`)** as the base operating currency, matching the cost and finance module (`src/lib/cost.ts`).
2. `createDealSchema` will enforce `currency: z.literal("INR").default("INR")`.
3. In `stats/route.ts` and `crm.tsx`, values will strictly aggregate and display in INR with `₹` formatting.
4. If multi-currency support is introduced in a future phase, it will require distinct currency grouping and live rate conversion.

---

## 4. MIGRATION STRATEGY

1. Author schema delta in `prisma/schema.prisma` marking `convertedProjectId` and `dealId` as `@unique`.
2. Generate formal migration directory `prisma/migrations/20261106024500_crm_concurrency_hardening/migration.sql`.
3. Add the partial unique indexes for active `Contact`, `Lead`, and `Company` records directly to the migration SQL.
4. Deploy migration via `npx prisma migrate deploy` against `company_os_dev`.
5. Verify in PostgreSQL with `\d+ "Deal"`, `\d+ "Project"`, and `pg_indexes`.
6. Verify with `npx prisma migrate status`.

---

## 5. COMPATIBILITY & REGRESSION EVALUATION

- **Compatibility:** Zero existing data conflicts.
- **API Error Handling:** API handlers will trap Prisma error code `P2002` (unique constraint violation) and return user-friendly `409 Conflict` responses instead of unhandled 500 crashes.
- **Production Isolation:** Migration will only be executed in `company_os_dev`.

