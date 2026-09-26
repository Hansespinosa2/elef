#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
elef_agent="$ROOT/scripts/elef-agent"

assert_contains() {
  local output="$1" pattern="$2"
  if [[ "$output" != *"$pattern"* ]]; then
    echo "missing '$pattern' in output: $output" >&2
    exit 1
  fi
}

# Syntax check and verify the retired launcher notice.
bash -n "$elef_agent"

# 2. Test elef-agent retirement notice
elef_agent_output="$("$elef_agent" 2>&1 || true)"
assert_contains "$elef_agent_output" "scripts/elef-agent is retired; run agents natively on Omarchy"

# Verify exit status is 64
set +e
"$elef_agent" >/dev/null 2>&1
elef_agent_status=$?
set -e
[[ "$elef_agent_status" -eq 64 ]] || {
  echo "expected elef-agent to exit 64, got $elef_agent_status" >&2
  exit 1
}

echo "retired elef-agent check passed"
