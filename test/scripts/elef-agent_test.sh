#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
launcher="$ROOT/scripts/elef-agent"
entrypoint="$ROOT/.devcontainer/entrypoint.sh"
containerfile="$ROOT/.devcontainer/Containerfile"

assert_contains() {
  local file="$1" pattern="$2"
  grep -F --quiet -- "$pattern" "$file" || {
    echo "missing '$pattern' in $file" >&2
    exit 1
  }
}

bash -n "$launcher" "$entrypoint"
assert_contains "$launcher" 'ensure_image "$image"'
assert_contains "$launcher" 'npm view @openai/codex version --silent'
assert_contains "$launcher" 'existing_image_for "$task"'
assert_contains "$launcher" 'remember_image "$task" "$image"'
assert_contains "$launcher" 'command -v jq >/dev/null'
assert_contains "$launcher" '--env BIND=0.0.0.0'
assert_contains "$launcher" '"$image" web'
assert_contains "$launcher" 'https://$(host_for "$task").localhost'
assert_contains "$launcher" 'exec_in "$task" codex --dangerously-bypass-approvals-and-sandbox -m gpt-5.6-luna'
assert_contains "$launcher" 'up) shift; up "$@" ;;'
assert_contains "$launcher" 'image inspect "$1"'
assert_contains "$launcher" 'delete_codex_state "$task"'
assert_contains "$launcher" 'finish TASK [TITLE]'
assert_contains "$launcher" 'gh pr checks "$pr_number"'
assert_contains "$launcher" 'cleanup "$task"'
assert_contains "$launcher" 'rm -rf -- "$state"'
assert_contains "$entrypoint" 'bin/rails server -b "${BIND:-0.0.0.0}" -p "${PORT:-3000}"'
assert_contains "$containerfile" 'ARG CODEX_VERSION=latest'
assert_contains "$containerfile" 'ARG CHROME_DEVTOOLS_MCP_VERSION=1.8.0'
assert_contains "$containerfile" 'chromium-driver'
assert_contains "$containerfile" 'ripgrep'

echo "elef-agent launcher checks passed"
