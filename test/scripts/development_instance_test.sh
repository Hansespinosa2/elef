#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
SCRIPT="$ROOT/scripts/development-instance"
COMPOSE="$ROOT/compose.development.yml"
DOCKERFILE="$ROOT/Dockerfile.development"

# shellcheck source=test/scripts/lib/config_assertions.sh
source "$ROOT/test/scripts/lib/config_assertions.sh"

bash -n "$SCRIPT"

assert_active_line "$COMPOSE" 'image: ${POSTGRES_IMAGE:-postgres:17}'
assert_active_line "$COMPOSE" "elef_development_postgres:/var/lib/postgresql/data"
assert_active_line "$COMPOSE" "elef_development_storage:/rails/storage"
assert_active_line "$COMPOSE" "Dockerfile.development"
assert_active_line "$COMPOSE" "APP_PORT:-3001"
assert_active_line "$DOCKERFILE" "RAILS_ENV=development"
assert_active_line "$COMPOSE" "bin/rails db:prepare"
assert_active_line "$COMPOSE" "RUBY_DEBUG_OPEN"
assert_active_line "$SCRIPT" "bin/rails db:migrate"
assert_active_line "$SCRIPT" "wrong Rails environment"
assert_active_line "$ROOT/bin/dev" "bundle exec foreman"

assert_active_line_rejects_comments

echo "development instance checks passed"
