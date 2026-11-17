#!/usr/bin/env bash
set -euo pipefail

DEV_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROD_DIR="/Users/tanveersinghsaini/Desktop/locally hosted app"

# Use a runtime within the project's declared Node 22-24 support range.
NODE_MAJOR=$(node -p 'Number(process.versions.node.split(".")[0])')
if (( NODE_MAJOR < 22 || NODE_MAJOR >= 25 )); then
  SUPPORTED_NODE_BIN=""
  for candidate in "$HOME"/.nvm/versions/node/v22*/bin "$HOME"/.nvm/versions/node/v23*/bin "$HOME"/.nvm/versions/node/v24*/bin; do
    [ -x "$candidate/node" ] || continue
    candidate_major=$("$candidate/node" -p 'Number(process.versions.node.split(".")[0])')
    if (( candidate_major >= 22 && candidate_major < 25 )); then
      SUPPORTED_NODE_BIN="$candidate"
      break
    fi
  done
  if [ -z "$SUPPORTED_NODE_BIN" ]; then
    echo "🛑 DEPLOYMENT HALTED: Node.js 22, 23, or 24 is required; current runtime is outside that range."
    exit 1
  fi
  export PATH="$SUPPORTED_NODE_BIN:$PATH"
  hash -r
fi
echo "✅ Using supported runtime: $(node --version)"

echo "======================================================"
echo "🚀 PROMOTING FROM DEV TO PRODUCTION (cyraops.com)"
echo "======================================================"
echo "Dev source: $DEV_DIR"
echo "Production: $PROD_DIR"
echo ""

# Fail-safe gate: Require explicit environment variable confirmation
if [ "${PROCEED_PROD_DEPLOY:-}" != "true" ]; then
  echo "======================================================"
  echo "🛑 DEPLOYMENT HALTED: PROCEED_PROD_DEPLOY=true is not set."
  echo ""
  echo "Promoting to production requires explicit manual confirmation."
  echo "To deploy to production, run:"
  echo "  PROCEED_PROD_DEPLOY=true ./promote-to-prod.sh"
  echo ""
  echo "Prerequisites before deployment:"
  echo "  1. Complete formal reviewed migrations in prisma/migrations/"
  echo "  2. Clean test execution ('npm test' and 'npm run typecheck')"
  echo "  3. Validated production backup of company_os"
  echo "======================================================"
  exit 1
fi

# Verify the configured target and current listener before doing deployment work.
read_database_target() {
node - "$PROD_DIR/.env" <<'NODE'
const fs = require('node:fs');
const envPath = process.argv[2];
const line = fs.readFileSync(envPath, 'utf8').split(/\r?\n/).find((item) => /^\s*DATABASE_URL\s*=/.test(item));
if (!line) process.exit(2);
let value = line.slice(line.indexOf('=') + 1).trim();
if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) value = value.slice(1, -1);
const url = new URL(value);
if (url.protocol !== 'postgresql:' && url.protocol !== 'postgres:') process.exit(3);
process.stdout.write([decodeURIComponent(url.pathname.replace(/^\//, '')), url.hostname, url.port || '5432'].join('|'));
NODE
}

TARGET_INFO=$(read_database_target)
IFS='|' read -r TARGET_DB TARGET_HOST TARGET_PORT <<< "$TARGET_INFO"
if [ "$TARGET_DB" != "company_os" ] || [[ "$TARGET_HOST" != "localhost" && "$TARGET_HOST" != "127.0.0.1" ]] || [ "$TARGET_PORT" != "5432" ]; then
  echo "🛑 SAFETY ABORT: Expected local company_os on port 5432; target identity did not match."
  exit 1
fi
echo "✅ Production database target verified: company_os on localhost:5432"

verify_prod_listener() {
  local pids pid cwd
  pids=$(lsof -nP -t -iTCP:3000 -sTCP:LISTEN 2>/dev/null | sort -u || true)
  if [ -z "$pids" ]; then
    echo "🛑 SAFETY ABORT: No existing production listener is running on port 3000."
    return 1
  fi
  while IFS= read -r pid; do
    [ -n "$pid" ] || continue
    cwd=$(lsof -a -p "$pid" -d cwd -Fn 2>/dev/null | sed -n 's/^n//p' | head -1)
    if [ "$cwd" != "$PROD_DIR" ]; then
      echo "🛑 SAFETY ABORT: Port 3000 PID $pid is not running from the production project directory."
      return 1
    fi
  done <<< "$pids"
  VERIFIED_LISTENER_PIDS="$pids"
}

verify_prod_listener

# 1. Run tests in dev first
echo "➡️  [1/7] Running tests and typechecks in dev..."
cd "$DEV_DIR"
npm test
npm run typecheck
echo "✅ Tests passed!"

# 2. Build marketing site if source exists
if [ -d "$DEV_DIR/marketing-source" ]; then
  echo "➡️  [2/6] Building marketing website from source..."
  (cd "$DEV_DIR/marketing-source" && VITE_CMS_URL=/login npm run build)
  CYRAOPS_SITE_DIST="$DEV_DIR/marketing-source/dist" node "$DEV_DIR/scripts/sync-marketing-site.mjs"
fi

# Save a verified production recovery point before syncing code or applying migrations.
echo "➡️  [3/7] Creating a private, verified production database and uploads backup..."
BACKUP_TIMESTAMP=$(date -u +%Y%m%dT%H%M%SZ)
BACKUP_DIR="$PROD_DIR/backups/predeploy-$BACKUP_TIMESTAMP"
node "$DEV_DIR/scripts/backup-production-state.mjs" "$PROD_DIR" "$BACKUP_DIR"

# 4. Synchronize code files to production (preserving .env and uploads)
echo "➡️  [4/7] Synchronizing code to production..."
rsync -av \
  --exclude '.env' \
  --exclude 'uploads' \
  --exclude 'backups/' \
  --exclude 'node_modules' \
  --exclude '.next' \
  --exclude 'app.log' \
  --exclude 'dev-server.log' \
  --exclude 'promote-to-prod.sh' \
  --exclude 'marketing-source' \
  "$DEV_DIR/" "$PROD_DIR/"

# 5. Keep production runtime files and database settings intact.
echo "➡️  [5/7] Rechecking production database identity..."
cd "$PROD_DIR"
TARGET_INFO_AFTER=$(read_database_target)
if [ "$TARGET_INFO_AFTER" != "$TARGET_INFO" ]; then
  echo "🛑 SAFETY ABORT: Production database identity changed during synchronization."
  echo "Refusing to proceed with unverified database target."
  exit 1
fi
echo "✅ Target database remains company_os."

# 6. Install locked dependencies, apply formal migrations and build Next.js
echo "➡️  [6/7] Installing locked dependencies, deploying migrations and building Next.js..."
npm ci --no-audit --no-fund
npx prisma generate

# Require formal reviewed migrations; unreviewed schema pushes are STRICTLY FORBIDDEN
echo "Checking migration status with prisma migrate deploy..."
npx prisma migrate deploy || {
  echo "======================================================"
  echo "🛑 MIGRATION FAILED: Cannot deploy unreviewed schema changes."
  echo "Production schema requires formal migration files in prisma/migrations/."
  echo "Running unreviewed schema push commands in production is strictly prohibited."
  echo "======================================================"
  exit 1
}

npm run build

# 7. Graceful restart of the verified production listener only.
echo "➡️  [7/7] Gracefully restarting the verified production server on port 3000..."
verify_prod_listener
while IFS= read -r pid; do
  [ -n "$pid" ] || continue
  kill -15 "$pid"
done <<< "$VERIFIED_LISTENER_PIDS"
for i in {1..20}; do
  if ! lsof -nP -iTCP:3000 -sTCP:LISTEN >/dev/null 2>&1; then
    break
  fi
  sleep 0.5
done
if lsof -nP -iTCP:3000 -sTCP:LISTEN >/dev/null 2>&1; then
  echo "🛑 Production listener did not stop gracefully; refusing to force-kill it."
  exit 1
fi

PORT=3000 nohup npm run start > app.log 2>&1 < /dev/null &
HEALTH_OK=false
for i in {1..30}; do
  if curl -fsS --max-time 3 http://127.0.0.1:3000/api/health 2>/dev/null | node -e 'let body="";process.stdin.on("data",c=>body+=c);process.stdin.on("end",()=>{try{const h=JSON.parse(body);process.exit(h.status==="ok"&&h.database==="connected"?0:1)}catch{process.exit(1)}})' >/dev/null 2>&1; then
    HEALTH_OK=true
    break
  fi
  sleep 1
done
if [ "$HEALTH_OK" != "true" ]; then
  echo "🛑 Production health check failed. Inspect $PROD_DIR/app.log; backup is at $BACKUP_DIR."
  exit 1
fi

echo ""
echo "======================================================"
echo "🎉 SUCCESS: Production deployment and database health check passed."
echo "Public website: https://www.cyraops.com"
echo "Verified recovery point: $BACKUP_DIR"
echo "======================================================"

