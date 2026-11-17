#!/bin/bash
# ==============================================================================
# Cyraops Company OS — Automated Database & Uploads Backup Routine
# Safe, verified, atomic snapshot script for development environment.
# ==============================================================================
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"
BACKUP_DIR="${PROJECT_ROOT}/backups"
LOG_FILE="${BACKUP_DIR}/backup.log"
LOCK_DIR="/tmp/cyraops_company_os_dev_backup.lockdir"
TIMESTAMP="$(date +"%Y%m%d_%H%M%S")"

# 1. Concurrency control: prevent overlapping executions using atomic lock directory
if ! mkdir "${LOCK_DIR}" 2>/dev/null; then
  echo "[$(date '+%Y-%m-%d %H:%M:%S')] Another backup process is currently running. Exiting." >&2
  exit 1
fi
trap 'rm -rf "${LOCK_DIR}"' EXIT

# Ensure backup directory exists with restricted permissions (0700)
mkdir -p "${BACKUP_DIR}"
chmod 700 "${BACKUP_DIR}"

log() {
  local msg="[$(date '+%Y-%m-%d %H:%M:%S')] $1"
  echo "$msg"
  echo "$msg" >> "${LOG_FILE}"
}

error_exit() {
  local msg="[$(date '+%Y-%m-%d %H:%M:%S')] ERROR: $1"
  echo "$msg" >&2
  echo "$msg" >> "${LOG_FILE}"
  exit 1
}

log "Starting Cyraops backup routine (Timestamp: ${TIMESTAMP})..."

# 2. Database Identity Verification
EXPECTED_DB="company_os_dev"
ACTIVE_DB=$(PGHOST=localhost PGPORT=5432 PGDATABASE="${EXPECTED_DB}" psql -v ON_ERROR_STOP=1 -t -A -c "SELECT current_database();")
if [[ "${ACTIVE_DB}" != "${EXPECTED_DB}" ]]; then
  error_exit "Database identity verification failed. Expected '${EXPECTED_DB}', got '${ACTIVE_DB}'. Aborting."
fi

SERVER_PORT=$(PGHOST=localhost PGPORT=5432 PGDATABASE="${EXPECTED_DB}" psql -v ON_ERROR_STOP=1 -t -A -c "SELECT inet_server_port();")
if [[ "${SERVER_PORT}" != "5432" ]]; then
  error_exit "Database port verification failed. Expected 5432, got '${SERVER_PORT}'. Aborting."
fi

log "Database identity verified: ${ACTIVE_DB} on local port 5432."

# Define file paths
TMP_DUMP="${BACKUP_DIR}/.tmp_${TIMESTAMP}.dump"
FINAL_DUMP="${BACKUP_DIR}/company_os_dev_${TIMESTAMP}.dump"
TMP_UPLOADS="${BACKUP_DIR}/.tmp_${TIMESTAMP}_uploads.tar.gz"
FINAL_UPLOADS="${BACKUP_DIR}/company_os_dev_${TIMESTAMP}_uploads.tar.gz"
FINAL_MANIFEST="${BACKUP_DIR}/company_os_dev_${TIMESTAMP}.manifest"

# Cleanup temporary files on exit if failed
cleanup_tmp() {
  rm -f "${TMP_DUMP}" "${TMP_UPLOADS}"
  rm -rf "${LOCK_DIR}"
}
trap cleanup_tmp EXIT

# 3. Database Snapshot (PostgreSQL custom format .dump)
log "Dumping database '${EXPECTED_DB}' to temporary archive..."
PGHOST=localhost PGPORT=5432 PGDATABASE="${EXPECTED_DB}" pg_dump -F c -b -f "${TMP_DUMP}"

# Verify database dump integrity using pg_restore --list
log "Verifying database dump integrity with pg_restore --list..."
if ! pg_restore --list "${TMP_DUMP}" > /dev/null 2>&1; then
  error_exit "Database dump verification failed. Archive is corrupt or incomplete."
fi
log "Database dump integrity verified."

# 4. User-Uploaded Files Snapshot (LocalFilesystemStorage ./uploads)
UPLOADS_DIR="${PROJECT_ROOT}/uploads"
if [[ -d "${UPLOADS_DIR}" ]]; then
  log "Archiving uploaded files from ${UPLOADS_DIR}..."
  tar -czf "${TMP_UPLOADS}" -C "${PROJECT_ROOT}" "uploads"

  # Verify tarball listing
  if ! tar -tzf "${TMP_UPLOADS}" > /dev/null 2>&1; then
    error_exit "Uploads archive verification failed. Archive is corrupt or unreadable."
  fi
  log "Uploads archive verified."
else
  log "Uploads directory ${UPLOADS_DIR} not found; creating empty archive..."
  tar -czf "${TMP_UPLOADS}" --files-from /dev/null
fi

# 5. Finalize Backup Set Atomically
mv "${TMP_DUMP}" "${FINAL_DUMP}"
chmod 600 "${FINAL_DUMP}"

mv "${TMP_UPLOADS}" "${FINAL_UPLOADS}"
chmod 600 "${FINAL_UPLOADS}"

# Generate SHA-256 checksum manifest
(
  cd "${BACKUP_DIR}"
  shasum -a 256 "$(basename "${FINAL_DUMP}")" "$(basename "${FINAL_UPLOADS}")" > "${FINAL_MANIFEST}"
)
chmod 600 "${FINAL_MANIFEST}"

log "Backup set finalized successfully:"
log "  - Database Dump: ${FINAL_DUMP}"
log "  - Uploads Archive: ${FINAL_UPLOADS}"
log "  - Checksum Manifest: ${FINAL_MANIFEST}"

# 6. Retention Policy: Retain at least 14 days of verified backups
log "Pruning completed backups older than 14 days..."
find "${BACKUP_DIR}" -maxdepth 1 -name "company_os_dev_*.dump" -mtime +14 -delete || true
find "${BACKUP_DIR}" -maxdepth 1 -name "company_os_dev_*_uploads.tar.gz" -mtime +14 -delete || true
find "${BACKUP_DIR}" -maxdepth 1 -name "company_os_dev_*.manifest" -mtime +14 -delete || true

log "Backup routine completed successfully."
echo "BACKUP_TIMESTAMP=${TIMESTAMP}"
echo "BACKUP_DUMP=${FINAL_DUMP}"
echo "BACKUP_UPLOADS=${FINAL_UPLOADS}"
echo "BACKUP_MANIFEST=${FINAL_MANIFEST}"
exit 0

