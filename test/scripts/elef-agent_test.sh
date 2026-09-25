#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
elef_agent="$ROOT/scripts/elef-agent"
with_gh_auth="$ROOT/scripts/with-gh-auth"
install_script="$ROOT/scripts/install-agent-gh-auth"
wrapper_script="$ROOT/scripts/agent-gh-auth.bash"

assert_contains() {
  local output="$1" pattern="$2"
  if [[ "$output" != *"$pattern"* ]]; then
    echo "missing '$pattern' in output: $output" >&2
    exit 1
  fi
}

# 1. Syntax checks
bash -n "$elef_agent" "$with_gh_auth" "$install_script" "$wrapper_script"

# 2. Test elef-agent retirement notice
elef_agent_output="$("$elef_agent" 2>&1 || true)"
assert_contains "$elef_agent_output" "scripts/elef-agent is retired; run agents natively on Omarchy"
assert_contains "$elef_agent_output" "Install host-keyring token forwarding with scripts/install-agent-gh-auth"

# Verify exit status is 64
set +e
"$elef_agent" >/dev/null 2>&1
elef_agent_status=$?
set -e
[[ "$elef_agent_status" -eq 64 ]] || {
  echo "expected elef-agent to exit 64, got $elef_agent_status" >&2
  exit 1
}

# 3. Test with-gh-auth argument handling
set +e
no_args_output="$("$with_gh_auth" 2>&1)"
no_args_status=$?
set -e
[[ "$no_args_status" -eq 64 ]] || {
  echo "expected with-gh-auth without args to exit 64, got $no_args_status" >&2
  exit 1
}
assert_contains "$no_args_output" "usage: scripts/with-gh-auth {agy|codex|opencode|hermes}"

set +e
invalid_output="$("$with_gh_auth" unsupported-cmd 2>&1)"
invalid_status=$?
set -e
[[ "$invalid_status" -eq 1 ]] || {
  echo "expected with-gh-auth with invalid command to exit 1, got $invalid_status" >&2
  exit 1
}
assert_contains "$invalid_output" "unsupported agent command: unsupported-cmd"

# 4. Test with-gh-auth token forwarding
test_tmp="$(mktemp -d)"
trap 'rm -rf -- "$test_tmp"' EXIT

fake_bin="$test_tmp/bin"
mkdir -p "$fake_bin"

cat >"$fake_bin/agy" <<'EOF'
#!/usr/bin/env bash
printf "AGY_RUN: GH_TOKEN=%s GITHUB_TOKEN=%s ARGS=%s\n" "${GH_TOKEN:-}" "${GITHUB_TOKEN:-}" "$*"
EOF
chmod +x "$fake_bin/agy"

# Test with inherited GH_TOKEN
agy_out="$(PATH="$fake_bin:$PATH" GH_TOKEN="secret-test-token" "$with_gh_auth" agy arg1 arg2)"
assert_contains "$agy_out" "AGY_RUN: GH_TOKEN=secret-test-token GITHUB_TOKEN=secret-test-token ARGS=arg1 arg2"

# Test with mocked gh command
cat >"$fake_bin/gh" <<'EOF'
#!/usr/bin/env bash
if [[ "$*" == "auth token --hostname github.com" ]]; then
  printf "mocked-gh-token\n"
else
  exit 1
fi
EOF
chmod +x "$fake_bin/gh"

agy_out_mocked="$(PATH="$fake_bin:$PATH" env -u GH_TOKEN -u GITHUB_TOKEN "$with_gh_auth" agy foo)"
assert_contains "$agy_out_mocked" "AGY_RUN: GH_TOKEN=mocked-gh-token GITHUB_TOKEN=mocked-gh-token ARGS=foo"

# 5. Test install-agent-gh-auth idempotency
fake_home="$test_tmp/home"
mkdir -p "$fake_home"

HOME="$fake_home" SHELL="/bin/bash" "$install_script" >/dev/null
grep -F "$wrapper_script" "$fake_home/.bashrc" >/dev/null

# Running a second time should be idempotent
install_again_out="$(HOME="$fake_home" SHELL="/bin/bash" "$install_script")"
assert_contains "$install_again_out" "Agent GitHub wrappers are already installed in"

# 6. Test agent-gh-auth.bash source and function definitions
source_test="$(bash -c "source '$wrapper_script' && type -t agy codex opencode hermes")"
assert_contains "$source_test" "function"

echo "elef-agent and native agent auth checks passed"
