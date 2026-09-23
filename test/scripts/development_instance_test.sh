#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
SCRIPT="$ROOT/scripts/development-instance"
COMPOSE="$ROOT/compose.development.yml"
DOCKERFILE="$ROOT/Dockerfile.development"

assert_contains() {
  local file="$1" needle="$2"
  rg -F -- "$needle" "$file" >/dev/null || {
    echo "expected $file to contain: $needle" >&2
    exit 1
  }
}

bash -n "$SCRIPT"

assert_contains "$COMPOSE" "image: postgres:17"
assert_contains "$COMPOSE" "elef_development_postgres:/var/lib/postgresql/data"
assert_contains "$COMPOSE" "elef_development_storage:/rails/storage"
assert_contains "$COMPOSE" "Dockerfile.development"
assert_contains "$COMPOSE" "APP_PORT:-3001"
assert_contains "$DOCKERFILE" "RAILS_ENV=development"
assert_contains "$COMPOSE" "bin/rails db:prepare"
assert_contains "$SCRIPT" "bin/rails db:migrate"
assert_contains "$SCRIPT" "wrong Rails environment"

echo "development instance checks passed"
