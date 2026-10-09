#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
SCRIPT="$ROOT/scripts/personal-instance"
COMPOSE="$ROOT/compose.personal.yml"
DOCKERFILE="$ROOT/Dockerfile"

# shellcheck source=test/scripts/lib/config_assertions.sh
source "$ROOT/test/scripts/lib/config_assertions.sh"

bash -n "$SCRIPT"
bash -n "$ROOT/.devcontainer/entrypoint.sh"

assert_active_line "$COMPOSE" "image: postgres:17"
assert_active_line "$COMPOSE" "elef_personal_postgres:/var/lib/postgresql/data"
assert_active_line "$COMPOSE" "elef_personal_storage:/rails/storage"
assert_active_line "$COMPOSE" "condition: service_healthy"
assert_active_line "$DOCKERFILE" "RAILS_ENV=production"
assert_active_line "$DOCKERFILE" "assets:precompile"
assert_active_line "$SCRIPT" "pg_dump --format=custom"
assert_active_line "$SCRIPT" "pg_restore --clean --if-exists"
assert_active_line "$SCRIPT" "--confirm"

assert_active_line_rejects_comments

echo "personal instance checks passed"
