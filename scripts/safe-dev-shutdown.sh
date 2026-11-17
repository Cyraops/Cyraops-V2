#!/bin/bash
# ==============================================================================
# Cyraops Company OS — Safe Development Process Shutdown
# Gracefully and safely terminates the development server and background writers
# on port 3001 without affecting production on port 3000.
# ==============================================================================
set -Eeuo pipefail

DEV_PORT=3001
PROD_PORT=3000
EXPECTED_DEV_DIR="/Users/tanveersinghsaini/Desktop/locally hosted app dev"
EXPECTED_PROD_DIR="/Users/tanveersinghsaini/Desktop/locally hosted app"
SHUTDOWN_TIMEOUT=15

echo "[SHUTDOWN] Inspecting listeners on port ${DEV_PORT}..."

# 1. Detect all listeners on port 3001
LISTENING_PIDS=($(lsof -nP -iTCP:${DEV_PORT} -sTCP:LISTEN -Fp 2>/dev/null | grep '^p' | sed 's/^p//' || true))

if [ ${#LISTENING_PIDS[@]} -eq 0 ]; then
  echo "[SHUTDOWN] No active listener found on port ${DEV_PORT}. Port is already free."
  if lsof -nP -iTCP:${PROD_PORT} -sTCP:LISTEN >/dev/null 2>&1; then
    PROD_PID=$(lsof -nP -iTCP:${PROD_PORT} -sTCP:LISTEN -Fp | grep '^p' | sed 's/^p//')
    PROD_CWD=$(lsof -a -p "${PROD_PID}" -d cwd -Fn 2>/dev/null | grep '^n' | sed 's/^n//' || true)
    echo "[SHUTDOWN CONFIRMATION] Production port ${PROD_PORT} (PID ${PROD_PID}, CWD '${PROD_CWD}') remains active and undisturbed."
  else
    echo "[SHUTDOWN NOTE] Production port ${PROD_PORT} is not currently listening."
  fi
  exit 0
fi

if [ ${#LISTENING_PIDS[@]} -gt 1 ]; then
  echo "[SHUTDOWN ERROR] Unexpected state: Multiple processes listening on port ${DEV_PORT}: ${LISTENING_PIDS[*]}" >&2
  echo "[SHUTDOWN ERROR] Aborting to prevent unsafe termination." >&2
  exit 1
fi

DEV_PID="${LISTENING_PIDS[0]}"
echo "[SHUTDOWN] Found single listener PID: ${DEV_PID}"

# 2. Positively confirm Working Directory belongs to dev project
DEV_CWD=$(lsof -a -p "${DEV_PID}" -d cwd -Fn 2>/dev/null | grep '^n' | sed 's/^n//')
if [ "${DEV_CWD}" != "${EXPECTED_DEV_DIR}" ]; then
  echo "[SHUTDOWN ERROR] Process ${DEV_PID} CWD ('${DEV_CWD}') does NOT match expected dev project directory ('${EXPECTED_DEV_DIR}')!" >&2
  echo "[SHUTDOWN ERROR] Refusing to terminate non-development process. Aborting." >&2
  exit 1
fi

# 3. Positively confirm command line
DEV_CMD=$(ps -p "${DEV_PID}" -o command=)
echo "[SHUTDOWN] Confirmed dev process command: ${DEV_CMD}"

# 4. Inspect Supervisor / Process Group
PGID_VAL=$(ps -p "${DEV_PID}" -o pgid= | tr -d ' ')
LEADER_PPID=$(ps -p "${PGID_VAL}" -o ppid= | tr -d ' ' || true)
LEADER_PARENT_CMD=$(ps -p "${LEADER_PPID}" -o command= 2>/dev/null || true)
echo "[SHUTDOWN] Process metadata: PID=${DEV_PID}, PGID=${PGID_VAL}, Leader PPID=${LEADER_PPID}"

if [ -z "${PGID_VAL}" ] || [ "${PGID_VAL}" -le 1 ]; then
  echo "[SHUTDOWN ERROR] Invalid or root process group PGID: '${PGID_VAL}'. Aborting." >&2
  exit 1
fi

# 5. SUPERVISOR RESPAWN RISK CHECK
# If the process group leader is supervised by an external agent runner (e.g., Antigravity 'agy'),
# automatic respawn behavior cannot be safely established without guessing.
# Terminating an ambiguous process group under an external supervisor is prohibited.
if echo "${LEADER_PARENT_CMD}" | grep -qE "agy|antigravity"; then
  echo "" >&2
  echo "==============================================================================" >&2
  echo "[SHUTDOWN ABORT] SUPERVISED PROCESS DETECTED" >&2
  echo "==============================================================================" >&2
  echo "Development server process group (PGID ${PGID_VAL}) is supervised by an external runner:" >&2
  echo "  Parent PID: ${LEADER_PPID}" >&2
  echo "  Parent Command: ${LEADER_PARENT_CMD}" >&2
  echo "" >&2
  echo "Automatic respawn behavior of the external runner cannot be safely established." >&2
  echo "Terminating an ambiguous process group under an external supervisor is prohibited." >&2
  echo "" >&2
  echo "REQUIRED OPERATOR ACTION:" >&2
  echo "  1. Stop the development server task through its managing interface first" >&2
  echo "     (e.g., Antigravity task manager / IDE interface: kill task-8962)." >&2
  echo "  2. Once the task is stopped and port ${DEV_PORT} is verified free, re-run this script" >&2
  echo "     to confirm clean port release before proceeding with cleanup." >&2
  echo "==============================================================================" >&2
  exit 1
fi

# 6. Enumerate ALL processes in the target process group and verify each belongs to dev
PG_PIDS=($(ps -o pid= -g "${PGID_VAL}" 2>/dev/null | tr -d ' ' || true))
if [ ${#PG_PIDS[@]} -eq 0 ]; then
  echo "[SHUTDOWN ERROR] Unable to enumerate processes in PGID ${PGID_VAL}. Aborting." >&2
  exit 1
fi

echo "[SHUTDOWN] Validating all ${#PG_PIDS[@]} processes in process group ${PGID_VAL}: ${PG_PIDS[*]}..."
for p in "${PG_PIDS[@]}"; do
  p_cwd=$(lsof -a -p "$p" -d cwd -Fn 2>/dev/null | grep '^n' | sed 's/^n//' || true)
  if [ -n "$p_cwd" ] && [ "$p_cwd" != "${EXPECTED_DEV_DIR}" ]; then
    echo "[SHUTDOWN ERROR] Process $p in PGID ${PGID_VAL} has foreign CWD: '$p_cwd'! Aborting." >&2
    exit 1
  fi
  p_cmd=$(ps -p "$p" -o command= || true)
  echo "  - Verified PID $p: ${p_cmd}"
done

# 7. Check production port 3000 safety boundary
if lsof -nP -iTCP:${PROD_PORT} -sTCP:LISTEN >/dev/null 2>&1; then
  PROD_PID=$(lsof -nP -iTCP:${PROD_PORT} -sTCP:LISTEN -Fp | grep '^p' | sed 's/^p//')
  for p in "${PG_PIDS[@]}"; do
    if [ "$p" = "${PROD_PID}" ]; then
      echo "[SHUTDOWN ERROR] Conflict: Production PID ${PROD_PID} is inside dev process group! Aborting." >&2
      exit 1
    fi
  done
  PROD_CWD=$(lsof -a -p "${PROD_PID}" -d cwd -Fn 2>/dev/null | grep '^n' | sed 's/^n//' || true)
  PROD_CMD=$(ps -p "${PROD_PID}" -o command= 2>/dev/null || true)
  if [ "${PROD_CWD}" = "${EXPECTED_PROD_DIR}" ]; then
    echo "[SHUTDOWN] Production port ${PROD_PORT} (PID ${PROD_PID}, CWD '${PROD_CWD}') is isolated and will not be touched."
  else
    echo "[SHUTDOWN WARNING] Production port ${PROD_PORT} listener PID ${PROD_PID} has unexpected CWD: '${PROD_CWD}'. Will not be touched."
  fi
else
  echo "[SHUTDOWN NOTE] Production port ${PROD_PORT} is not currently listening."
fi

# 8. Bounded Graceful Termination (SIGTERM to Process Group)
# Note: Reached only if supervisor respawn risk is cleared and process group is verified safe.
echo "[SHUTDOWN] Sending SIGTERM to process group ${PGID_VAL}..."
kill -TERM "-${PGID_VAL}" 2>/dev/null || kill -TERM "${DEV_PID}" 2>/dev/null || true

ELAPSED=0
while [ "${ELAPSED}" -lt "${SHUTDOWN_TIMEOUT}" ]; do
  if ! lsof -nP -iTCP:${DEV_PORT} -sTCP:LISTEN >/dev/null 2>&1; then
    echo "[SHUTDOWN] Port ${DEV_PORT} successfully released in ${ELAPSED}s."
    break
  fi
  sleep 1
  ELAPSED=$((ELAPSED + 1))
done

# 9. Escalation if bounded timeout exceeded
if lsof -nP -iTCP:${DEV_PORT} -sTCP:LISTEN >/dev/null 2>&1; then
  echo "[SHUTDOWN WARNING] Server did not release port ${DEV_PORT} within ${SHUTDOWN_TIMEOUT}s."
  echo "[SHUTDOWN WARNING] Escalating to SIGKILL on process group ${PGID_VAL}..."
  kill -KILL "-${PGID_VAL}" 2>/dev/null || kill -KILL "${DEV_PID}" 2>/dev/null || true
  sleep 2
  if lsof -nP -iTCP:${DEV_PORT} -sTCP:LISTEN >/dev/null 2>&1; then
    echo "[SHUTDOWN FATAL] Port ${DEV_PORT} still occupied after SIGKILL! Aborting." >&2
    exit 1
  fi
  echo "[SHUTDOWN] Port ${DEV_PORT} forcibly released."
fi

# 10. Final verification
echo "[SHUTDOWN SUCCESS] Port ${DEV_PORT} is free. Background writers halted."
if lsof -nP -iTCP:${PROD_PORT} -sTCP:LISTEN >/dev/null 2>&1; then
  echo "[SHUTDOWN CONFIRMATION] Production port ${PROD_PORT} remains active and undisturbed."
fi
exit 0
