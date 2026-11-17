# CYRAOPS REMAINING ISSUES AND RISKS REPORT
## Architectural Limitations · Security Boundaries · Technical Debt Roadmap

> [!NOTE]
> This document details identified architectural limitations and integration dependencies that were deliberately **deferred** from immediate code remediation to prevent breaking schema migrations, avoid altering established UX workflows without user authorization, or prevent uncoordinated privilege changes.

---

## 1. Deferred Issue Inventory

| ID | Title | Domain | Risk Severity | Classification Status |
| :--- | :--- | :--- | :--- | :--- |
| **SEC-01** | Profile-Switching Privilege Escalation in Shared Workspace | Identity & Security | **High** | **DEFERRED — REQUIRES ARCHITECTURAL CHANGE** |
| **REM-04** | Lead-to-Project Relational Model & Dedicated Pipeline UI | CRM & Data Model | **Medium** | **DEFERRED — REQUIRES ARCHITECTURAL CHANGE** |
| **INT-01** | External GoDaddy IMAP / SMTP Credentials Dependency | Integrations | **Low** | **DEFERRED — REQUIRES AUTHORIZATION** |

---

## 2. In-Depth Risk & Architectural Analysis

### SEC-01: Profile-Switching Privilege Escalation
* **Classification**: `DEFERRED — REQUIRES ARCHITECTURAL CHANGE`
* **Current Architecture**:
  - Cyraops CRM currently implements a **single-credential shared workspace model**: all team members sign into the application using a single shared company email and password (`tanveersinghsaini17@gmail.com`).
  - Once signed in, team members switch their active persona using the profile switcher widget in the sidebar, which invokes `POST /api/profile/active` with `{ userId }`.
  - The API updates the session cookie to the selected `userId`.
* **Identified Vulnerability**:
  - Any user possessing the workspace login can invoke `POST /api/profile/active` with the user ID of an `OWNER` or `ADMIN`, instantly elevating their effective role and permissions across financial reports (`/cost`), user management (`/team`), and high-impact AI/Voice execution tools.
* **Why Immediate Remediation Was Deferred**:
  - If the server-side profile switching endpoint were strictly locked so that a `MEMBER` cannot switch to an `OWNER` without a secondary secret, legitimate team members would be locked out of the switcher UI because there is currently **no password or PIN challenge dialog** designed or implemented in the frontend shell.
  - Hard-locking this at the API level without an approved UI workflow would break normal company collaboration.
* **Architectural Options & Recommendations**:
  1. **Option A: Dedicated Per-User Authentication (Recommended)**:
     - Migrate from a single shared workspace password to individual user logins (e.g., individual email/password or Google Workspace SSO).
     - Each session is tied exclusively to the authenticated user. Role elevation is impossible without valid credentials.
  2. **Option B: Administrative Security PIN**:
     - Introduce a 6-digit administrative security PIN required whenever switching into an `OWNER` or `ADMIN` profile from a `MEMBER` profile.
     - Adds security while preserving the lightweight shared login model.

---

### REM-04: Lead-to-Project Relational Model & Pipeline Module
* **Classification**: `DEFERRED — REQUIRES ARCHITECTURAL CHANGE`
* **Current Architecture**:
  - The Prisma database schema includes both `Lead` and `Project` models.
  - However, there is no foreign key relationship linking a `Lead` or `Deal` directly to a resulting `Project`.
  - Furthermore, while the database models for `Lead` and `Deal` exist, there is no dedicated sidebar navigation item or UI page for "Leads" or "Deals" (intake is primarily handled via the executive Dashboard and AI Workspace).
* **Identified Limitation**:
  - In cross-module workflow testing (`Workflow A`), creating a Lead does not automatically link to a downstream Project entity.
* **Why Immediate Remediation Was Deferred**:
  - Adding a relational column (`leadId String? @relation(...)`) to `Project` requires running a database migration.
  - The user prompt strictly prohibits altering production and strictly specifies **no changes to existing navigation, sidebar structure, or UI redesign**.
  - Introducing a foreign key without a corresponding UI design would create orphaned relations.
* **Architectural Roadmap**:
  - Phase 1: Define the business lifecycle: `Lead (Inbound/Outbound) -> Deal (Proposal/Negotiation) -> Closed Won -> Project Provisioning`.
  - Phase 2: Add `leadId` and `dealId` nullable foreign keys to `Project` in `schema.prisma`.
  - Phase 3: Create a clean "Convert Deal to Project" modal in the CRM pipeline view to auto-populate project scope, budget, and assigned client contacts from the deal history.

---

### INT-01: GoDaddy IMAP / SMTP Mailbox Synchronization Credentials
* **Classification**: `DEFERRED — REQUIRES AUTHORIZATION`
* **Current State**:
  - The email module has robust server-side security, HTML sanitization, attachment extension whitelisting, recipient rate limiting, and full SMTP idempotency crash-recovery protections (verified with 20 security tests and 10 idempotency tests).
  - However, live external synchronization with GoDaddy IMAP and SMTP requires valid credentials configured in `.env` (`IMAP_HOST`, `IMAP_USER`, `IMAP_PASS`, `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASS`).
  - In the development environment, mock transports and graceful offline fallbacks are active.
* **Action Required**:
  - User authorization to safely inject live GoDaddy credentials into the development `.env` when external mail synchronization testing is requested.

---

## 3. Summary Risk Matrix

| Risk Factor | Probability | Impact | Mitigation Strategy |
| :--- | :--- | :--- | :--- |
| **Unauthorized Profile Escalation** | Medium | High | Implement individual user accounts or Admin PIN challenge in Phase 2. |
| **Lead / Project Relational Disconnect** | Low | Low | Documented as non-blocking; planned for CRM Pipeline UI release. |
| **GoDaddy IMAP Authentication Failures** | Low | Medium | Safeguarded by offline mock transport and explicit error reporting. |
