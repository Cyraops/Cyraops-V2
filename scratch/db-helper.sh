#!/bin/bash
# Audit-only DB helper for cyraops-v2 dev DB. Usage: ./scratch/db-helper.sh "<SQL>"
set -euo pipefail
cd "$(dirname "$0")/.."
set -a; . ./.env; set +a
node -e '
const u = new URL(process.env.DATABASE_URL);
process.stdout.write(`postgresql://${u.username}@${u.hostname}:${u.port}/${u.pathname.slice(1)}`);
' > /tmp/cyraops-psql-url
PGPASSWORD="$(node -e 'const u=new URL(process.env.DATABASE_URL);process.stdout.write(u.password)')" \
psql "$(cat /tmp/cyraops-psql-url)" -v ON_ERROR_STOP=0 -c "$1"
rm -f /tmp/cyraops-psql-url
