# CYRAOPS — FINAL PRE-PILOT OPERATOR EXECUTION CHECKLIST
**Authoritative Operational Runbook, Dual-Gate Execution Protocol, Rollback Boundaries & Final Sign-Off Standards**
**Document Date:** November 7, 2026  
**Target Environment:** Development Project (`/Users/tanveersinghsaini/Desktop/locally hosted app dev`)  
**Target Database:** `company_os_dev` (`localhost:5432`) | **Dev Server:** `http://localhost:3001`  
**Production Boundary:** `company_os` (`localhost:5432`) & `http://localhost:3000` (STRICTLY READ-ONLY INSPECTED / ZERO WRITES)  
**Single Authoritative Orchestrator:** [`scripts/run-pilot-cleanup.sh`](file:///Users/tanveersinghsaini/Desktop/locally%20hosted%20app%20dev/scripts/run-pilot-cleanup.sh)  
**Status:** READY FOR HUMAN AUTHORIZATION (CLEANUP NOT EXECUTED)

---

## 1. PRE-EXECUTION OPERATIONAL BOUNDARIES

> [!IMPORTANT]
> **ABSOLUTE OPERATIONAL INVARIANTS:**
> 1. **Single Authoritative Execution Entrypoint:**
>    All destructive cleanup stages must be executed exclusively through the orchestrator:
>    ```bash
>    cd "/Users/tanveersinghsaini/Desktop/locally hosted app dev"
>    bash scripts/run-pilot-cleanup.sh
>    ```
>    Do not execute cleanup stages by manually copy-pasting shell fragments. Running stages manually introduces variable drift, misses intermediate traps, and bypasses atomic safety guards.
> 2. **Development Target Only:** All cleanup, file quarantine, and process restart operations apply exclusively to `locally hosted app dev` and database `company_os_dev`.
> 3. **Production Isolation:** Production database `company_os`, production code `/Users/tanveersinghsaini/Desktop/locally hosted app`, and production port `3000` must remain completely untouched. No DDL, write operations, or process signals may ever target production.
> 4. **External Supervisor Pre-Condition:** The development server is currently managed as a background task (`task-8962`) by the Antigravity agent runner (`agy` PID `50866`). Because external supervisor respawn behavior cannot be established without guessing, **the operator must stop the development task through the Antigravity task manager or UI stop button before triggering the cleanup orchestrator**.
> 5. **No Blanket Shell Wildcards:** All file and record operations are explicitly governed by audited manifests ([`purge-file-manifest.json`](file:///Users/tanveersinghsaini/Desktop/locally%20hosted%20app%20dev/docs/business-launch/purge-file-manifest.json) and [`clean-dev-database.sql`](file:///Users/tanveersinghsaini/Desktop/locally%20hosted%20app%20dev/docs/business-launch/clean-dev-database.sql)).

---

## 2. THE MANDATORY 12-STAGE EXECUTION SEQUENCE

The pre-pilot cleanup sequence executed by [`scripts/run-pilot-cleanup.sh`](file:///Users/tanveersinghsaini/Desktop/locally%20hosted%20app%20dev/scripts/run-pilot-cleanup.sh) enforces this exact order:

```
[STAGE 1]  Verify Development Environment & Database Identity (localhost:5432)
   │
[STAGE 2]  Create & Cryptographically Verify Pre-Cleanup Backup
   │
[STAGE 3]  Safely Stop Development Server (Confirm Antigravity Task Stopped)
   │
[STAGE 4]  Verify Port 3001 Free & Inspect Production Port 3000 Listener
   │
   ▼
[GATE A]   HUMAN AUTHORIZATION GATE: Operator types 'PURGE company_os_dev'
   │
[STAGE 5]  Execute Atomic Database Cleanup SQL Transaction (52-table lock)
   │
[STAGE 6]  Execute Independent Read-Only SQL Post-Verification Suite
   │
   ▼
[GATE B]   HUMAN AUTHORIZATION GATE: Operator types 'QUARANTINE 34 DEV FILES'
   │
[STAGE 7]  Quarantine 34 Manifest-Listed Files to backups/quarantine_<TS>
   │
[STAGE 8]  Verify Quarantine Completion Manifest, Sizes & SHA-256 Checksums
   │
[STAGE 9]  Verify Uploads Directory Inventory (Zero Synthetic Files Remain)
   │
[STAGE 10] Create & Cryptographically Verify Post-Cleanup Baseline Backup
   │
[STAGE 11] Restart Development Server (PORT=3001 NODE_ENV=development)
   │
[STAGE 12] Run Automated Health Sign-Off & Auth Gate Enforcement
   │
   ▼
[POST-RUN] Operator Interactive Authenticated API Verification & UI Sign-Off
```

---

## 3. DUAL HUMAN AUTHORIZATION GATES

To prevent blind or automated execution of destructive actions, two separate, non-bypassable human authorization gates are enforced. Generic confirmations (`y`, `yes`, Enter key, or flags) are strictly rejected.

### Authorization Gate A: Database Cleanup Commit
- **Placement:** Immediately before **Stage 5** (Database Cleanup).
- **Prerequisites Met:** Environment verified (Stage 1), full backup verified (Stage 2), dev server safely stopped (Stage 3), and port 3001 free (Stage 4).
- **Displayed Metadata:**
  - Target Database: `company_os_dev` on `localhost:5432`.
  - Target Scope: Deletion of exactly 29 verified synthetic User accounts, 34 synthetic InvoiceRecords, associated tasks, messages, calls, and cost logs.
  - Retained Invariant: Founder user `tanveer@cyraops.com`, Workspace `main`, Project `General Operations`, system taxonomies, and Founder mailbox.
- **Exact Required Phrase:**
  ```text
  PURGE company_os_dev
  ```
- **Abort Behavior:** If the operator enters anything other than `PURGE company_os_dev`, the orchestrator immediately halts. Zero SQL statements are executed.

### Authorization Gate B: Synthetic File Quarantine
- **Placement:** Immediately before **Stage 7** (File Quarantine).
- **Prerequisites Met:** Database cleanup committed (Stage 5) **AND** independent SQL post-verification passed 100% (Stage 6).
- **Displayed Metadata:**
  - Target Directory: `/Users/tanveersinghsaini/Desktop/locally hosted app dev/uploads/`
  - Target Destination: `/Users/tanveersinghsaini/Desktop/locally hosted app dev/backups/quarantine_<TIMESTAMP>`
  - Target Scope: Exactly 34 manifest-listed synthetic PDF invoice files.
- **Exact Required Phrase:**
  ```text
  QUARANTINE 34 DEV FILES
  ```
- **Abort Behavior:** If the operator enters anything other than `QUARANTINE 34 DEV FILES`, file quarantine is halted. All 34 upload files remain undisturbed in `uploads/`.

---

## 4. STAGE-BY-STAGE OPERATIONAL SPECIFICATIONS

### Stage 1: Environment & Database Identity Verification
- **Executed by:** `python3 scripts/verify-db-identity.py` and `psql` loopback assertion.
- **Checks:** Validates configured `.env` `DATABASE_URL` matches active PostgreSQL connection on `localhost:5432` for `company_os_dev`.
- **Loopback Assertion:** Verifies `inet_server_addr() in ('127.0.0.1'::inet, '::1'::inet)`.

### Stage 2: Pre-Cleanup Verified Backup
- **Executed by:** `bash scripts/backup-db.sh` & `python3 scripts/verify-backup-artifacts.py`.
- **Validation:**
  - Database custom dump (`pg_dump -F c`).
  - Uploads tarball (`tar -czf`).
  - SHA-256 checksum manifest.
  - Tested via `pg_restore --list`.
  - Restrictive permissions: `0600` on files, `0700` on backup directory.

### Stage 3: Safe Development Server Shutdown
- **Pre-requisite:** Stop `task-8962` via Antigravity task manager.
- **Executed by:** `bash scripts/safe-dev-shutdown.sh`.
- **Checks:** Asserts single listener on port 3001, verifies dev project CWD containment for all processes in PGID, ensures production port 3000 is isolated. If supervisor respawn cannot be guaranteed (e.g. `agy`), script aborts fail-closed until task is stopped.

### Stage 4: Port 3001 Free & Production Port 3000 Inspection
- **Executed by:** `run-pilot-cleanup.sh`.
- **Checks:** Confirms port 3001 is completely free. Inspects port 3000 listener without signaling it: verifies PID, verifies CWD equals `/Users/tanveersinghsaini/Desktop/locally hosted app`, verifies process command, and reports accurately if missing, unexpected, or isolated.

### [GATE A] Operator Authorization
- Operator types `PURGE company_os_dev`.

### Stage 5: Atomic Database Purge Transaction
- **Executed by:** `psql -h localhost -p 5432 -d company_os_dev -f docs/business-launch/clean-dev-database.sql`.
- **Mechanics:**
  - Acquires deterministic alphabetical `EXCLUSIVE MODE` locks on all 52 tables with bounded 5s timeout.
  - Asserts all pre-flight primary-key array sets using null-safe `IS DISTINCT FROM`.
  - Purges synthetic data across all 38 test tables.
  - Asserts post-cleanup invariants before committing.

### Stage 6: Independent Read-Only SQL Verification
- **Executed by:** `psql -h localhost -p 5432 -d company_os_dev -f docs/business-launch/verify-clean-dev-database.sql`.
- **Mechanics:** Executes inside a read-only transaction (`SET TRANSACTION READ ONLY;`). Queries all 38 tables and retained records. Raises `EXCEPTION` on any drift.

### [GATE B] Operator Authorization
- Operator types `QUARANTINE 34 DEV FILES`.

### Stage 7: Fail-Safe File Quarantine
- **Executed by:** Orchestrated internally by [`scripts/run-pilot-cleanup.sh`](file:///Users/tanveersinghsaini/Desktop/locally%20hosted%20app%20dev/scripts/run-pilot-cleanup.sh) Stage 7. Do NOT execute manually.
- **Engine:** [`scripts/quarantine-synthetic-files.py`](file:///Users/tanveersinghsaini/Desktop/locally%20hosted%20app%20dev/scripts/quarantine-synthetic-files.py) with `--action quarantine --dest-dir "${QUARANTINE_DIR}"`.
- **Mechanics:** Verifies all 34 files pre-move (sizes and SHA-256), creates secure destination directory (mode 0700), moves files, verifies post-move existence and checksums, and emits `quarantine-completion-manifest.json` (mode 0600) using the authoritative `fileSizeBytes` schema.
- **Rollback:** If any error occurs, automatic guarded rollback restores partially moved files.

### Stage 8: Verify Quarantine Completion Manifest & Checksums
- **Executed by:** Orchestrated internally by [`scripts/run-pilot-cleanup.sh`](file:///Users/tanveersinghsaini/Desktop/locally%20hosted%20app%20dev/scripts/run-pilot-cleanup.sh) Stage 8.
- **Validation Engine:** [`scripts/verify-quarantine-artifacts.py`](file:///Users/tanveersinghsaini/Desktop/locally%20hosted%20app%20dev/scripts/verify-quarantine-artifacts.py).
- **Checks:**
  - Confirms `quarantine-completion-manifest.json` exists and validates strict schema typing (`invoiceRecordId`, `fileKey`, `fileName`, `fileSizeBytes`, `sha256`, `sourcePath`).
  - Verifies both `purge-file-manifest.json` and completion manifest contain exactly 34 unique keys.
  - Confirms identical key set and metadata between manifests.
  - Confirms exactly 34 files exist in destination directory (excluding manifest).
  - Recalculates on-disk SHA-256 and asserts exact size (`fileSizeBytes`) and digest match for all 34 files across both manifests and disk.
  - Fails closed with non-zero exit code on any mismatch.

### Stage 9: Uploads Inventory Verification
- Asserts zero synthetic invoice files remain in `/Users/tanveersinghsaini/Desktop/locally hosted app dev/uploads/`.

### Stage 10: Post-Cleanup Baseline Backup
- **Executed by:** `bash scripts/backup-db.sh` & `python3 scripts/verify-backup-artifacts.py`.
- Creates and cryptographically verifies the clean baseline backup representing the pristine state for the business pilot.

### Stage 11: Development Server Restart
- **Execution Script:** Executed directly in Stage 11 of `run-pilot-cleanup.sh`:
  ```bash
  cd "/Users/tanveersinghsaini/Desktop/locally hosted app dev"
  PORT=3001 NODE_ENV=development nohup npx tsx server.ts > dev-server.log 2>&1 &
  # Bounded wait loop up to 30s
  # Verifies listener PID on port 3001
  # Verifies listener CWD == dev project root
  # Verifies listener PID != production PID
  # Exits non-zero on any failure
  ```

### Stage 12: Automated Health Sign-Off
- **Executed by:** `python3 scripts/verify-app-health.py --unauthenticated-only`.
- **Verification:** Verifies server process running, `/api/health` 200 OK + `{"status":"ok","database":"connected"}`, `/login` 200 OK, and `/api/workspace` 401 Unauthorized auth gate.

---

## 5. ROLLBACK AND RECOVERY BOUNDARIES

| Failure Point | System State | Recovery Protocol |
| :--- | :--- | :--- |
| **Stage 1–4 Failure** | Zero DB changes, zero files moved. | Abort immediately. Fix environment, port, or supervisor issue. Safe to retry. |
| **Gate A Abort** | Zero DB changes, zero files moved. | Abort cleanly. No recovery needed. |
| **Stage 5 Failure (SQL Purge)** | PostgreSQL transaction automatically rolls back. Zero DB mutations committed. Zero files moved. | Database state is 100% intact. Inspect failing SQL assertion. Safe to retry. |
| **Stage 6 Failure (SQL Verification)**| Database cleanup committed, but drift detected. Zero files moved. | **Do NOT quarantine files.** Database has committed changes. Operator must inspect drift or restore from Stage 2 backup using drill procedure in [`CYRAOPS_BACKUP_AND_RESTORE_DRILL.md`](file:///Users/tanveersinghsaini/Desktop/locally%20hosted%20app%20dev/docs/business-launch/CYRAOPS_BACKUP_AND_RESTORE_DRILL.md). |
| **Gate B Abort** | Database cleanup committed. Zero files moved. | Database is clean; files remain in `uploads/`. Operator can manually trigger quarantine or preserve files. |
| **Stage 7 Failure (File Quarantine)** | Database cleanup committed. Partial files moved. | `quarantine-synthetic-files.py` triggers automatic guarded rollback restoring files to `uploads/`. **Do NOT attempt untested database restore.** Files are preserved. Investigate file permissions/disk space. |
| **Stage 8–10 Failure** | Database clean, files quarantined. Baseline backup or inventory check failed. | Files are safely in quarantine directory. Check disk permissions. Re-run backup script manually. |
| **Stage 11–12 Failure** | Database clean, files quarantined. Server startup or health check failed. | Inspect `dev-server.log`. Verify port 3001 binding. Server issue is code/runtime related, not data integrity related. |

---

## 6. POST-RESTART OPERATOR SIGN-OFF PROTOCOL

### 6.1 Interactive Authenticated API Verification
To prevent session token exposure in command-line arguments, history, or log files, authenticated testing uses hidden input via Python's `getpass`:

> [!NOTE]
> **Cookie Security Handling:** The session cookie is accepted through hidden interactive prompt using Python's `getpass` module, never accepted through command-line arguments, never logged or written to disk, and its Python reference is released after use.

1. Open browser at `http://localhost:3001/login` and log in as Founder:
   - Email: `tanveer@cyraops.com`
2. Open Browser DevTools -> Application -> Cookies -> `http://localhost:3001` -> Copy `company_session` value.
3. Run the secure interactive verification tool:
   ```bash
   cd "/Users/tanveersinghsaini/Desktop/locally hosted app dev"
   python3 scripts/verify-app-health.py --interactive-auth
   ```
4. When prompted:
   ```text
   Enter Owner company_session cookie value (input hidden): [PASTE COOKIE]
   ```
   *(Input will be completely invisible. Cookie is never logged, printed, or saved).*
5. Confirm output displays all 3 authenticated checks PASSED:
   - `/api/workspace` (200 OK)
   - `/api/crm/stats` (200 OK)
   - `/api/dashboard` (200 OK)

### 6.2 Visual Browser UI Inspection Checklist
Conduct visual verification across the 12 core application views at `http://localhost:3001`:

- [ ] **1. `/dashboard`:** Renders cleanly. Shows 1 Project ("General Operations"), 0 synthetic activities, healthy system status.
- [ ] **2. `/crm`:** Zero synthetic leads, zero synthetic deals, zero synthetic proposals. Metrics show clean baseline ($0).
- [ ] **3. `/ai`:** AI Workspace loads cleanly. Zero stale conversations. System prompts and capabilities active.
- [ ] **4. `/projects`:** Exactly 1 project ("General Operations"). Zero synthetic demo projects. Owner membership intact.
- [ ] **5. `/chat`:** Zero synthetic chat channels. Ready for two-person team collaboration.
- [ ] **6. `/email`:** Founder mailbox active (`unconfigured@cyraops.com`). Exactly 7 standard folders. Zero test emails.
- [ ] **7. `/calendar`:** Zero stale synthetic calendar meetings or reminders.
- [ ] **8. `/activity`:** Exactly 1 initial activity record (workspace creation). Zero synthetic logs.
- [ ] **9. `/website`:** Portfolio management renders exactly 2 non-public, non-client demonstration cards.
- [ ] **10. `/cost`:** IT Command Center displays 33 standard categories. Zero synthetic expense or invoice records.
- [ ] **11. Team Management:** Shows exactly 1 user (Founder `tanveer@cyraops.com`, `OWNER`). "Invite Member" button functional.
- [ ] **12. Settings:** Workspace settings display ID `main` with Founder ownership intact.

---

## 7. COLLABORATOR ONBOARDING (TWO-PERSON PILOT INITIATION)

Once all 12 checklist items are checked:
1. Navigate to Team Management in the UI.
2. Click **Invite Member**.
3. Generate invitation token / link for Collaborator 2.
4. Collaborator 2 registers, verifies email/session, and confirms role assignment.
5. Confirm two users now exist in Team Management:
   - User 1: `tanveer@cyraops.com` (`OWNER`)
   - User 2: Collaborator 2 (`MEMBER` or `ADMIN`)
6. Two-person business pilot officially commences.
