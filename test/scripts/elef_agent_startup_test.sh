#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
source "$ROOT/scripts/elef-agent"

sleep() { :; }
test_root="$(mktemp -d "${TMPDIR:-/tmp}/elef-agent-startup.XXXXXX")"
trap 'rm -rf -- "$test_root"' EXIT
AGENT_STATE_ROOT="$test_root/state"
STARTUP_TIMEOUT=3

git() {
  if [[ "$*" == "worktree list --porcelain" ]]; then
    printf 'worktree /tmp/task path with spaces\nbranch refs/heads/codex/sample\n\n'
  else
    command git "$@"
  fi
}
[[ "$(registered_worktree_for sample)" == "/tmp/task path with spaces" ]]
unset -f git

log_file="$(startup_log_path readiness)"
printf 'startup header\nRails is booting\n' >"$log_file"
STARTUP_LOG_LINE_COUNT=1

curl() {
  case "$*" in
    *127.0.0.1*) printf '200' ;;
    *readiness.localhost*) printf '200' ;;
    *) return 1 ;;
  esac
}

wait_output="$test_root/readiness-output"
wait_for_http readiness 3123 fake-container "$log_file" >"$wait_output"
[[ "$STARTUP_HTTP_CODE" == 200 ]]
grep -F 'Rails is booting' "$wait_output" >/dev/null

curl() {
  case "$*" in
    *127.0.0.1*) printf '200' ;;
    *readiness.localhost*) printf '502' ;;
    *) return 1 ;;
  esac
}
STARTUP_TIMEOUT=1
if wait_for_http readiness 3123 fake-container "$log_file" >"$wait_output"; then
  echo "expected the HTTPS 502 response to fail readiness" >&2
  exit 1
fi
[[ "$STARTUP_BACKEND_CODE" == 200 ]]
[[ "$STARTUP_ROUTE_CODE" == 502 ]]
[[ "$STARTUP_FAILURE_REASON" == "timed out after 1s waiting for the backend and HTTPS route" ]]

curl() { printf '000'; }
container_running() { return 1; }
STARTUP_TIMEOUT=15
if wait_for_http readiness 3123 fake-container "$log_file" >"$wait_output"; then
  echo "expected an exited container to fail readiness" >&2
  exit 1
fi
[[ "$STARTUP_FAILURE_REASON" == "the task container stopped before Rails became reachable" ]]

mock_container_cli() {
  if [[ "$1" == logs && "$2" == --follow ]]; then
    printf 'mock live startup output\n'
    command sleep 0.1
    return 0
  fi
  return 1
}
CONTAINER_CLI=mock_container_cli
live_log="$test_root/live-output"
start_startup_log_capture fake-container "$live_log"
command sleep 0.2
wait_output="$test_root/live-lines"
emit_startup_log_updates "$live_log" >"$wait_output"
stop_startup_log_capture
grep -F 'mock live startup output' "$wait_output" >/dev/null

route_root="$test_root/routes"
mkdir -p "$route_root"
route_for() { printf '%s/%s' "$route_root" "$1"; }
reload_router() { return 0; }
container_exists() { return 0; }
container_running() { return 1; }
CONTAINER_EVENTS="$test_root/container-events"
mock_container_cli() {
  case "$1" in
    stop) printf 'stop\n' >>"$CONTAINER_EVENTS" ;;
    logs) printf 'mock container diagnostic: %s\n' "$*" ;;
    --version) printf 'mock container cli 1.0\n' ;;
    system) printf 'mock container service diagnostic\n' ;;
    *) return 1 ;;
  esac
}
CONTAINER_CLI=mock_container_cli
failed_log="$test_root/failed-startup-log"
printf 'application started, route stayed unavailable\n' >"$failed_log"
STARTUP_LOG_LINE_COUNT=1
STARTUP_FAILURE_REASON="timed out waiting for the HTTPS route"
STARTUP_BACKEND_CODE=200
STARTUP_ROUTE_CODE=502
: >"$(route_for failed)"
if failure_output="$(fail_task_startup failed fake-container "$failed_log" 2>&1)"; then
  echo "expected startup failure handling to return a failure status" >&2
  exit 1
else
  failure_status=$?
fi
[[ "$failure_status" == 1 ]]
[[ ! -e "$(route_for failed)" ]]
[[ "$(<"$CONTAINER_EVENTS")" == stop ]]
grep -F 'mock container diagnostic: logs fake-container' "$failed_log" >/dev/null
grep -F 'mock container service diagnostic' "$failed_log" >/dev/null
grep -F 'Full startup diagnostics:' <<<"$failure_output" >/dev/null
grep -F 'After reviewing the log' <<<"$failure_output" >/dev/null

mkdir -p "$test_root/codex"
touch "$test_root/codex/config.toml"
if entrypoint_output="$(
  bash -c '
    bundle() { printf "simulated bundle failure\n" >&2; return 37; }
    export -f bundle
    HOME="$1/home" CODEX_HOME="$1/codex" GIT_CONFIG_GLOBAL="$1/git-config" ELEF_USE_SQLITE=1 "$2" web
  ' bash "$test_root" "$ROOT/.devcontainer/entrypoint.sh" 2>&1
)"; then
  echo "expected a simulated entrypoint failure" >&2
  exit 1
else
  entrypoint_status=$?
fi
[[ "$entrypoint_status" == 37 ]]
grep -F '[elef-entrypoint] installing Ruby dependencies' <<<"$entrypoint_output" >/dev/null
grep -F '[elef-entrypoint] ERROR: command failed' <<<"$entrypoint_output" >/dev/null

echo "elef-agent startup checks passed"
