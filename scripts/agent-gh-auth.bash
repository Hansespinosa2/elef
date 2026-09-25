_ELEF_AGENT_AUTH_SCRIPT="${BASH_SOURCE[0]}"
_ELEF_AGENT_AUTH_ROOT="$(cd -- "$(dirname -- "$_ELEF_AGENT_AUTH_SCRIPT")/.." && pwd)"

__elef_agent_with_gh_auth() {
  local agent="$1"
  shift
  "$_ELEF_AGENT_AUTH_ROOT/scripts/with-gh-auth" "$agent" "$@"
}

agy() { __elef_agent_with_gh_auth agy "$@"; }
codex() { __elef_agent_with_gh_auth codex "$@"; }
opencode() { __elef_agent_with_gh_auth opencode "$@"; }
hermes() { __elef_agent_with_gh_auth hermes "$@"; }
