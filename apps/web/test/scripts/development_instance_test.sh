#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../../.." && pwd)"
SCRIPT="$ROOT/ops/development-instance"
COMPOSE="$ROOT/ops/compose.development.yml"
DOCKERFILE="$ROOT/apps/web/Dockerfile.development"

# shellcheck source=apps/web/test/scripts/lib/config_assertions.sh
source "$ROOT/apps/web/test/scripts/lib/config_assertions.sh"

bash -n "$SCRIPT"

assert_active_line "$COMPOSE" "image: postgres:17"
assert_active_line "$COMPOSE" "elef_development_postgres:/var/lib/postgresql/data"
assert_active_line "$COMPOSE" "elef_development_storage:/rails/apps/web/storage"
assert_active_line "$COMPOSE" "Dockerfile.development"
assert_active_line "$COMPOSE" "APP_PORT:-3001"
assert_active_line "$DOCKERFILE" "RAILS_ENV=development"
assert_active_line "$COMPOSE" "bin/rails db:prepare"
assert_active_line "$COMPOSE" "RUBY_DEBUG_OPEN"
assert_active_line "$SCRIPT" "bin/rails db:migrate"
assert_active_line "$SCRIPT" "wrong Rails environment"
assert_active_line "$ROOT/apps/web/bin/dev" "bundle exec foreman"

assert_active_line_rejects_comments

echo "development instance checks passed"
