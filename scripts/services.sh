#!/usr/bin/env bash
# Start/stop local PostgreSQL + Redis without Docker (dev containers / CI sandboxes).
set -euo pipefail
cmd="${1:-start}"
case "$cmd" in
  start)
    if command -v service >/dev/null && ! pg_isready -q 2>/dev/null; then service postgresql start || true; fi
    redis-cli ping >/dev/null 2>&1 || redis-server --daemonize yes >/dev/null
    # idempotent role + db
    su postgres -c "psql -tc \"select 1 from pg_roles where rolname='asap'\"" | grep -q 1 || su postgres -c "psql -c \"create role asap with login superuser password 'asap'\""
    su postgres -c "psql -tc \"select 1 from pg_database where datname='asapawge'\"" | grep -q 1 || su postgres -c "psql -c 'create database asapawge owner asap'"
    echo "postgres: $(pg_isready)  redis: $(redis-cli ping)"
    ;;
  stop)
    redis-cli shutdown nosave 2>/dev/null || true
    service postgresql stop || true
    ;;
  *) echo "usage: $0 start|stop"; exit 1 ;;
esac
