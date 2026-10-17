#!/usr/bin/env bash
# Full local verification (no Docker): typecheck, lint, unit tests, integration tests (throw-away *_test DB), worker pytest, production build.
# E2E (Playwright) needs the running stack:  bash scripts/dev-stack.sh start && pnpm e2e
set -euo pipefail
cd "$(dirname "$0")/.."
step() { printf '\n\033[1;36m== %s\033[0m\n' "$*"; }
step "typecheck";          pnpm -r --if-present typecheck
step "lint";               pnpm -r --if-present lint
step "unit tests (ts)";    pnpm -r --if-present test
step "integration tests";  bash scripts/test-int.sh && bash scripts/test-int-cabinet.sh
step "worker tests";       pnpm worker:test
step "production build";   pnpm --filter @asap/web build
step "ledger integrity";   bash scripts/check-ledger.sh
echo; echo "ALL GREEN"
