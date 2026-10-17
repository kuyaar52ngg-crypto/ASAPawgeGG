#!/usr/bin/env bash
# Integration tests of the commerce core (zone B) against a throw-away database `asapawge_test`.
# Creates the DB if needed, applies migrations, RESEEDS it (wipes it!) and runs the vitest integration suite.
set -euo pipefail
cd "$(dirname "$0")/.."
DB_URL="${INTEGRATION_DATABASE_URL:-postgresql://asap:asap@localhost:5432/asapawge_test}"
case "$DB_URL" in *_test*) ;; *) echo "refusing: INTEGRATION_DATABASE_URL must point to a *_test database" >&2; exit 1 ;; esac
bash scripts/services.sh start >/dev/null
su postgres -c "psql -tc \"select 1 from pg_database where datname='asapawge_test'\"" | grep -q 1 || su postgres -c "psql -c 'create database asapawge_test owner asap'"
DATABASE_URL="$DB_URL" pnpm --silent db:deploy >/dev/null
DATABASE_URL="$DB_URL" pnpm --silent db:seed >/dev/null
INTEGRATION_DATABASE_URL="$DB_URL" pnpm --filter @asap/web exec vitest run src/server/commerce.int
