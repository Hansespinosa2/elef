#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
launcher="$ROOT/scripts/elef-agent"
entrypoint="$ROOT/.devcontainer/entrypoint.sh"
containerfile="$ROOT/.devcontainer/Containerfile"
codex_config="$ROOT/.devcontainer/codex-config.toml"
readme="$ROOT/README.md"

assert_contains() {
  local file="$1" pattern="$2"
  grep -F --quiet -- "$pattern" "$file" || {
    echo "missing '$pattern' in $file" >&2
    exit 1
  }
}

assert_not_contains() {
  local file="$1" pattern="$2"
  if grep -F --quiet -- "$pattern" "$file"; then
    echo "unexpected '$pattern' in $file" >&2
    exit 1
  fi
}

bash -n "$launcher" "$entrypoint"
(cd /tmp && "$launcher" --help >/dev/null)
assert_contains "$launcher" 'SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd -P)"'
assert_contains "$launcher" 'cd "$REPO"'
assert_contains "$launcher" 'CODEX_MODEL="gpt-6-luna"'
assert_contains "$launcher" 'USER_SKILLS_HOST="$HOME/.agents/skills"'
assert_not_contains "$launcher" 'Documents/GitHub/andy-skills/skills'
assert_contains "$launcher" 'registered_worktree_for'
assert_contains "$launcher" 'path = substr($0, 10)'
assert_contains "$launcher" 'worktree_is_valid "$1" "$preferred"'
assert_contains "$launcher" 'worktree_is_valid "$1" "$registered"'
assert_contains "$launcher" 'local task="$1" path="$2"'
assert_contains "$launcher" '--git-common-dir'
assert_contains "$launcher" 'task directory is not a valid checkout'
assert_contains "$launcher" 'git worktree repair'
assert_contains "$launcher" 'wt="$(require_worktree "$task")"'
assert_contains "$launcher" 'assert_no_active_terminal "$task"'
assert_contains "$launcher" 'has a stale worktree record for missing path'
assert_contains "$launcher" 'ensure_image "$image"'
assert_contains "$launcher" 'npm view @openai/codex version --silent'
assert_contains "$launcher" 'existing_image_for "$task"'
assert_contains "$launcher" 'remember_image "$task" "$image"'
assert_contains "$launcher" 'command -v jq >/dev/null'
assert_contains "$launcher" '--env BIND=0.0.0.0'
assert_contains "$launcher" '--env GIT_CONFIG_GLOBAL=/home/developer/.config/git/config'
assert_contains "$launcher" '--memory "$CONTAINER_MEMORY"'
assert_contains "$launcher" '"$image" web'
assert_contains "$launcher" 'AGENT_DATABASE="${ELEF_AGENT_DATABASE:-sqlite}"'
assert_contains "$launcher" 'STARTUP_TIMEOUT="${ELEF_AGENT_STARTUP_TIMEOUT:-300}"'
assert_contains "$launcher" 'validate_startup_timeout'
assert_contains "$launcher" '"$CONTAINER_CLI" logs --follow "$name"'
assert_contains "$launcher" '"$CONTAINER_CLI" logs --boot "$name"'
assert_contains "$launcher" '"$CONTAINER_CLI" system logs --last 5m'
assert_contains "$launcher" 'Full startup diagnostics:'
assert_contains "$launcher" 'The stopped container was retained for inspection:'
assert_contains "$launcher" 'task $task already exists at'
assert_contains "$launcher" 'use '\''$0 up $task'\'' to restart Rails'
assert_contains "$launcher" 'STARTUP_BACKEND_CODE'
assert_contains "$launcher" 'STARTUP_ROUTE_CODE'
assert_contains "$launcher" 'ELEF_AGENT_DATABASE must be sqlite or postgres'
assert_contains "$launcher" '--env "ELEF_USE_SQLITE=$sqlite_env"'
assert_contains "$launcher" 'validate_agent_database'
assert_contains "$launcher" 'database_state_for'
assert_contains "$launcher" 'remember_database "$task"'
assert_contains "$launcher" 'existing_database_for "$task"'
assert_contains "$launcher" 'https://$(host_for "$task").localhost'
assert_contains "$launcher" 'exec_in "$task" codex --dangerously-bypass-approvals-and-sandbox -m "$CODEX_MODEL"'
assert_contains "$launcher" '-m "$CODEX_MODEL"'
assert_contains "$launcher" "-c 'model_reasoning_effort=\"max\"'"
assert_contains "$launcher" "-c 'plan_mode_reasoning_effort=\"max\"'"
assert_contains "$codex_config" 'model = "gpt-6-luna"'
assert_contains "$codex_config" 'model_reasoning_effort = "max"'
assert_contains "$codex_config" 'plan_mode_reasoning_effort = "max"'
assert_not_contains "$launcher" 'gpt-5.6-luna'
assert_not_contains "$codex_config" 'gpt-5.6-luna'
assert_not_contains "$ROOT/.agents/skills/elef-agent/SKILL.md" 'gpt-5.6-luna'
invalid_model="gpt-6-luna""-max"
assert_not_contains "$launcher" "$invalid_model"
assert_not_contains "$codex_config" "$invalid_model"
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
assert_contains "$launcher" 'pr_body_for'
assert_contains "$launcher" 'check_pr_description.rb'
assert_contains "$launcher" 'git fetch origin "refs/heads/$base:$target_ref"'
assert_contains "$launcher" 'git merge-base --is-ancestor'
assert_contains "$launcher" 'ensure_base_current "$base"'
assert_contains "$launcher" 'ELEF_AGENT_DATABASE            Agent database: sqlite (default) or postgres'
assert_contains "$launcher" 'rm -rf -- "$state"'
assert_contains "$entrypoint" 'bin/rails server -b "${BIND:-0.0.0.0}" -p "${PORT:-3000}"'
assert_contains "$entrypoint" 'trap report_startup_error ERR'
assert_contains "$entrypoint" 'log_startup_step "installing Ruby dependencies"'
assert_contains "$entrypoint" 'log_startup_step "preparing the database"'
assert_contains "$entrypoint" 'log_startup_step "building Tailwind CSS"'
assert_contains "$entrypoint" 'GIT_CONFIG_GLOBAL="${GIT_CONFIG_GLOBAL:-$HOME/.config/git/config}"'
assert_contains "$entrypoint" 'credential.helper'
assert_contains "$containerfile" 'ARG CODEX_VERSION=latest'
assert_contains "$containerfile" 'ARG CHROME_DEVTOOLS_MCP_VERSION=1.8.0'
assert_contains "$containerfile" 'chromium-driver'
assert_contains "$containerfile" 'ripgrep'
assert_contains "$readme" 'ELEF_AGENT_DATABASE=postgres'
assert_contains "$readme" 'defaults to an isolated SQLite database'

echo "elef-agent launcher checks passed"
