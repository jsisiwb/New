#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

PREVIEW_DATABASE_NAME="${PREVIEW_DATABASE_NAME:-yeonjae_preview}"
PREVIEW_DATABASE_ROLE="${PREVIEW_DATABASE_ROLE:-yeonjae_preview_role}"
PREVIEW_DATABASE_PASSWORD="${PREVIEW_DATABASE_PASSWORD:-preview-local-only-password}"
export DATABASE_URL="postgres://${PREVIEW_DATABASE_ROLE}:${PREVIEW_DATABASE_PASSWORD}@127.0.0.1:5432/${PREVIEW_DATABASE_NAME}"
export HOST="127.0.0.1" PORT="8080"
export YEONJAE_INSECURE_COOKIES="true"
export YEONJAE_CORS_ORIGINS="http://127.0.0.1:3000,http://localhost:3000"
export YEONJAE_PROVIDER_MODE="simulated"
export YEONJAE_NOVEL_RUNNER="inline"
export YEONJAE_ENFORCEMENT_MODE="shared"

pg_isready -h 127.0.0.1 -p 5432 >/dev/null
psql "$DATABASE_URL" -Atqc 'select 1' >/dev/null

pids=()
cleanup() {
  trap - EXIT INT TERM
  for pid in "${pids[@]:-}"; do
    kill -- "-$pid" 2>/dev/null || kill "$pid" 2>/dev/null || true
  done
  wait 2>/dev/null || true
}
trap cleanup EXIT INT TERM

setsid node apps/api/dist/main.js & pids+=("$!")
setsid pnpm --filter @yeonjae/web start & pids+=("$!")

# A dead API must fail the managed process; do not leave a functional-looking web shell behind.
set +e
wait -n "${pids[@]}"
status=$?
set -e
exit "$status"
