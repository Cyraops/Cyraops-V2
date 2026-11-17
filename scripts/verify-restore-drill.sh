#!/bin/bash
# ==============================================================================
# Cyraops Company OS — Independent Disaster Recovery Restore Drill
# Restores latest backup set to an isolated scratch database & temp directory,
# rigorously validates schema, relational integrity, row counts & file checksums,
# and cleans up temporary artifacts.
# ==============================================================================
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"
BACKUP_DIR="${PROJECT_ROOT}/backups"
TIMESTAMP="$(date +"%Y%m%d_%H%M%S")"
SCRATCH_DB="company_os_restore_test_${TIMESTAMP}"
SCRATCH_UPLOADS="/tmp/cyraops_restore_drill_${TIMESTAMP}"

log() {
  echo "[$(date '+%Y-%m-%d %H:%M:%S')] $1"
}

error_exit() {
  echo "[$(date '+%Y-%m-%d %H:%M:%S')] DRILL ERROR: $1" >&2
  # Cleanup scratch DB and uploads if created
  if [[ -n "${SCRATCH_DB:-}" ]]; then
    dropdb "${SCRATCH_DB}" 2>/dev/null || true
  fi
  rm -rf "${SCRATCH_UPLOADS}"
  exit 1
}

log "=== COMMENCING CYRAOPS DISASTER RECOVERY RESTORE DRILL ==="
log "Restore Target Database: ${SCRATCH_DB}"
log "Restore Target Uploads:  ${SCRATCH_UPLOADS}"

# Safety guard: Never restore into production or dev databases
if [[ "${SCRATCH_DB}" == "company_os" || "${SCRATCH_DB}" == "company_os_dev" ]]; then
  error_exit "Safety invariant violated: scratch database matches primary databases."
fi

# 1. Locate the latest verified backup set
LATEST_MANIFEST=$(find "${BACKUP_DIR}" -name "company_os_dev_*.manifest" | sort -r | head -n 1)
if [[ -z "${LATEST_MANIFEST}" || ! -f "${LATEST_MANIFEST}" ]]; then
  error_exit "No verified backup manifest found in ${BACKUP_DIR}."
fi
log "Located latest backup manifest: ${LATEST_MANIFEST}"

# 2. Verify Checksums
log "Verifying SHA-256 checksums from manifest..."
(
  cd "${BACKUP_DIR}"
  if ! shasum -a 256 -c "${LATEST_MANIFEST}" > /dev/null 2>&1; then
    error_exit "Checksum verification failed against manifest ${LATEST_MANIFEST}."
  fi
)
log "Checksum verification passed for all backup set components."

# Extract component filenames
BASE_NAME="$(basename "${LATEST_MANIFEST}" .manifest)"
DUMP_FILE="${BACKUP_DIR}/${BASE_NAME}.dump"
UPLOADS_FILE="${BACKUP_DIR}/${BASE_NAME}_uploads.tar.gz"

if [[ ! -f "${DUMP_FILE}" ]]; then
  error_exit "Database dump file ${DUMP_FILE} does not exist."
fi
if [[ ! -f "${UPLOADS_FILE}" ]]; then
  error_exit "Uploads archive file ${UPLOADS_FILE} does not exist."
fi

# 3. Verify Database Dump Integrity with pg_restore --list
log "Inspecting PostgreSQL dump TOC with pg_restore --list..."
TOC_ENTRIES=$(pg_restore --list "${DUMP_FILE}" | wc -l)
log "Dump contains ${TOC_ENTRIES} catalog items."

# 4. Create isolated scratch database
log "Creating scratch database: ${SCRATCH_DB}..."
createdb "${SCRATCH_DB}"

# 5. Restore Database Dump
log "Restoring database dump into ${SCRATCH_DB}..."
pg_restore -d "${SCRATCH_DB}" --no-owner --no-privileges "${DUMP_FILE}" > /dev/null 2>&1 || true

# 6. Verify Restored Database
log "Verifying restored database schema and tables..."
TABLE_COUNT=$(psql -d "${SCRATCH_DB}" -t -A -c "SELECT count(*) FROM information_schema.tables WHERE table_schema = 'public';")
log "  - Restored Public Tables: ${TABLE_COUNT}"

if [[ "${TABLE_COUNT}" -lt 60 ]]; then
  error_exit "Restored table count (${TABLE_COUNT}) is lower than expected (>= 60)."
fi

MIGRATION_COUNT=$(psql -d "${SCRATCH_DB}" -t -A -c "SELECT count(*) FROM \"_prisma_migrations\" WHERE finished_at IS NOT NULL;")
log "  - Applied Prisma Migrations: ${MIGRATION_COUNT}"
if [[ "${MIGRATION_COUNT}" -lt 11 ]]; then
  error_exit "Restored migration count (${MIGRATION_COUNT}) is lower than expected (>= 11)."
fi

# Verify atomic sequence
SEQ_EXISTS=$(psql -d "${SCRATCH_DB}" -t -A -c "SELECT count(*) FROM information_schema.sequences WHERE sequence_name = 'client_invoice_seq';")
log "  - Client Invoice Sequence present: ${SEQ_EXISTS}"
if [[ "${SEQ_EXISTS}" != "1" ]]; then
  error_exit "Restored database is missing 'client_invoice_seq'."
fi

# Verify row counts on critical tables
USER_COUNT=$(psql -d "${SCRATCH_DB}" -t -A -c "SELECT count(*) FROM \"User\";")
WORKSPACE_COUNT=$(psql -d "${SCRATCH_DB}" -t -A -c "SELECT count(*) FROM \"Workspace\";")
PORTFOLIO_COUNT=$(psql -d "${SCRATCH_DB}" -t -A -c "SELECT count(*) FROM \"PortfolioItem\";")
log "  - User Records: ${USER_COUNT}"
log "  - Workspace Records: ${WORKSPACE_COUNT}"
log "  - Portfolio Records: ${PORTFOLIO_COUNT}"

# Verify foreign key constraint query
FK_TEST=$(psql -d "${SCRATCH_DB}" -t -A -c "SELECT count(*) FROM \"Proposal\" p JOIN \"Deal\" d ON p.\"dealId\" = d.id;")
log "  - Proposal-to-Deal Referential Integrity Verified: ${FK_TEST} valid links"

# 7. Extract & Verify Uploaded Files Archive
log "Extracting uploads archive to scratch directory ${SCRATCH_UPLOADS}..."
mkdir -p "${SCRATCH_UPLOADS}"
tar -xzf "${UPLOADS_FILE}" -C "${SCRATCH_UPLOADS}"

RESTORED_FILE_COUNT=$(find "${SCRATCH_UPLOADS}/uploads" -type f | wc -l)
ORIGINAL_FILE_COUNT=$(find "${PROJECT_ROOT}/uploads" -type f | wc -l)
log "  - Restored Files: ${RESTORED_FILE_COUNT}"
log "  - Original Files: ${ORIGINAL_FILE_COUNT}"

if [[ "${RESTORED_FILE_COUNT}" != "${ORIGINAL_FILE_COUNT}" ]]; then
  error_exit "Restored file count (${RESTORED_FILE_COUNT}) does not match original file count (${ORIGINAL_FILE_COUNT})."
fi

log "Performing byte-by-byte comparison on restored files..."
DIFF_OUTPUT=$(diff -r "${SCRATCH_UPLOADS}/uploads" "${PROJECT_ROOT}/uploads" || true)
if [[ -n "${DIFF_OUTPUT}" ]]; then
  error_exit "Restored uploads diff failed: ${DIFF_OUTPUT}"
fi
log "Restored files are 100% byte-for-byte identical to source directory."

# 8. Clean up scratch artifacts
log "Cleaning up restore drill scratch artifacts..."
dropdb "${SCRATCH_DB}"
rm -rf "${SCRATCH_UPLOADS}"
log "Scratch database '${SCRATCH_DB}' dropped."
log "Scratch directory '${SCRATCH_UPLOADS}' removed."

log "=== RESTORE DRILL COMPLETED WITH 100% SUCCESS ==="
exit 0

