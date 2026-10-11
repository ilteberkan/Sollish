#!/usr/bin/env bash
set -euo pipefail
ROOT=$(cd "$(dirname "$0")/../.." && pwd)
PGROOT="$ROOT/.tooling/backend-postgres"
mkdir -p "$PGROOT"
if [ ! -f "$PGROOT/data/PG_VERSION" ]; then initdb -D "$PGROOT/data" --auth=trust --no-locale >"$PGROOT/init.log"; fi
if ! pg_ctl -D "$PGROOT/data" status >/dev/null 2>&1; then pg_ctl -D "$PGROOT/data" -l "$PGROOT/server.log" -o "-h 127.0.0.1 -p 55432 -k $PGROOT" start; fi
# Only this explicitly named test database is reset. No external DATABASE_URL.
psql -h 127.0.0.1 -p 55432 -d postgres -v ON_ERROR_STOP=1 -c 'drop database if exists sollish_backend_test with (force)' -c 'create database sollish_backend_test'
psql -h 127.0.0.1 -p 55432 -d sollish_backend_test -v ON_ERROR_STOP=1 -f "$ROOT/supabase/tests/bootstrap.sql"
export LC_ALL=C
for migration in "$ROOT"/supabase/migrations/*.sql; do
  psql -h 127.0.0.1 -p 55432 -d sollish_backend_test -v ON_ERROR_STOP=1 -f "$migration"
done
psql -h 127.0.0.1 -p 55432 -d sollish_backend_test -v ON_ERROR_STOP=1 -f "$ROOT/supabase/tests/security.sql"
