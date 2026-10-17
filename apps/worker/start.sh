#!/bin/sh
# Container entrypoint. On single-instance hosts (e.g. Render free plan) set RUN_ARQ_IN_API=1
# to run the arq queue consumer (jobs + crons) alongside the HTTP API in the same container.
set -e
if [ "$RUN_ARQ_IN_API" = "1" ]; then
  arq app.worker.WorkerSettings &
fi
exec uvicorn app.main:app --host 0.0.0.0 --port "${PORT:-8000}"
