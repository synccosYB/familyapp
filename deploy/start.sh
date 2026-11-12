#!/bin/bash
# Familye on a single always-on Linux box (Debian/Ubuntu): Postgres + API on one machine. Idempotent.
# Data lives OUTSIDE the app folder (in $FAMILYE_DATA, default ~/familye-data), so a redeploy never touches it.
#   1. install PostgreSQL 15 once (apt) if missing
#   2. create the cluster once in $FAMILYE_DATA/pg, random DB password kept in $FAMILYE_DATA/secrets.env (mode 600)
#   3. start Postgres (own session), create role/db once
#   4. back up the database before every start (the API writes the nightly backup itself), keep 14 days
#   5. npm ci when package-lock.json changes
#   6. bootstrap (migrations, settings, first admin; never wipes real data), then exec the API
set -uo pipefail
APP_DIR="$(cd "$(dirname "$0")/.." && pwd)"
export FAMILYE_DATA="${FAMILYE_DATA:-$HOME/familye-data}"
PGBIN=/usr/lib/postgresql/15/bin
mkdir -p "$FAMILYE_DATA/backups" "$FAMILYE_DATA/run" "$FAMILYE_DATA/uploads"; chmod 700 "$FAMILYE_DATA"
log() { echo "$(date -u +%FT%TZ) [start] $*" | tee -a "$FAMILYE_DATA/boot.log"; }
log "app dir $APP_DIR, data dir $FAMILYE_DATA"

if [ ! -x "$PGBIN/initdb" ]; then
  log "installing postgresql-15"
  sudo DEBIAN_FRONTEND=noninteractive apt-get update -qq
  sudo DEBIAN_FRONTEND=noninteractive apt-get install -y -qq postgresql-15 postgresql-client-15 >/dev/null
  sudo systemctl disable --now postgresql >/dev/null 2>&1 || true
  sudo pg_dropcluster --stop 15 main >/dev/null 2>&1 || true
fi
sudo systemctl stop postgresql >/dev/null 2>&1 || true

if [ ! -f "$FAMILYE_DATA/secrets.env" ]; then
  ( umask 077; { echo "PG_SUPER_PASSWORD=$(openssl rand -hex 24)"; echo "PG_APP_PASSWORD=$(openssl rand -hex 24)"; } > "$FAMILYE_DATA/secrets.env" )
  log "generated database secrets"
fi
chmod 600 "$FAMILYE_DATA/secrets.env"
set -a; . "$FAMILYE_DATA/secrets.env"; set +a
if [ ! -f "$FAMILYE_DATA/pg/PG_VERSION" ]; then
  log "initdb"
  PWF=$(mktemp); chmod 600 "$PWF"; echo "$PG_SUPER_PASSWORD" > "$PWF"
  "$PGBIN/initdb" -D "$FAMILYE_DATA/pg" -U postgres --pwfile="$PWF" --auth=scram-sha-256 -E UTF8 --locale=C.UTF-8 >>"$FAMILYE_DATA/boot.log" 2>&1 || { log "initdb failed"; rm -f "$PWF"; exit 1; }
  rm -f "$PWF"
  cat >> "$FAMILYE_DATA/pg/postgresql.conf" <<EOF
# --- Familye (small box) ---
listen_addresses = '127.0.0.1'
port = 5433
unix_socket_directories = '$FAMILYE_DATA/run'
max_connections = 20
shared_buffers = 32MB
work_mem = 4MB
maintenance_work_mem = 16MB
effective_cache_size = 128MB
wal_level = minimal
max_wal_senders = 0
logging_collector = off
EOF
fi
export PGPASSWORD="$PG_SUPER_PASSWORD"
if ! "$PGBIN/pg_ctl" -D "$FAMILYE_DATA/pg" status >/dev/null 2>&1; then
  rm -f "$FAMILYE_DATA/pg/postmaster.pid" 2>/dev/null || true
  log "starting postgres"
  setsid "$PGBIN/pg_ctl" -D "$FAMILYE_DATA/pg" -l "$FAMILYE_DATA/postgres.log" -w -t 60 start >/dev/null 2>&1 < /dev/null || { log "postgres failed to start"; tail -20 "$FAMILYE_DATA/postgres.log"; exit 1; }
fi
PSQL="$PGBIN/psql -h 127.0.0.1 -p 5433 -U postgres -d postgres -v ON_ERROR_STOP=1 -qtA"
[ "$($PSQL -c "SELECT 1 FROM pg_roles WHERE rolname='familye'")" = "1" ] || { $PSQL -c "CREATE ROLE familye LOGIN PASSWORD '$PG_APP_PASSWORD'" && log "created role"; }
[ "$($PSQL -c "SELECT 1 FROM pg_database WHERE datname='familye'")" = "1" ] || { $PSQL -c "CREATE DATABASE familye OWNER familye" && log "created database"; }
unset PGPASSWORD
export DATABASE_URL="postgres://familye:${PG_APP_PASSWORD}@127.0.0.1:5433/familye"
export PG_DUMP_BIN="$PGBIN/pg_dump"

if [ "$("$PGBIN/psql" -d "$DATABASE_URL" -qtAc "SELECT to_regclass('public.users') IS NOT NULL")" = "t" ]; then
  f="$FAMILYE_DATA/backups/familye-$(date -u +%Y%m%d-%H%M%S).dump"
  if "$PGBIN/pg_dump" -Fc --no-owner -d "$DATABASE_URL" -f "$f.part" 2>>"$FAMILYE_DATA/boot.log"; then mv "$f.part" "$f"; log "pre-start backup written"; else rm -f "$f.part"; fi
  ls -1t "$FAMILYE_DATA"/backups/*.dump 2>/dev/null | tail -n +4 | while read -r old; do find "$old" -mtime +14 -delete 2>/dev/null; done
fi

DEPS="$HOME/familye-deps"; mkdir -p "$DEPS"
LOCK_SHA=$(sha256sum "$APP_DIR/package-lock.json" | cut -d' ' -f1)
if [ "$(cat "$DEPS/.lock-sha" 2>/dev/null)" != "$LOCK_SHA" ] || [ ! -x "$DEPS/node_modules/.bin/tsc" ]; then
  log "npm ci"
  cp "$APP_DIR/package.json" "$APP_DIR/package-lock.json" "$DEPS/"
  (cd "$DEPS" && npm ci --include=dev --no-audit --no-fund >>"$FAMILYE_DATA/boot.log" 2>&1) || { log "npm ci failed"; tail -20 "$FAMILYE_DATA/boot.log"; exit 1; }
  echo "$LOCK_SHA" > "$DEPS/.lock-sha"
fi
[ -e "$APP_DIR/node_modules" ] || ln -s "$DEPS/node_modules" "$APP_DIR/node_modules"

set -a; . "$APP_DIR/deploy/site.env"
[ -f "$APP_DIR/deploy/admin.env" ] && . "$APP_DIR/deploy/admin.env"   # never committed: hash of the admin's one-time setup token
[ -f "$APP_DIR/deploy/qa.env" ] && . "$APP_DIR/deploy/qa.env"         # never committed: temporary QA mode
set +a
cd "$APP_DIR"
# Always compile the checked-out TypeScript. dist/ is a build output, not tracked source.
# Stop here if compilation fails; never start an older build left in the checkout.
npm run build >>"$FAMILYE_DATA/boot.log" 2>&1 || { log "build failed"; tail -20 "$FAMILYE_DATA/boot.log"; exit 1; }
node dist/bootstrap.js 2>&1 | tee -a "$FAMILYE_DATA/boot.log"
[ "${PIPESTATUS[0]}" = "0" ] || { log "bootstrap failed"; exit 1; }
log "starting API on :$PORT"
exec node --max-old-space-size=192 dist/index.js
