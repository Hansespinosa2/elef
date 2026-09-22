#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
launcher="$ROOT/scripts/elef-agent"
entrypoint="$ROOT/.devcontainer/entrypoint.sh"
containerfile="$ROOT/.devcontainer/Containerfile"
codex_config="$ROOT/.devcontainer/codex-config.toml"

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
assert_contains "$launcher" '--env GIT_CONFIG_GLOBAL=/home/developer/.config/git/config'
assert_contains "$launcher" '--memory "$CONTAINER_MEMORY"'
assert_contains "$launcher" '"$image" web'
assert_contains "$launcher" 'https://$(host_for "$task").localhost'
assert_contains "$launcher" 'exec_in "$task" codex --dangerously-bypass-approvals-and-sandbox -m gpt-5.6-luna'
assert_contains "$launcher" "-c 'model_reasoning_effort=\"max\"'"
assert_contains "$launcher" "-c 'plan_mode_reasoning_effort=\"max\"'"
assert_contains "$codex_config" 'model = "gpt-5.6-luna"'
assert_contains "$codex_config" 'model_reasoning_effort = "max"'
assert_contains "$codex_config" 'plan_mode_reasoning_effort = "max"'
assert_contains "$launcher" 'up) shift; up "$@" ;;'
assert_contains "$launcher" 'image inspect "$1"'
assert_contains "$launcher" 'delete_codex_state "$task"'
assert_contains "$launcher" "trap 'restore_terminal;"
assert_contains "$launcher" 'fork) shift;'
assert_contains "$launcher" 'stty sane'
assert_contains "$launcher" 'restore_task_terminal "$task"'
assert_contains "$launcher" 'assert_no_active_terminal "$task"'
assert_contains "$launcher" 'finish TASK [TITLE]'
assert_contains "$launcher" 'Review and merge the task PR into the target branch on GitHub'
assert_contains "$launcher" 'Confirm the PR is merged'
assert_contains "$launcher" 'gh pr checks "$pr_number"'
assert_contains "$launcher" 'cleanup "$task"'
assert_contains "$launcher" 'rm -rf -- "$state"'
assert_contains "$entrypoint" 'bin/rails server -b "${BIND:-0.0.0.0}" -p "${PORT:-3000}"'
assert_contains "$entrypoint" 'GIT_CONFIG_GLOBAL="${GIT_CONFIG_GLOBAL:-$HOME/.config/git/config}"'
assert_contains "$entrypoint" 'credential.helper'
assert_contains "$containerfile" 'ARG CODEX_VERSION=latest'
assert_contains "$containerfile" 'ARG CHROME_DEVTOOLS_MCP_VERSION=1.8.0'
assert_contains "$containerfile" 'chromium-driver'
assert_contains "$containerfile" 'ripgrep'

echo "elef-agent launcher checks passed"
