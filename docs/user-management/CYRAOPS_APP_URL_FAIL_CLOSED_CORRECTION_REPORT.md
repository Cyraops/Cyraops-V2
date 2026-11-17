# Cyraops — Production APP_URL Fail-Closed Security Correction Report

**Date:** 2026-11-05  
**Scope:** Development-only security correction  
**Target Project:** `/Users/tanveersinghsaini/Desktop/locally hosted app dev`  
**Development Application:** `http://localhost:3001`  
**Development Database:** `company_os_dev`  
**Production Isolation:** `/Users/tanveersinghsaini/Desktop/locally hosted app` (Untouched, `company_os`, 1 user)

---

## 1. Executive Summary

A targeted security correction was implemented in the Cyraops development workspace to ensure canonical invitation URL validation is strictly **fail-closed in production mode** (`NODE_ENV=production`):

1. **Strict Production Enforcement:** In production, `APP_URL` must be a valid, absolute HTTPS URL. Every HTTP URL—including localhost, loopback (`127.0.0.1`, `::1`), private LAN (`10.0.0.0/8`, `172.16.0.0/12`, `192.168.0.0/16`), link-local (`169.254.0.0/16`), and `.local` mDNS domains—is unconditionally rejected. Missing, empty, malformed, non-HTTP(S) schemes, or credentialed URLs are also hard-rejected.
2. **Atomic Pre-Transaction Fail-Closed Guarantee:** Both `POST /api/team` (employee creation) and `POST /api/team/[id]/invite` (setup link regeneration) now validate the canonical application URL **prior to executing any database transaction**. If validation fails, the endpoints immediately return HTTP 500 with a generic error `{ "error": "Server configuration error" }` without creating users, without generating tokens, without invalidating existing tokens, and without leaking configuration or environment variables.
3. **Preserved Development Usability:** In development mode (`NODE_ENV !== "production"`), local/LAN HTTP URLs remain explicitly permitted for local testing, and relative fallback paths (`/setup?token=...`) continue to function when `APP_URL` is omitted.
4. **Comprehensive Test Suite:** All 12 specified test conditions were implemented and verified with 100% pass rate in automated testing. The entire test suite (59 unit/integration tests) passes cleanly, TypeScript checks pass with 0 errors, Next.js production builds compile all 76 routes with 0 errors, and HTTP E2E testing confirms full operational integrity.
5. **Production Isolation Maintained:** Zero writes or migrations were performed against `company_os`. Zero files in the production project were modified.

---

## 2. File-by-File Breakdown of Changes

### A. `src/lib/urls.ts`
- **Updated `validateAppUrl(url, isProduction)`**:
  - Enforces `isProduction` defaults to `process.env.NODE_ENV === "production"`.
  - In production (`isProduction === true`):
    - Rejects missing, empty, or whitespace-only `APP_URL` with `"APP_URL is required in production"`.
    - Enforces protocol strictly equal to `"https:"`. Any `"http:"` protocol is hard-rejected with `"Production requires a valid absolute HTTPS APP_URL"`.
    - Enforces host validation via `isPrivateOrLocalHost(parsed.hostname)`. Rejects localhost, loopback, private IPv4 ranges, link-local, and `.local` domains even if accessed over HTTPS.
    - Rejects username/password in URL, query parameters, or hash fragments.
  - In development (`isProduction === false`):
    - Allows valid HTTPS URLs.
    - Allows HTTP URLs if hostname is a permitted local/LAN destination (localhost, 127.0.0.1, 10.x, 172.16-31.x, 192.168.x, link-local, `.local`).
    - Treats missing `APP_URL` as valid with `baseUrl: undefined` to trigger relative fallback.
- **Updated `buildSetupUrl(token, explicitAppUrl, isProduction)`**:
  - Validates `token` (rejects empty/whitespace tokens).
  - Invokes `validateAppUrl(appUrl, isProduction)`.
  - If invalid, returns `null`.
  - In production, if `!validation.baseUrl`, returns `null` (never falls back to relative paths).
  - In development without `baseUrl`, returns safe relative path `/setup?token=<token>`.

### B. `src/app/api/team/route.ts`
- **Pre-Transaction Fail-Closed Check**:
  - Moved `const setupUrl = buildSetupUrl(rawToken);` to execute **before** `db.$transaction`.
  - If `!setupUrl`, returns `jsonError("Server configuration error", 500)` immediately.
  - Guarantees that neither `tx.user.create` nor `tx.passwordSetupToken.create` is invoked if canonical URL construction fails.
  - Eliminates orphan user accounts without active setup links.

### C. `src/app/api/team/[id]/invite/route.ts`
- **Pre-Transaction Fail-Closed Check**:
  - Moved `const setupUrl = buildSetupUrl(rawToken);` to execute **before** `db.$transaction`.
  - If `!setupUrl`, returns `jsonError("Server configuration error", 500)` immediately.
  - Guarantees that existing unused invitation tokens in `tx.passwordSetupToken.deleteMany` are **not** deleted or invalidated when URL construction fails.
  - Preserves user account state and prevents teammate lockout.

### D. `src/lib/urls.test.ts`
- **Extended Test Suite with All 12 Requirements**:
  - Tests 1 through 10: Pure URL validation logic across production and development configurations.
  - Test 11: Route handler level testing verifying that an invalid or missing production `APP_URL` causes both `POST /api/team` and `POST /api/team/[id]/invite` to return HTTP 500 with `{ "error": "Server configuration error" }`.
  - Test 12: Route handler level testing verifying that `db.$transaction` is called exactly 0 times when URL validation fails, confirming zero token creations, zero token invalidations, and zero user mutations.

---

## 3. Comparative Behavior Matrix

| Scenario | Input `APP_URL` | Prior Behavior | Corrected Behavior |
| :--- | :--- | :--- | :--- |
| **Production (`NODE_ENV=production`)** | `https://crm.company.com` | Accepted absolute HTTPS link | Accepted absolute HTTPS link (`https://crm.company.com/setup?token=...`) |
| **Production (`NODE_ENV=production`)** | `http://localhost:3001` | Returned warning; generated insecure HTTP link | **Hard-rejected (`null`)**; endpoints return HTTP 500 fail-closed |
| **Production (`NODE_ENV=production`)** | `http://127.0.0.1:3001` | Returned warning; generated insecure HTTP link | **Hard-rejected (`null`)**; endpoints return HTTP 500 fail-closed |
| **Production (`NODE_ENV=production`)** | `http://192.168.1.50:3001` | Returned warning; generated insecure HTTP link | **Hard-rejected (`null`)**; endpoints return HTTP 500 fail-closed |
| **Production (`NODE_ENV=production`)** | `http://169.254.1.1:3001` | Returned warning; generated insecure HTTP link | **Hard-rejected (`null`)**; endpoints return HTTP 500 fail-closed |
| **Production (`NODE_ENV=production`)** | `http://laptop.local:3001` | Returned warning; generated insecure HTTP link | **Hard-rejected (`null`)**; endpoints return HTTP 500 fail-closed |
| **Production (`NODE_ENV=production`)** | Missing / Empty `""` | Generated relative fallback `/setup?token=...` | **Hard-rejected (`null`)**; endpoints return HTTP 500 fail-closed |
| **Production (`NODE_ENV=production`)** | `not-a-url` / `ftp://...` | Generated relative fallback `/setup?token=...` | **Hard-rejected (`null`)**; endpoints return HTTP 500 fail-closed |
| **Development (`NODE_ENV=development`)** | `http://localhost:3001` | Permitted local HTTP link | Permitted local HTTP link (`http://localhost:3001/setup?token=...`) |
| **Development (`NODE_ENV=development`)** | `http://192.168.x.x` | Permitted local LAN link | Permitted local LAN link (`http://192.168.x.x/setup?token=...`) |
| **Development (`NODE_ENV=development`)** | Missing / Empty `""` | Permitted relative fallback | Permitted relative fallback (`/setup?token=...`) |
| **Team Invite Endpoint on Invalid URL** | Invalid / Missing | Pre-deleted tokens; generated invalid URL | **Zero DB writes; zero tokens invalidated; returns HTTP 500** |
| **Team Create Endpoint on Invalid URL** | Invalid / Missing | Created user; generated invalid URL | **Zero DB writes; zero users created; returns HTTP 500** |

---

## 4. Pre-Transaction Validation Guarantee

### Source Code Evidence

#### 1. `src/app/api/team/route.ts` (Lines 79–88)
```typescript
  const rawToken = newToken();
  const setupUrl = buildSetupUrl(rawToken);
  if (!setupUrl) {
    return jsonError("Server configuration error", 500);
  }

  const tokenHash = sha256(rawToken);
  const expiresAt = new Date(Date.now() + 48 * 60 * 60 * 1000); // 48 hours

  const member = await db.$transaction(async (tx) => {
    const created = await tx.user.create({ ... });
    await tx.passwordSetupToken.create({ ... });
    return created;
  });
```

#### 2. `src/app/api/team/[id]/invite/route.ts` (Lines 32–41)
```typescript
  const rawToken = newToken();
  const setupUrl = buildSetupUrl(rawToken);
  if (!setupUrl) {
    return jsonError("Server configuration error", 500);
  }

  const tokenHash = sha256(rawToken);
  const expiresAt = new Date(Date.now() + 48 * 60 * 60 * 1000); // 48 hours

  await db.$transaction(async (tx) => {
    await tx.passwordSetupToken.deleteMany({
      where: { userId: target.id, usedAt: null },
    });
    await tx.passwordSetupToken.create({ ... });
    await tx.user.update({ ... });
  });
```

### Invariant Properties
- **No Side Effects on Failure:** Because `buildSetupUrl(rawToken)` precedes `db.$transaction`, any failure in URL validation immediately short-circuits execution and returns HTTP 500.
- **Zero Token Invalidation:** In `POST /api/team/[id]/invite`, existing valid tokens are only deleted within the transaction block. When URL validation fails, existing tokens remain valid and untouched.
- **Zero Orphaned Users:** In `POST /api/team`, user record insertion is grouped with token creation inside the transaction. When URL validation fails, no user record is created.
- **Information Protection:** The client receives only `{ "error": "Server configuration error" }` with no leakage of internal hostnames, protocols, or network topologies.

---

## 5. Automated Verification & Test Results

### A. All 12 URL Validation & Fail-Closed Test Cases (`src/lib/urls.test.ts`)
```
▶ Canonical Application URL Helper (urls.ts) — Production & Development Rules
  ✔ 1. Production accepts a valid HTTPS URL (21.26ms)
  ✔ 2. Production rejects http://localhost:3001 (0.43ms)
  ✔ 3. Production rejects http://127.0.0.1 loopback addresses (0.28ms)
  ✔ 4. Production rejects private IPv4 HTTP addresses (10.x, 172.16-31.x, 192.168.x) (0.45ms)
  ✔ 5. Production rejects link-local HTTP addresses (169.254.x.x) (0.36ms)
  ✔ 6. Production rejects .local HTTP addresses (0.35ms)
  ✔ Production rejects localhost/private addresses even over HTTPS (0.44ms)
  ✔ 7. Production rejects missing APP_URL (0.52ms)
  ✔ 8. Production rejects malformed and unsupported URLs (0.57ms)
  ✔ 9. Development still accepts permitted local/LAN HTTP URLs (1.04ms)
  ✔ 10. Development relative fallback still works when APP_URL is omitted (0.20ms)
  ✔ normalizes trailing slashes on APP_URL in both dev and prod (0.54ms)
  ✔ verifies isPrivateOrLocalHost helper accuracy (0.18ms)
  ✔ 11. An invalid production URL causes both invitation endpoints to return HTTP 500 (23.54ms)
  ✔ 12. Neither endpoint creates or invalidates invitation tokens when URL validation fails (3.45ms)
✔ Canonical Application URL Helper (urls.ts) — Production & Development Rules (56.13ms)
ℹ tests 15
ℹ suites 1
ℹ pass 15
ℹ fail 0
```

### B. Full Test Suite Execution (`npm test`)
```
> cyraops-crm@1.0.0 test
> node --import tsx --test src/lib/*.test.ts

ℹ tests 59
ℹ suites 11
ℹ pass 59
ℹ fail 0
ℹ cancelled 0
ℹ skipped 0
ℹ todo 0
ℹ duration_ms 2635.62ms
```

### C. TypeScript Typecheck (`npx tsc --noEmit`)
```
Exit code: 0 (No type errors)
```

### D. Next.js Production Build (`npm run build`)
```
▲ Next.js 16.4.3 (Turbopack)
✓ Compiled successfully in 4.3s
✓ Finished TypeScript in 9.6s 
✓ Collecting page data using 7 workers in 4.5s 
✓ Generating static pages using 7 workers (76/76) in 636ms
Finalizing page optimization in 45ms

All 76 routes generated cleanly with 0 errors.
```

### E. Live HTTP Integration & End-to-End Suite (`scratch/test-http-e2e.ts`)
```
=== RUNNING HTTP API INTEGRATION TESTS ===
[HTTP] Testing GET /api/team...
✔ GET /api/team returned 29 members
✔ Safe member fields confirmed: hasPassword=true, status=PASSWORD_SET

[HTTP] Testing POST /api/team (create employee)...
✔ Member created successfully with canonical setup link [TOKEN REDACTED]

[HTTP] Testing POST /api/team/[id]/invite (regenerate setup link)...
✔ Setup link generated successfully with canonical APP_URL [TOKEN REDACTED]
✔ Prior setup token invalidated

[HTTP] Testing password validation on /api/auth/setup (< 12 chars)...
✔ Password setup rejected < 12 characters with 400

[HTTP] Testing password setup with >= 12 chars...
✔ Password setup completed successfully
✔ Session cookie received from setup

[HTTP] Verifying setup link cannot be generated once password is set...
✔ Endpoint rejected with 400: "This employee already has an account password and can sign in directly"

[HTTP] Testing POST /api/auth/login with new credentials...
✔ Login successful with individual credentials

[HTTP] Testing individual password change via PATCH /api/profile...
✔ Profile password change rejected incorrect current password with 403
✔ Profile password change rejected new password < 12 chars with 400
✔ Profile password change succeeded with 200 OK

[HTTP] Verifying login with updated password...
✔ Old password rejected; new password authenticated successfully

[Cleanup] Removing E2E test user...
✔ Cleaned up test user

=== ALL HTTP INTEGRATION TESTS PASSED ===
```

---

## 6. Production Isolation Verification

| Check | Production Target | Result | Status |
| :--- | :--- | :--- | :--- |
| **Database Identity** | `company_os` | Verified via `SELECT current_database()` | **VERIFIED** |
| **Database Writes** | `company_os` | 0 migrations, 0 schema changes, exactly 1 user preserved | **UNTOUCHED** |
| **Project Files** | `/Users/tanveersinghsaini/Desktop/locally hosted app` | 0 files modified in the past 2 hours | **UNTOUCHED** |
| **Application Process** | Port 3000 (PID 58373) | Running uninterrupted | **UNTOUCHED** |
| **Secret Redaction** | Console logs and test reports | Setup tokens redacted (`[TOKEN REDACTED]`) | **SECURE** |

---

## 7. Sign-Off & Conclusion

The production `APP_URL` fail-closed correction is complete, robustly tested, and fully hardened. The Cyraops application safely prevents insecure HTTP invitation generation in production environments while preserving all necessary development and local-network capabilities.

