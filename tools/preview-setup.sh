#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

# Preview owns a role and database. Never point this script at the test database.
PREVIEW_DATABASE_NAME="${PREVIEW_DATABASE_NAME:-yeonjae_preview}"
PREVIEW_DATABASE_ROLE="${PREVIEW_DATABASE_ROLE:-yeonjae_preview_role}"
PREVIEW_DATABASE_PASSWORD="${PREVIEW_DATABASE_PASSWORD:-preview-local-only-password}"
PREVIEW_DATABASE_URL="postgres://${PREVIEW_DATABASE_ROLE}:${PREVIEW_DATABASE_PASSWORD}@127.0.0.1:5432/${PREVIEW_DATABASE_NAME}"
export DATABASE_URL="$PREVIEW_DATABASE_URL"
PREVIEW_EMAIL="${PREVIEW_EMAIL:-preview@example.test}"
PREVIEW_PASSWORD="${PREVIEW_PASSWORD:-PreviewOnly-2026!}"

if [[ ! "$PREVIEW_DATABASE_NAME" =~ ^yeonjae_preview(_[a-z0-9_]+)?$ || ! "$PREVIEW_DATABASE_ROLE" =~ ^yeonjae_preview_[a-z0-9_]+$ ]]; then
  echo 'Preview requires dedicated yeonjae_preview database and role names.' >&2
  exit 1
fi

if ! pg_isready -h 127.0.0.1 -p 5432 >/dev/null 2>&1; then
  pg_ctlcluster 16 main start
fi
pg_isready -h 127.0.0.1 -p 5432 >/dev/null

# Disposable local migrations need role-creation privileges. Never use this role in a deployment.
# psql variables provide SQL-literal quoting; the email is never interpolated into SQL text.
runuser -u postgres -- psql -d postgres -v ON_ERROR_STOP=1 \
  -v role_name="$PREVIEW_DATABASE_ROLE" -v role_password="$PREVIEW_DATABASE_PASSWORD" <<'SQL'
SELECT format('CREATE ROLE %I LOGIN SUPERUSER PASSWORD %L', :'role_name', :'role_password')
WHERE NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = :'role_name') \gexec
SELECT format('ALTER ROLE %I LOGIN SUPERUSER PASSWORD %L', :'role_name', :'role_password') \gexec
SQL

if ! runuser -u postgres -- psql -d postgres -Atq -v db_name="$PREVIEW_DATABASE_NAME" <<'SQL' | grep -qx 1; then
select 1 from pg_database where datname = :'db_name';
SQL
  runuser -u postgres -- createdb -O "$PREVIEW_DATABASE_ROLE" "$PREVIEW_DATABASE_NAME"
fi
psql "$PREVIEW_DATABASE_URL" -Atqc 'select 1' >/dev/null

if ! python3 -c 'from jsonschema import Draft202012Validator; Draft202012Validator({}, registry=None)' >/dev/null 2>&1; then
  python3 -m pip install --target "$(python3 -m site --user-site)" 'jsonschema>=4.18,<5'
fi

pnpm install --frozen-lockfile
pnpm build
pnpm build:web
pnpm cli db:migrate >/dev/null

lookup_workspace() {
  runuser -u postgres -- psql -d "$PREVIEW_DATABASE_NAME" -Atq -v email="$PREVIEW_EMAIL" <<'SQL'
select w.id from workspaces w
join workspace_members m on m.workspace_id = w.id
join users u on u.id = m.user_id
where lower(u.email) = lower(:'email')
order by w.created_at limit 1;
SQL
}
PREVIEW_WORKSPACE="$(lookup_workspace)"
if [[ -z "$PREVIEW_WORKSPACE" ]]; then
  pnpm cli user:create "$PREVIEW_EMAIL" "$PREVIEW_PASSWORD" "Preview Operator" >/dev/null
  PREVIEW_WORKSPACE="$(lookup_workspace)"
fi

if ! runuser -u postgres -- psql -d "$PREVIEW_DATABASE_NAME" -Atq -v workspace="$PREVIEW_WORKSPACE" <<'SQL' | grep -qx 1; then
select 1 from projects where workspace_id = :'workspace' and title = 'Preview Novel' limit 1;
SQL
  pnpm cli project:create 'Preview Novel' --workspace="$PREVIEW_WORKSPACE" >/dev/null
fi

echo "Preview database ready: ${PREVIEW_DATABASE_NAME} (role ${PREVIEW_DATABASE_ROLE})"
