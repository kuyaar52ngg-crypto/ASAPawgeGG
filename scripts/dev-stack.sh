#!/usr/bin/env bash
# Start / stop the whole local stack WITHOUT Docker: Postgres + Redis, web (production build), worker (API + arq), MCP (HTTP).
# Logs and pids go to .run/. Usage: bash scripts/dev-stack.sh start|stop|status   (run `pnpm build` first)
set -uo pipefail
cd "$(dirname "$0")/.."
mkdir -p .run
cmd="${1:-start}"
load_env() { set -a; . ./.env; set +a; }
pidfile() { echo ".run/$1.pid"; }
start_one() { # name dir command...
  local name="$1" dir="$2"; shift 2
  if [ -f "$(pidfile "$name")" ] && kill -0 "$(cat "$(pidfile "$name")")" 2>/dev/null; then echo "$name: already running"; return; fi
  (cd "$dir" && setsid nohup "$@" > "$OLDPWD/.run/$name.log" 2>&1 < /dev/null & echo $! > "$OLDPWD/$(pidfile "$name")")
  echo "$name: started"
}
case "$cmd" in
  start)
    bash scripts/services.sh start
    load_env
    start_one web apps/web pnpm exec next start --port 3000
    start_one worker-api apps/worker .venv/bin/uvicorn app.main:app --port 8000
    start_one worker-queue apps/worker .venv/bin/arq app.worker.WorkerSettings
    start_one mcp apps/mcp pnpm exec tsx src/http.ts
    ;;
  stop)
    for n in web worker-api worker-queue mcp; do
      if [ -f "$(pidfile $n)" ]; then pkill -P "$(cat "$(pidfile $n)")" 2>/dev/null; kill "$(cat "$(pidfile $n)")" 2>/dev/null; rm -f "$(pidfile $n)"; echo "$n: stopped"; fi
    done
    ;;
  status)
    for n in web worker-api worker-queue mcp; do
      if [ -f "$(pidfile $n)" ] && kill -0 "$(cat "$(pidfile $n)")" 2>/dev/null; then echo "$n: up"; else echo "$n: down"; fi
    done
    curl -s localhost:3000/ -o /dev/null -w "web http %{http_code}\n"; curl -s localhost:8000/health; echo
    ;;
  *) echo "usage: $0 start|stop|status"; exit 1 ;;
esac
