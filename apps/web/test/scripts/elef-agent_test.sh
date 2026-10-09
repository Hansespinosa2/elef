#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../../.." && pwd)"
elef_agent="$ROOT/scripts/elef-agent"

# shellcheck source=apps/web/test/scripts/lib/config_assertions.sh
source "$ROOT/apps/web/test/scripts/lib/config_assertions.sh"

# Syntax check and verify the retired launcher notice.
bash -n "$elef_agent"

# 2. Test elef-agent retirement notice
elef_agent_output="$("$elef_agent" 2>&1 || true)"
assert_output_contains "$elef_agent_output" "scripts/elef-agent is retired; run agents natively on Omarchy"

# The notice has to survive as an active line too, not only in the output, so
# commenting the echo out cannot leave a green suite behind.
assert_active_line "$elef_agent" "scripts/elef-agent is retired; run agents natively on Omarchy"

# Verify exit status is 64
set +e
"$elef_agent" >/dev/null 2>&1
elef_agent_status=$?
set -e
[[ "$elef_agent_status" -eq 64 ]] || {
  echo "expected elef-agent to exit 64, got $elef_agent_status" >&2
  exit 1
}

assert_active_line_rejects_comments

echo "retired elef-agent check passed"
