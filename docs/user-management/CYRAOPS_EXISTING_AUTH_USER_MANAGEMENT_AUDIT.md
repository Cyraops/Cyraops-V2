# CYRAOPS — EXISTING AUTHENTICATION & USER MANAGEMENT READ-ONLY AUDIT

**Date:** 2026-11-05  
**Audit Type:** Read-Only Authentication, User Provisioning & Permissions Architecture Audit  
**Environment:** Development (`/Users/tanveersinghsaini/Desktop/locally hosted app dev` / Port 3001 / `company_os_dev`)  
**Production Status:** Isolated & Verified (`localhost:3000` / `company_os` / 0 modifications)  
**Execution Mode:** Strictly Read-Only (0 migrations, 0 database writes, 0 code modifications)

---

## 1. Executive Summary

This read-only technical audit investigated the existing authentication architecture, employee provisioning flows, role-based access controls, and administrative user interfaces in the Cyraops codebase.

The goal is to determine how individual employees can log in using their own corporate credentials and identify what is already built, what is partially implemented, and what is missing before authorizing implementation.

### Key Audit Conclusions

1. **Foundations are Already Built in DB & Backend:**
   Individual user credentials, password hashing (`bcryptjs`), secure sessions (`Session` table with SHA-256 tokens and database immutability triggers), password setup tokens (`PasswordSetupToken` table with 48h expiry and single-use enforcement), and invite creation (`POST /api/team`) **are already implemented and fully functional at the database and API layers**.
2. **Zero Database Migrations Required:**
   The PostgreSQL schema in `company_os_dev` already contains every table, column, constraint, index, and trigger needed to support full employee onboarding.
3. **Critical Defect Discovered in Profile Password Settings:**
   [`src/app/api/profile/route.ts#L13-L21`](file:///Users/tanveersinghsaini/Desktop/locally%20hosted%20app%20dev/src/app/api/profile/route.ts#L13-L21) still updates the legacy single-shared workspace password (`workspace.loginPasswordHash`) instead of the authenticated user's individual password (`user.passwordHash`), and [`src/components/modules/settings.tsx`](file:///Users/tanveersinghsaini/Desktop/locally%20hosted%20app%20dev/src/components/modules/settings.tsx#L63-L68) still displays obsolete "Shared workspace login" text.
4. **Current Provisioning Gap:**
   Admins can create new members and view a setup link once via modal in [`src/components/modules/team.tsx`](file:///Users/tanveersinghsaini/Desktop/locally%20hosted%20app%20dev/src/components/modules/team.tsx), but there is **no capability to resend or regenerate setup links** once the modal is closed or the 48-hour token expires. Furthermore, deactivated members are filtered out completely with no UI to view or reactivate them.

---

## 2. Existing Authentication Architecture

```mermaid
sequenceDiagram
    autonumber
    actor Employee as Employee / Browser
    participant LoginUI as /login (AuthForm)
    participant LoginAPI as POST /api/auth/login
    participant DB as PostgreSQL (company_os_dev)
    participant Layout as ProtectedLayout / currentUser()

    Employee->>LoginUI: Enter corporate email & password
    LoginUI->>LoginAPI: POST { email, password } + sameOrigin
    LoginAPI->>DB: Check rate limit (ip & email buckets)
    LoginAPI->>DB: SELECT * FROM "User" WHERE email = normalizedEmail
    alt User not found / disabled / no password
        LoginAPI->>LoginAPI: bcrypt.compare(password, dummyPasswordHash) [Timing Mitigation]
        LoginAPI-->>LoginUI: 401 "Email or password is incorrect"
    else User valid & password matches
        LoginAPI->>DB: INSERT INTO "Session" (tokenHash, userId, expiresAt)
        LoginAPI-->>LoginUI: 200 OK + Set-Cookie: company_session=<rawToken>; HttpOnly; SameSite=Lax
    end
    LoginUI->>Layout: Navigate to /dashboard
    Layout->>DB: SELECT * FROM "Session" WHERE tokenHash = sha256(rawToken)
    Layout-->>Employee: Render Dashboard (Attributed to User)
```

### 2.1 Prisma Models

#### `User` Model ([`prisma/schema.prisma#L119-L164`](file:///Users/tanveersinghsaini/Desktop/locally%20hosted%20app%20dev/prisma/schema.prisma#L119-L164))
- `id` (`String @id @default(cuid())`): Unique user identifier used across all CRM modules.
- `name` (`String`): Full name.
- `email` (`String? @unique`): Unique corporate email address.
- `passwordHash` (`String?`): Nullable bcrypt hash (cost 12). If null, the user cannot authenticate via password until initial setup is completed.
- `mustChangePassword` (`Boolean @default(false)`): Flag indicating mandatory password change.
- `role` (`Role @default(MEMBER)`): Role enum (`OWNER`, `ADMIN`, `MEMBER`).
- `disabledAt` (`DateTime?`): Timestamp indicating account deactivation.
- `sessions` (`Session[]`): Cascading 1-to-many relationship with active sessions.
- `setupTokens` (`PasswordSetupToken[]`): Cascading 1-to-many relationship with invitation tokens.

#### `Session` Model ([`prisma/schema.prisma#L166-L175`](file:///Users/tanveersinghsaini/Desktop/locally%20hosted%20app%20dev/prisma/schema.prisma#L166-L175))
- `id` (`String @id @default(cuid())`): Session ID.
- `tokenHash` (`String @unique`): SHA-256 hash of the 32-byte session token. Raw token is never stored in DB.
- `userId` (`String`): Foreign key referencing `User.id` with `onDelete: Cascade`.
- `expiresAt` (`DateTime`): Expiry timestamp (default 14 days from creation).
- **Session Identity Immutability Trigger:** PostgreSQL trigger `trg_session_identity_immutable` prevents updating `userId` on existing sessions to defeat session hijacking.

#### `PasswordSetupToken` Model ([`prisma/schema.prisma#L184-L194`](file:///Users/tanveersinghsaini/Desktop/locally%20hosted%20app%20dev/prisma/schema.prisma#L184-L194))
- `id` (`String @id @default(cuid())`): Token record ID.
- `tokenHash` (`String @unique`): SHA-256 hash of the raw invitation token.
- `userId` (`String`): Foreign key referencing `User.id` with `onDelete: Cascade`.
- `expiresAt` (`DateTime`): Expiration timestamp (48 hours from issuance).
- `usedAt` (`DateTime?`): Timestamp populated upon redemption (single-use enforcement).

#### `AuthRateLimit` Model ([`prisma/schema.prisma#L177-L182`](file:///Users/tanveersinghsaini/Desktop/locally%20hosted%20app%20dev/prisma/schema.prisma#L177-L182))
- `key` (`String @id`): Rate limit identifier (e.g., `ip:<ip>` or `email:<normalizedEmail>`).
- `hits` (`Int @default(0)`): Number of failed attempts.
- `windowEnds` (`DateTime`): Expiration timestamp for the rate limit sliding window.

### 2.2 Password Hashing & Verification
- **Implementation:** `bcryptjs` with salt work factor of `12` rounds.
- **Timing Attack Mitigation:** In [`src/app/api/auth/login/route.ts#L7,L24`](file:///Users/tanveersinghsaini/Desktop/locally%20hosted%20app%20dev/src/app/api/auth/login/route.ts#L7), when an account does not exist or has no password, `compare(body.password, await dummyPasswordHash)` executes a real bcrypt evaluation to maintain constant execution time.

### 2.3 Session Validation & Expiration
- Located in [`src/lib/auth.ts`](file:///Users/tanveersinghsaini/Desktop/locally%20hosted%20app%20dev/src/lib/auth.ts):
  - `userFromRequest(request)` reads `company_session` cookie, computes `sha256(token)`, and queries `db.session.findUnique`.
  - Checks: `if (!session || session.expiresAt < new Date() || session.user.disabledAt)`.
  - If expired or disabled: deletes session row (`db.session.delete`) and returns `null`.
  - Lifetime: 14 days (`SESSION_DURATION_DAYS = 14`).

### 2.4 Cookie Security
- [`src/lib/auth.ts#L45-L49`](file:///Users/tanveersinghsaini/Desktop/locally%20hosted%20app%20dev/src/lib/auth.ts#L45-L49):
  - `httpOnly: true`: Blocks client-side JavaScript access (`document.cookie`).
  - `sameSite: "lax"`: Protects against cross-site request forgery.
  - `path: "/"`: Root cookie scope.
  - `secure`: Auto-detected via HTTPS protocol or `COOKIE_SECURE=true`.

### 2.5 Middleware & Route Protection
- **No Edge Middleware:** The project does not use a root Next.js `middleware.ts`.
- **Layout Guard:** [`src/app/(workspace)/layout.tsx#L6-L10`](file:///Users/tanveersinghsaini/Desktop/locally%20hosted%20app%20dev/src/app/%28workspace%29/layout.tsx#L6-L10) invokes `currentUser()`. If null, redirects to `/login`.
- **API Guard:** Mutating and data endpoints independently execute `userFromRequest(request)`.

---

## 3. Existing User Account Provisioning Capabilities

| Provisioning Capability | Status | Implementation Details & Source Reference |
| :--- | :---: | :--- |
| **Creating User Account** | **Fully Implemented** | Implemented in `POST /api/team` ([`route.ts#L18-L84`](file:///Users/tanveersinghsaini/Desktop/locally%20hosted%20app%20dev/src/app/api/team/route.ts#L18-L84)). Creates `User` with `role`, `email`, and `mustChangePassword: true`. |
| **Admin UI Account Creation** | **Fully Implemented** | "Add team member" modal in [`team.tsx#L37-L63`](file:///Users/tanveersinghsaini/Desktop/locally%20hosted%20app%20dev/src/components/modules/team.tsx#L37-L63). Collects name, email, role. |
| **API Account Creation** | **Fully Implemented** | `POST /api/team` validates payload with Zod, enforces authorization, and handles creation. |
| **Generating Setup Tokens** | **Fully Implemented** | Generates 32 cryptographically secure random bytes via `newToken()` ([`auth.ts#L9`](file:///Users/tanveersinghsaini/Desktop/locally%20hosted%20app%20dev/src/lib/auth.ts#L9)). |
| **Hashing Setup Tokens** | **Fully Implemented** | Token is hashed with SHA-256 before storage: `tokenHash = sha256(rawToken)` ([`route.ts#L46`](file:///Users/tanveersinghsaini/Desktop/locally%20hosted%20app%20dev/src/app/api/team/route.ts#L46)). |
| **Token Expiration** | **Fully Implemented** | Fixed 48-hour expiration (`expiresAt = Date.now() + 48h`). Validated on submission in [`/api/auth/setup`](file:///Users/tanveersinghsaini/Desktop/locally%20hosted%20app%20dev/src/app/api/auth/setup/route.ts#L19,L62). |
| **Single-Use Enforcement** | **Fully Implemented** | Atomic database transaction marks `usedAt = new Date()` and purges other unused tokens for that user ([`setup/route.ts#L91-L108`](file:///Users/tanveersinghsaini/Desktop/locally%20hosted%20app%20dev/src/app/api/auth/setup/route.ts#L91-L108)). |
| **Revoking Invitations** | **Partially Implemented** | Deleting unconsumed tokens happens automatically when an account is disabled in [`team/[id]/route.ts#L26`](file:///Users/tanveersinghsaini/Desktop/locally%20hosted%20app%20dev/src/app/api/team/%5Bid%5D/route.ts#L26), but there is **no standalone API or UI to cancel an invite**. |
| **Completing Initial Password Setup** | **Fully Implemented** | Supported in [`auth-form.tsx#L128-L146`](file:///Users/tanveersinghsaini/Desktop/locally%20hosted%20app%20dev/src/components/auth-form.tsx#L128-L146) and `POST /api/auth/setup`. Authenticates user and sets session cookie immediately. |
| **Account Activation** | **Partially Implemented** | Accounts are created active. However, once deactivated, there is no UI to view or reactivate them. |
| **Resending / Regenerating Invitations** | **NOT Implemented** | **Missing.** If the modal is closed or the 48-hour link expires, there is no endpoint or button to generate a new setup link for that user. |
| **Duplicate Email Prevention** | **Fully Implemented** | Case-insensitive check in `POST /api/team` ([`route.ts#L38-L43`](file:///Users/tanveersinghsaini/Desktop/locally%20hosted%20app%20dev/src/app/api/team/route.ts#L38-L43)) plus database unique index `User_email_key`. |

---

## 4. Existing Role and Permission Matrix

Role definitions are declared in `enum Role` ([`prisma/schema.prisma#L86`](file:///Users/tanveersinghsaini/Desktop/locally%20hosted%20app%20dev/prisma/schema.prisma#L86)) with permission rules encoded in [`src/lib/permissions.ts`](file:///Users/tanveersinghsaini/Desktop/locally%20hosted%20app%20dev/src/lib/permissions.ts).

### Role-Permission Matrix

| Action / Capability | OWNER | ADMIN | MEMBER | Server Enforcement Location |
| :--- | :---: | :---: | :---: | :--- |
| **Create Member Profile** | Yes | Yes | No (403) | [`/api/team/route.ts#L22`](file:///Users/tanveersinghsaini/Desktop/locally%20hosted%20app%20dev/src/app/api/team/route.ts#L22) |
| **Create Admin Profile** | Yes | No (403) | No (403) | [`/api/team/route.ts#L33-L35`](file:///Users/tanveersinghsaini/Desktop/locally%20hosted%20app%20dev/src/app/api/team/route.ts#L33-L35) |
| **Promote Member to Admin** | Yes | No (403) | No (403) | [`permissions.ts#L6`](file:///Users/tanveersinghsaini/Desktop/locally%20hosted%20app%20dev/src/lib/permissions.ts#L6) & [`team/[id]/route.ts#L21`](file:///Users/tanveersinghsaini/Desktop/locally%20hosted%20app%20dev/src/app/api/team/%5Bid%5D/route.ts#L21) |
| **Demote Admin to Member** | Yes | No (403) | No (403) | [`permissions.ts#L6`](file:///Users/tanveersinghsaini/Desktop/locally%20hosted%20app%20dev/src/lib/permissions.ts#L6) |
| **Deactivate Member Account** | Yes | Yes | No (403) | [`permissions.ts#L6`](file:///Users/tanveersinghsaini/Desktop/locally%20hosted%20app%20dev/src/lib/permissions.ts#L6) |
| **Deactivate Admin Account** | Yes | No (403) | No (403) | [`permissions.ts#L4-L6`](file:///Users/tanveersinghsaini/Desktop/locally%20hosted%20app%20dev/src/lib/permissions.ts#L4-L6) |
| **Manage / Touch Owner Profile** | No (404) | No (404) | No (404) | [`team/[id]/route.ts#L19`](file:///Users/tanveersinghsaini/Desktop/locally%20hosted%20app%20dev/src/app/api/team/%5Bid%5D/route.ts#L19) (`target.role === "OWNER"`) |
| **Create Projects** | Yes | Yes | No (403) | [`/api/projects/route.ts#L19`](file:///Users/tanveersinghsaini/Desktop/locally%20hosted%20app%20dev/src/app/api/projects/route.ts#L19) |
| **View All Projects** | Yes | Yes | Scoped | Member only sees assigned projects ([`projects/route.ts#L11`](file:///Users/tanveersinghsaini/Desktop/locally%20hosted%20app%20dev/src/app/api/projects/route.ts#L11)) |
| **AI Admin & Controls** | Yes | Yes | No (403) | [`/api/ai/admin/route.ts#L33`](file:///Users/tanveersinghsaini/Desktop/locally%20hosted%20app%20dev/src/app/api/ai/admin/route.ts#L33) |
| **Send Workspace Emails** | Yes | Yes | Scoped | [`/api/email/send/route.ts#L28`](file:///Users/tanveersinghsaini/Desktop/locally%20hosted%20app%20dev/src/app/api/email/send/route.ts#L28) |

- **Root Administrator Protection:** The `OWNER` cannot be deactivated, demoted, or deleted by any user or API endpoint (`team/[id]/route.ts#L19` unconditionally rejects any modification of the OWNER).
- **Default Role:** New users default to `MEMBER`.

---

## 5. Existing Administration Interface Inspection

| Administrative Interface | Existence | File Location | Assessment |
| :--- | :---: | :--- | :--- |
| **Team Directory** | **Present** | [`src/components/modules/team.tsx`](file:///Users/tanveersinghsaini/Desktop/locally%20hosted%20app%20dev/src/components/modules/team.tsx) | Clean list of active members with avatars, titles, emails, and roles. |
| **Account Creation Modal** | **Present** | [`src/components/modules/team.tsx#L113-L121`](file:///Users/tanveersinghsaini/Desktop/locally%20hosted%20app%20dev/src/components/modules/team.tsx#L113-L121) | Modal collecting Name, Email, Role. Creates member and opens link modal. |
| **Invite Link Modal** | **Present** | [`src/components/modules/team.tsx#L124-L138`](file:///Users/tanveersinghsaini/Desktop/locally%20hosted%20app%20dev/src/components/modules/team.tsx#L124-L138) | Shows generated link with single-click "Copy" button. |
| **Inline Role Dropdown** | **Present** | [`src/components/modules/team.tsx#L104-L106`](file:///Users/tanveersinghsaini/Desktop/locally%20hosted%20app%20dev/src/components/modules/team.tsx#L104-L106) | Role selector (`Member` / `Admin`) enabled based on caller permissions. |
| **Deactivate Member Button** | **Present** | [`src/components/modules/team.tsx#L107`](file:///Users/tanveersinghsaini/Desktop/locally%20hosted%20app%20dev/src/components/modules/team.tsx#L107) | Triggers confirmation prompt and deactivates member account. |
| **Deactivated Members View** | **ABSENT** | — | `/api/team` filters `disabledAt: null`. Deactivated members cannot be seen or reactivated. |
| **Resend / Regenerate Link** | **ABSENT** | — | No button in member row to regenerate an expired setup link. |
| **Invitation Status Badge** | **ABSENT** | — | Roster does not display whether an invite is `Pending Setup`, `Active`, or `Expired`. |
| **Password Reset UI** | **ABSENT** | — | No admin password reset action; no self-service reset. |
| **Session Management UI** | **ABSENT** | — | No listing of active sessions or remote sign-out. |

---

## 6. Database Inspection (`company_os_dev`)

A read-only inspection of `company_os_dev` was conducted.

### Account & Authentication Statistics

| Metric | Count | Details |
| :--- | :---: | :--- |
| **Total `User` Records** | 30 | 4 Owners (created during testing/seeds), 26 Members. |
| **Users with Passwords** | 10 | Can log in individually with corporate email & password. |
| **Users without Passwords** | 20 | Created during earlier phases without individual credentials (`passwordHash: null`). |
| **Active Sessions (`Session`)** | 170 | Session tokens hashed via SHA-256. |
| **Password Setup Tokens** | 2 | Both tokens expired (`2026-11-05 20:07:45 UTC`). |
| **Disabled Users** | 1 | `audit_disabled@cyraops.com` (`disabledAt: not null`). |

### Schema Feasibility for Employee Onboarding
**Confirmed:** The existing schema in `company_os_dev` **fully supports individual employee onboarding without any database migration**.

---

## 7. Security Assessment

### Confirmed Strengths
1. **No Plaintext Token Storage:** Both session tokens and password setup tokens are hashed with SHA-256 before storage in PostgreSQL.
2. **Session Hijacking Mitigation:** The PostgreSQL database trigger `trg_session_identity_immutable` prevents updating `userId` on existing sessions.
3. **Account Enumeration Protection:** The login endpoint employs `dummyPasswordHash` to ensure identical response times and error messages regardless of email existence.
4. **Immediate Ejection on Deactivation:** Deactivating an account immediately purges database sessions, cancels pending setup tokens, severs Socket.IO connections, and ejects the user from active LiveKit audio/video calls.
5. **Rate Limiting:** Both `/api/auth/login` and `/api/auth/setup` enforce sliding window rate limiting via `AuthRateLimit`.

### Confirmed Vulnerabilities & Deficiencies
1. **Critical Defect — Profile Password Route ([`src/app/api/profile/route.ts#L13-L21`](file:///Users/tanveersinghsaini/Desktop/locally%20hosted%20app%20dev/src/app/api/profile/route.ts#L13-L21)):**
   When an authenticated user attempts to change their password via `/api/profile`, the backend checks `parsed.data.currentPassword` against `workspace.loginPasswordHash` and updates `workspace.loginPasswordHash`. An individual employee's `user.passwordHash` is **never updated**!
2. **Weak Password Policy ([`src/lib/validators.ts#L4`](file:///Users/tanveersinghsaini/Desktop/locally%20hosted%20app%20dev/src/lib/validators.ts#L4)):**
   The current schema enforces `min(4)` characters with no requirement for numbers, symbols, or mixed case.
3. **No Invitation Expiration Recovery:**
   Once the 48-hour setup token expires, the user is permanently locked out until an administrator manually runs an offline script (`scripts/seed-member-tokens.ts`) because no UI or API exists to generate a fresh token.

---

## 8. Integration and Regression Risks

| Integration Touchpoint | Regression Risk | Assessment |
| :--- | :---: | :--- |
| **Chat & Messaging** | **Low / Positive** | Chat conversations and messages use `userId`. Individual employee login will ensure messages are accurately attributed to the logged-in employee. |
| **1:1 & Group Calling** | **Low / Positive** | LiveKit tokens, call roster, and call host controls use `session.user.id`. Individual login eliminates identity spoofing in meetings. |
| **Project Permissions** | **Medium** | Members (`role: "MEMBER"`) are restricted to projects where `members.some(m => m.userId === user.id)`. When employees log in individually, admins must ensure they are added to relevant projects. |
| **Shared Workspace Login** | **None** | The shared login was a transitional Phase 0 artifact. Individual accounts are already fully supported by the session engine. |

---

## 9. Exact Files and Functions Inspected

- [`prisma/schema.prisma`](file:///Users/tanveersinghsaini/Desktop/locally%20hosted%20app%20dev/prisma/schema.prisma) (`User`, `Session`, `PasswordSetupToken`, `AuthRateLimit`, `Workspace`, `Role`)
- [`src/lib/auth.ts`](file:///Users/tanveersinghsaini/Desktop/locally%20hosted%20app%20dev/src/lib/auth.ts) (`userFromRequest`, `currentUser`, `createSession`, `cookieOptions`, `sameOrigin`, `sha256`, `newToken`)
- [`src/lib/permissions.ts`](file:///Users/tanveersinghsaini/Desktop/locally%20hosted%20app%20dev/src/lib/permissions.ts) (`canManageMember`, `hasProjectAccess`)
- [`src/lib/validators.ts`](file:///Users/tanveersinghsaini/Desktop/locally%20hosted%20app%20dev/src/lib/validators.ts) (`emailSchema`, `passwordSchema`, `nameSchema`)
- [`src/app/api/auth/login/route.ts`](file:///Users/tanveersinghsaini/Desktop/locally%20hosted%20app%20dev/src/app/api/auth/login/route.ts) (`POST` login handler)
- [`src/app/api/auth/logout/route.ts`](file:///Users/tanveersinghsaini/Desktop/locally%20hosted%20app%20dev/src/app/api/auth/logout/route.ts) (`POST` logout handler)
- [`src/app/api/auth/me/route.ts`](file:///Users/tanveersinghsaini/Desktop/locally%20hosted%20app%20dev/src/app/api/auth/me/route.ts) (`GET` session profile)
- [`src/app/api/auth/setup/route.ts`](file:///Users/tanveersinghsaini/Desktop/locally%20hosted%20app%20dev/src/app/api/auth/setup/route.ts) (`GET` token check, `POST` employee setup & workspace init)
- [`src/app/api/team/route.ts`](file:///Users/tanveersinghsaini/Desktop/locally%20hosted%20app%20dev/src/app/api/team/route.ts) (`GET` members, `POST` add member & generate token)
- [`src/app/api/team/[id]/route.ts`](file:///Users/tanveersinghsaini/Desktop/locally%20hosted%20app%20dev/src/app/api/team/%5Bid%5D/route.ts) (`PATCH` update role / deactivate account)
- [`src/app/api/profile/route.ts`](file:///Users/tanveersinghsaini/Desktop/locally%20hosted%20app%20dev/src/app/api/profile/route.ts) (`PATCH` profile and password update)
- [`src/components/auth-form.tsx`](file:///Users/tanveersinghsaini/Desktop/locally%20hosted%20app%20dev/src/components/auth-form.tsx) (Sign-in & Password setup UI)
- [`src/components/modules/team.tsx`](file:///Users/tanveersinghsaini/Desktop/locally%20hosted%20app%20dev/src/components/modules/team.tsx) (Team roster, invite modal, role/deactivation)
- [`src/components/modules/settings.tsx`](file:///Users/tanveersinghsaini/Desktop/locally%20hosted%20app%20dev/src/components/modules/settings.tsx) (User profile & password change settings)
- [`src/components/workspace-shell.tsx`](file:///Users/tanveersinghsaini/Desktop/locally%20hosted%20app%20dev/src/components/workspace-shell.tsx) (Navigation bar, user profile dropdown, logout)

---

## 10. Production Isolation Verification

- **Production Database:** `company_os` (verified via `SELECT current_database()`).
- **Production URL:** `http://localhost:3000` responded with HTTP 200 OK.
- **Modifications:** 0 production records, migrations, or files were touched during this audit.

---

## 11. Prioritized Implementation Plan

To enable individual employees to log in using their own credentials without rebuilding existing code, the following prioritized steps are recommended:

### Step 1: Add "Resend Setup Link" API Endpoint
- Implement `POST /api/team/[id]/invite`:
  - Enforce `canManageMember` authorization (Owner/Admin only).
  - Verify target user is active (`disabledAt === null`).
  - Delete any unconsumed existing tokens for that user.
  - Generate a new 48-hour `PasswordSetupToken` and return `setupUrl: /setup?token=<rawToken>`.

### Step 2: Add Resend & Reactivate Controls in Team Management UI (`team.tsx`)
- In [`src/components/modules/team.tsx`](file:///Users/tanveersinghsaini/Desktop/locally%20hosted%20app%20dev/src/components/modules/team.tsx):
  - Add an invite status indicator (e.g., `Password set` vs `Invitation pending`).
  - Add a "Resend Setup Link" button for users with pending/expired invitations that opens the copy-link modal.
  - Add a toggle to view "Deactivated Members" and allow admins to reactivate them (`PATCH /api/team/[id]` with `{ disabled: false }`).

### Step 3: Fix Profile Password Change Endpoint (`/api/profile`)
- In [`src/app/api/profile/route.ts#L13-L21`](file:///Users/tanveersinghsaini/Desktop/locally%20hosted%20app%20dev/src/app/api/profile/route.ts#L13-L21):
  - Change password verification to compare `parsed.data.currentPassword` against `user.passwordHash`.
  - Update `user.passwordHash = await hash(newPassword, 12)` on the `User` table (NOT `Workspace.loginPasswordHash`).
- In [`src/components/modules/settings.tsx`](file:///Users/tanveersinghsaini/Desktop/locally%20hosted%20app%20dev/src/components/modules/settings.tsx#L63-L75):
  - Update text from "Shared workspace login" to "Account Security & Password".
  - Remove obsolete references to shared team credentials.

### Step 4: Batch-Provision Setup Links for Existing Uncredentialed Members
- Create a safe administrative command or one-click action to generate fresh invitation setup links for the 20 existing members in `company_os_dev` who currently have `passwordHash: null`.

