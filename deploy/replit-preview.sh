#!/usr/bin/env bash
set -euo pipefail
export HOST=0.0.0.0
export PORT=3000
export PUBLIC_URL="https://${REPLIT_DEV_DOMAIN:?Replit preview domain is missing}"
export COOKIE_SECURE=true
: "${DATABASE_URL:?Connect the Replit development database first}"
npm ci --include=dev
npm run build
node dist/bootstrap.js
exec node dist/index.js
