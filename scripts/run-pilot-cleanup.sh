#!/bin/bash
# ==============================================================================
# Cyraops Company OS — Pre-Pilot Synthetic Data Cleanup Orchestrator
# Authoritative single executable entrypoint for the 12-stage cleanup sequence.
# Enforces fail-fast error traps, explicit human authorization gates,
# deterministic locking, independent verification, and rollback safeguards.
#
# MANDATORY SEQUENCE:
#   1. Verify dev environment & database identity
#   2. Create & verify pre-cleanup backup
#   3. Safely stop dev server & confirmed dev workers
#   4. Verify dev port 3001 is free & inspect production port 3000
#   [GATE A: Human Confirmation -> 'PURGE company_os_dev']
#   5. Run database cleanup SQL transaction
#   6. Run independent read-only SQL post-verification
#   [GATE B: Human Confirmation -> 'QUARANTINE 34 DEV FILES']
#   7. Quarantine 34 manifest-listed synthetic files
#   8. Verify quarantine completion manifest and checksums
#   9. Verify uploads directory inventory
#   10. Create & verify post-cleanup baseline backup
#   11. Restart development server explicitly on port 3001 (development mode)
#   12. Run automated health sign-off (public / auth gates)
# ==============================================================================
set -Eeuo pipefail
trap 'echo "[ERROR] Pipeline aborted at line $LINENO with exit code $?" >&2; exit 1' ERR

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"
cd "${PROJECT_ROOT}"

EXPECTED_DB="company_os_dev"
DEV_PORT=3001
PROD_PORT=3000
EXPECTED_PROD_DIR="/Users/tanveersinghsaini/Desktop/locally hosted app"

echo "=============================================================================="
echo "CYRAOPS BUSINESS LAUNCH PRE-PILOT CLEANUP ORCHESTRATOR"
echo "Target Project:  ${PROJECT_ROOT}"
echo "Target Database: ${EXPECTED_DB} on localhost:5432"
echo "Target Port:     ${DEV_PORT}"
echo "=============================================================================="

# ==============================================================================
# STAGE 1: Verify Development Environment and Database Identity
# ==============================================================================
echo -e "\n>>> [STAGE 1/12] Verifying development environment and database identity..."
python3 scripts/verify-db-identity.py

# Assert connection explicitly resolves to loopback (127.0.0.1 or ::1) on port 5432
DB_IDENTITY_OK=$(psql -h localhost -p 5432 -d "${EXPECTED_DB}" -v ON_ERROR_STOP=1 -t -A -c "
  SELECT current_database() = '${EXPECTED_DB}'
     AND inet_server_port() = 5432
     AND inet_server_addr() IN ('127.0.0.1'::inet, '::1'::inet);
")
if [ "${DB_IDENTITY_OK}" != "t" ]; then
  echo "[STAGE 1 FATAL] Live PostgreSQL connection is not ${EXPECTED_DB} on loopback port 5432." >&2
  exit 1
fi

test -d uploads || { echo "[STAGE 1 FATAL] uploads/ directory missing!" >&2; exit 1; }
test -f docs/business-launch/purge-file-manifest.json || { echo "[STAGE 1 FATAL] purge-file-manifest.json missing!" >&2; exit 1; }
echo "[STAGE 1 PASSED] Environment and database identity confirmed on loopback localhost:5432."

# ==============================================================================
# STAGE 2: Create and Verify Pre-Cleanup Backup
# ==============================================================================
echo -e "\n>>> [STAGE 2/12] Creating and cryptographically verifying pre-cleanup backup..."
PRE_BACKUP_LOG=$(mktemp -t cyraops_pre_backup)
bash scripts/backup-db.sh | tee "${PRE_BACKUP_LOG}"
python3 scripts/verify-backup-artifacts.py --backup-output-file "${PRE_BACKUP_LOG}"
rm -f "${PRE_BACKUP_LOG}"
echo "[STAGE 2 PASSED] Pre-cleanup backup created, archive catalog verified, and SHA-256 confirmed."

# ==============================================================================
# STAGE 3: Safely Stop Development Server and Confirmed Development Workers
# ==============================================================================
echo -e "\n>>> [STAGE 3/12] Safely stopping development server..."
bash scripts/safe-dev-shutdown.sh
echo "[STAGE 3 PASSED] Development shutdown verified."

# ==============================================================================
# STAGE 4: Verify Development Port 3001 is Free & Inspect Production Port 3000
# ==============================================================================
echo -e "\n>>> [STAGE 4/12] Verifying port 3001 is free and inspecting production port 3000..."
if lsof -nP -iTCP:${DEV_PORT} -sTCP:LISTEN >/dev/null 2>&1; then
  DEV_OCCUPIER=$(lsof -nP -iTCP:${DEV_PORT} -sTCP:LISTEN -Fp | grep '^p' | sed 's/^p//')
  echo "[STAGE 4 FATAL] Port ${DEV_PORT} is still occupied by PID ${DEV_OCCUPIER}! Aborting." >&2
  exit 1
fi
echo "Port ${DEV_PORT} confirmed free."

PROD_PIDS=($(lsof -nP -iTCP:${PROD_PORT} -sTCP:LISTEN -Fp 2>/dev/null | grep '^p' | sed 's/^p//' || true))
if [ ${#PROD_PIDS[@]} -eq 0 ]; then
  echo "[STAGE 4 WARNING] No process listening on production port ${PROD_PORT} (Production server is offline)."
elif [ ${#PROD_PIDS[@]} -gt 1 ]; then
  echo "[STAGE 4 WARNING] Multiple processes listening on production port ${PROD_PORT}: ${PROD_PIDS[*]}" >&2
else
  PROD_OCCUPIER="${PROD_PIDS[0]}"
  PROD_CWD=$(lsof -a -p "${PROD_OCCUPIER}" -d cwd -Fn 2>/dev/null | grep '^n' | sed 's/^n//' || true)
  PROD_CMD=$(ps -p "${PROD_OCCUPIER}" -o command= 2>/dev/null || true)
  if [ "${PROD_CWD}" = "${EXPECTED_PROD_DIR}" ]; then
    echo "[STAGE 4] Confirmed production listener on port ${PROD_PORT}:"
    echo "  PID:       ${PROD_OCCUPIER}"
    echo "  CWD:       ${PROD_CWD}"
    echo "  Command:   ${PROD_CMD}"
    echo "  Isolation: Confirmed running expected production application. Will not be signaled or modified."
  else
    echo "[STAGE 4 WARNING] Unexpected listener on production port ${PROD_PORT}:" >&2
    echo "  PID:       ${PROD_OCCUPIER}" >&2
    echo "  CWD:       '${PROD_CWD}' (expected '${EXPECTED_PROD_DIR}')" >&2
    echo "  Command:   '${PROD_CMD}'" >&2
    echo "  Isolation: Dev scripts will NOT signal or modify this process." >&2
  fi
fi
echo "[STAGE 4 PASSED] Port isolation positively verified."

# ==============================================================================
# HUMAN AUTHORIZATION GATE A: DATABASE PURGE
# ==============================================================================
echo ""
echo "=============================================================================="
echo "HUMAN AUTHORIZATION GATE A: DATABASE CLEANUP COMMIT"
echo "=============================================================================="
echo "Target Database: ${EXPECTED_DB} (localhost:5432)"
echo "Exact Operation: Deletion of 29 synthetic User accounts, 34 synthetic InvoiceRecords,"
echo "                 associated synthetic tasks, activities, call records, and cost logs."
echo "Retained State:  Founder User (tanveer@cyraops.com), Workspace 'main', Project 'General Operations',"
echo "                 system taxonomies, demo portfolio cards, and Founder mailbox."
echo "=============================================================================="
echo "To proceed with committing database cleanup, you must type the exact phrase:"
echo "  PURGE company_os_dev"
echo ""
read -r -p "Enter authorization phrase: " CONFIRM_GATE_A
if [ "${CONFIRM_GATE_A}" != "PURGE company_os_dev" ]; then
  echo "" >&2
  echo "[ABORT] Authorization Gate A failed: expected 'PURGE company_os_dev', received '${CONFIRM_GATE_A}'." >&2
  echo "[ABORT] Database cleanup halted. No database changes were made." >&2
  exit 1
fi
echo "[GATE A ACCEPTED] Operator authorized database cleanup."

# ==============================================================================
# STAGE 5: Run Database Cleanup SQL Transaction
# ==============================================================================
echo -e "\n>>> [STAGE 5/12] Executing atomic database cleanup SQL transaction..."
psql -h localhost -p 5432 -d "${EXPECTED_DB}" -X -v ON_ERROR_STOP=1 \
  -f docs/business-launch/clean-dev-database.sql
echo "[STAGE 5 PASSED] Database cleanup SQL transaction committed successfully."

# ==============================================================================
# STAGE 6: Run Independent Read-Only SQL Post-Verification
# ==============================================================================
echo -e "\n>>> [STAGE 6/12] Running independent read-only SQL verification suite..."
psql -h localhost -p 5432 -d "${EXPECTED_DB}" -X -v ON_ERROR_STOP=1 \
  -f docs/business-launch/verify-clean-dev-database.sql
echo "[STAGE 6 PASSED] Independent SQL post-verification passed 100% of assertions."

# ==============================================================================
# HUMAN AUTHORIZATION GATE B: FILE QUARANTINE
# ==============================================================================
echo ""
echo "=============================================================================="
echo "HUMAN AUTHORIZATION GATE B: SYNTHETIC UPLOAD FILE QUARANTINE"
echo "=============================================================================="
echo "Target Directory:   ${PROJECT_ROOT}/uploads"
echo "Destination:        ${PROJECT_ROOT}/backups/quarantine_<TIMESTAMP>"
echo "Exact Operation:    Moving exactly 34 manifest-listed synthetic invoice files to quarantine."
echo "Prerequisites Met:  Database cleanup committed (Stage 5) and SQL verified (Stage 6)."
echo "=============================================================================="
echo "To proceed with moving upload files to quarantine, you must type the exact phrase:"
echo "  QUARANTINE 34 DEV FILES"
echo ""
read -r -p "Enter authorization phrase: " CONFIRM_GATE_B
if [ "${CONFIRM_GATE_B}" != "QUARANTINE 34 DEV FILES" ]; then
  echo "" >&2
  echo "[ABORT] Authorization Gate B failed: expected 'QUARANTINE 34 DEV FILES', received '${CONFIRM_GATE_B}'." >&2
  echo "[ABORT] File quarantine halted. All 34 upload files remain in uploads/." >&2
  echo "[NOTE] Database has been cleaned, but files have NOT been moved. Preserve upload files." >&2
  exit 1
fi
echo "[GATE B ACCEPTED] Operator authorized synthetic file quarantine."

# ==============================================================================
# STAGE 7: Quarantine 34 Manifest-Listed Files
# ==============================================================================
QUARANTINE_TS=$(date +%Y%m%d_%H%M%S)
QUARANTINE_DIR="${PROJECT_ROOT}/backups/quarantine_${QUARANTINE_TS}"
echo -e "\n>>> [STAGE 7/12] Quarantining 34 manifest-listed files to ${QUARANTINE_DIR}..."

if ! python3 scripts/quarantine-synthetic-files.py --action quarantine --dest-dir "${QUARANTINE_DIR}"; then
  echo "" >&2
  echo "==============================================================================" >&2
  echo "[STAGE 7 FATAL] SYNTHETIC FILE QUARANTINE ENCOUNTERED AN ERROR" >&2
  echo "==============================================================================" >&2
  echo "Database cleanup (Stage 5) and SQL verification (Stage 6) were already committed." >&2
  echo "Quarantine failed. Guarded rollback has attempted to restore partially moved files." >&2
  echo "CRITICAL SAFETY DIRECTIVE:" >&2
  echo "  - Do NOT attempt to restore the committed database via untested procedures." >&2
  echo "  - All upload files must be preserved in their current locations." >&2
  echo "  - Investigate the quarantine error output and uploads/ directory manually." >&2
  echo "  - Current state: Database cleaned, upload files preserved." >&2
  echo "==============================================================================" >&2
  exit 1
fi
echo "[STAGE 7 PASSED] Exactly 34 synthetic invoice files moved to quarantine."

# ==============================================================================
# STAGE 8: Verify Quarantine Completion Manifest and Checksums
# ==============================================================================
echo -e "\n>>> [STAGE 8/12] Verifying quarantine completion manifest and checksums..."
python3 scripts/verify-quarantine-artifacts.py \
  --quarantine-dir "${QUARANTINE_DIR}" \
  --manifest docs/business-launch/purge-file-manifest.json
echo "[STAGE 8 PASSED] Quarantine completion manifest and artifacts verified."

# ==============================================================================
# STAGE 9: Verify Uploads Directory Inventory
# ==============================================================================
echo -e "\n>>> [STAGE 9/12] Verifying uploads directory inventory..."
python3 -c "
import os, json, sys

with open('docs/business-launch/purge-file-manifest.json', 'r', encoding='utf-8') as f:
    manifest = json.load(f)

for item in manifest['files']:
    p = os.path.join('uploads', item['fileKey'])
    if os.path.exists(p):
        sys.exit(f'FATAL: Manifest file still present in uploads: {p}')

print('Confirmed: Zero synthetic invoice files remain in uploads/.')
"
echo "[STAGE 9 PASSED] Uploads directory inventory verified pristine."

# ==============================================================================
# STAGE 10: Create and Verify Post-Cleanup Baseline Backup
# ==============================================================================
echo -e "\n>>> [STAGE 10/12] Creating and cryptographically verifying post-cleanup baseline backup..."
POST_BACKUP_LOG=$(mktemp -t cyraops_post_backup)
bash scripts/backup-db.sh | tee "${POST_BACKUP_LOG}"
python3 scripts/verify-backup-artifacts.py --backup-output-file "${POST_BACKUP_LOG}"
rm -f "${POST_BACKUP_LOG}"
echo "[STAGE 10 PASSED] Post-cleanup baseline backup created, catalog verified, and SHA-256 confirmed."

# ==============================================================================
# STAGE 11: Restart Development Server Explicitly on Port 3001 (Dev Mode)
# ==============================================================================
echo -e "\n>>> [STAGE 11/12] Restarting development server on port ${DEV_PORT} in development mode..."

# Assert production port 3000 isolation before launch
PROD_PID=""
PROD_PIDS=($(lsof -nP -iTCP:${PROD_PORT} -sTCP:LISTEN -Fp 2>/dev/null | grep '^p' | sed 's/^p//' || true))
if [ ${#PROD_PIDS[@]} -gt 0 ]; then
  PROD_PID="${PROD_PIDS[0]}"
  PROD_CWD=$(lsof -a -p "${PROD_PID}" -d cwd -Fn 2>/dev/null | grep '^n' | sed 's/^n//' || true)
  echo "[STAGE 11] Production server confirmed active on port ${PROD_PORT} (PID ${PROD_PID}, CWD '${PROD_CWD}') - strictly isolated."
else
  echo "[STAGE 11 WARNING] No production server detected on port ${PROD_PORT}."
fi

# Ensure port 3001 is completely free
if lsof -nP -iTCP:${DEV_PORT} -sTCP:LISTEN >/dev/null 2>&1; then
  echo "[STAGE 11 FATAL] Port ${DEV_PORT} is already occupied! Refusing to start duplicate server." >&2
  exit 1
fi

cd "${PROJECT_ROOT}"
PORT=${DEV_PORT} NODE_ENV=development nohup npx tsx server.ts > dev-server.log 2>&1 &
DEV_LAUNCH_PID=$!
echo "Development server process launched (PID ${DEV_LAUNCH_PID}). Waiting up to 30s for port ${DEV_PORT}..."

# Bounded wait for port 3001 (up to 30s)
BOUNDED_TIMEOUT=30
ELAPSED=0
PORT_BOUND=false
while [ "${ELAPSED}" -lt "${BOUNDED_TIMEOUT}" ]; do
  if lsof -nP -iTCP:${DEV_PORT} -sTCP:LISTEN >/dev/null 2>&1; then
    PORT_BOUND=true
    break
  fi
  sleep 1
  ELAPSED=$((ELAPSED + 1))
done

if [ "${PORT_BOUND}" != "true" ]; then
  echo "[STAGE 11 FATAL] Server failed to bind port ${DEV_PORT} within ${BOUNDED_TIMEOUT}s! Check dev-server.log." >&2
  exit 1
fi

# Verify actual listener PID and working directory
ACTUAL_LISTENER_PID=$(lsof -nP -iTCP:${DEV_PORT} -sTCP:LISTEN -Fp | grep '^p' | sed 's/^p//')
if [ -z "${ACTUAL_LISTENER_PID}" ]; then
  echo "[STAGE 11 FATAL] Unable to determine listener PID on port ${DEV_PORT}!" >&2
  exit 1
fi

ACTUAL_CWD=$(lsof -a -p "${ACTUAL_LISTENER_PID}" -d cwd -Fn 2>/dev/null | grep '^n' | sed 's/^n//')
if [ "${ACTUAL_CWD}" != "${PROJECT_ROOT}" ]; then
  echo "[STAGE 11 FATAL] Listener PID ${ACTUAL_LISTENER_PID} has unexpected CWD: '${ACTUAL_CWD}'! Expected '${PROJECT_ROOT}'." >&2
  exit 1
fi

if [ -n "${PROD_PID}" ] && [ "${ACTUAL_LISTENER_PID}" = "${PROD_PID}" ]; then
  echo "[STAGE 11 FATAL] CRITICAL CONFLICT: Development listener PID equals production PID ${PROD_PID}!" >&2
  exit 1
fi

echo "[STAGE 11 PASSED] Development server running on port ${DEV_PORT} (PID ${ACTUAL_LISTENER_PID}, CWD verified)."

# ==============================================================================
# STAGE 12: Automated Health Checks & Operator Sign-Off Handoff
# ==============================================================================
echo -e "\n>>> [STAGE 12/12] Running automated application health and auth-gate sign-off..."
python3 scripts/verify-app-health.py --unauthenticated-only
echo "[STAGE 12 PASSED] Automated health and auth gate checks passed."

echo ""
echo "=============================================================================="
echo "CYRAOPS BUSINESS LAUNCH PRE-PILOT CLEANUP COMPLETED SUCCESSFULLY"
echo "=============================================================================="
echo "All 12 automated stages passed. Database primed and uploads cleaned."
echo ""
echo "NEXT OPERATOR ACTIONS:"
echo "  1. Authenticated API Verification:"
echo "     python3 scripts/verify-app-health.py --interactive-auth"
echo ""
echo "  2. Visual UI Verification Checklist:"
echo "     Follow docs/business-launch/CYRAOPS_FINAL_OPERATOR_CHECKLIST.md"
echo "=============================================================================="
