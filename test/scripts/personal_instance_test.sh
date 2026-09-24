#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
SCRIPT="$ROOT/scripts/personal-instance"
COMPOSE="$ROOT/compose.personal.yml"
DOCKERFILE="$ROOT/Dockerfile"

assert_contains() {
  local file="$1" needle="$2"
  grep -F -e "$needle" "$file" >/dev/null || {
    echo "expected $file to contain: $needle" >&2
    exit 1
  }
}

bash -n "$SCRIPT"
bash -n "$ROOT/.devcontainer/entrypoint.sh"

assert_contains "$COMPOSE" "image: postgres:17"
assert_contains "$COMPOSE" "elef_personal_postgres:/var/lib/postgresql/data"
assert_contains "$COMPOSE" "elef_personal_storage:/rails/storage"
assert_contains "$COMPOSE" "condition: service_healthy"
assert_contains "$DOCKERFILE" "RAILS_ENV=production"
assert_contains "$DOCKERFILE" "assets:precompile"
assert_contains "$SCRIPT" "pg_dump --format=custom"
assert_contains "$SCRIPT" "pg_restore --clean --if-exists"
assert_contains "$SCRIPT" "--confirm"

echo "personal instance checks passed"
