#!/usr/bin/env bash
set -euo pipefail
export HOST=0.0.0.0
export PORT=${PORT:-3000}
export PUBLIC_URL=${PUBLIC_URL:-https://familyapp-yoel14.replit.app}
export COOKIE_SECURE=true
: "${DATABASE_URL:?Production PostgreSQL is required}"
node dist/bootstrap.js
exec node dist/index.js
