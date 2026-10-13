#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../../.." && pwd)"
PROMOTER="$ROOT/tooling/release/promote-dev-to-main"
temporary_directory="$(mktemp -d)"
trap 'rm -rf "$temporary_directory"' EXIT

real_git="$(command -v git)"
remote="$temporary_directory/remote.git"
seed="$temporary_directory/seed"
work="$temporary_directory/work"
wrapper_directory="$temporary_directory/bin"
mkdir -p "$wrapper_directory" "$work"

"$real_git" init --bare "$remote" >/dev/null
"$real_git" init -b main "$seed" >/dev/null
"$real_git" -C "$seed" config user.name "Promotion Test"
"$real_git" -C "$seed" config user.email "promotion-test@example.invalid"
"$real_git" -C "$seed" remote add origin "$remote"
printf 'one\n' > "$seed/source.txt"
"$real_git" -C "$seed" add source.txt
"$real_git" -C "$seed" commit -m one >/dev/null
"$real_git" -C "$seed" push origin main >/dev/null
"$real_git" -C "$seed" checkout -b dev >/dev/null
printf 'two\n' > "$seed/source.txt"
"$real_git" -C "$seed" commit -am two >/dev/null
"$real_git" -C "$seed" push origin dev >/dev/null

"$real_git" init -b scratch "$work" >/dev/null
"$real_git" -C "$work" config user.name "Promotion Test"
"$real_git" -C "$work" config user.email "promotion-test@example.invalid"
"$real_git" -C "$work" remote add origin "$remote"

cat > "$wrapper_directory/gh" <<'GH'
#!/usr/bin/env bash
set -euo pipefail

if [[ "${1:-}" == repo && "${2:-}" == view ]]; then
  printf 'example/elef\n'
  exit 0
fi

if [[ "${1:-}" == run && "${2:-}" == list ]]; then
  if printf '%s\n' "$@" | grep -q 'slow-lane.yml'; then
    printf '%s\n' "${GH_SLOW_RUNS_JSON:?}"
  else
    printf '%s\n' "${GH_CI_RUNS_JSON:?}"
  fi
  exit 0
fi

if [[ "${1:-}" == pr && "${2:-}" == create ]]; then
  printf '%s\n' "$*" >> "${GH_PR_CREATED:?}"
  printf 'https://github.com/example/elef/pull/99\n'
  exit 0
fi

echo "Unexpected gh command: $*" >&2
exit 1
GH
chmod +x "$wrapper_directory/gh"

export PATH="$wrapper_directory:$PATH"
export DEPLOYMENT_REMOTE=origin
export GH_PR_CREATED="$temporary_directory/pr-created.txt"

green_runs() {
  printf '[{"databaseId":100,"conclusion":"success","createdAt":"2026-10-11T08:00:00Z",'
  printf '"url":"https://github.com/example/elef/actions/runs/100"}]'
}
red_runs() {
  printf '[{"databaseId":101,"conclusion":"failure","createdAt":"2026-10-11T08:00:00Z",'
  printf '"url":"https://github.com/example/elef/actions/runs/101"}]'
}

export GH_CI_RUNS_JSON GH_SLOW_RUNS_JSON
GH_CI_RUNS_JSON="$(green_runs)"
GH_SLOW_RUNS_JSON="$(green_runs)"

# Dry run by default: prints the plan, opens nothing.
output="$(cd "$work" && "$PROMOTER")"
grep -q "Promotion plan: origin/dev (1 commit" <<<"$output"
grep -q "Dry run: pass --create" <<<"$output"
[[ ! -f "$GH_PR_CREATED" ]]
echo "Dry run prints the plan without opening a PR"

# Green lanes plus --create opens a main-bound promotion PR.
(cd "$work" && "$PROMOTER" --create) >/dev/null
grep -q "pr create --repo example/elef --base main --head dev" "$GH_PR_CREATED"
echo "Green lanes plus --create opens the promotion PR"

# Red CI refuses without an explicit override.
GH_CI_RUNS_JSON="$(red_runs)"
red_output="$(cd "$work" && "$PROMOTER" --create 2>&1)" && {
  echo "Expected the promoter to refuse red lanes" >&2
  exit 1
}
grep -q "Refusing to promote while dev lanes are red" <<<"$red_output"
echo "Red lanes refuse without --allow-red"

# The override records its reason in the planned PR body.
output="$(cd "$work" && "$PROMOTER" --allow-red "shepherd-verified flake, rerun green")"
grep -q "Red-lane override: shepherd-verified flake" <<<"$output"
echo "The red-lane override records its reason"

# Nothing to promote when dev matches main (lanes green, so emptiness is
# the only possible refusal reason).
GH_CI_RUNS_JSON="$(green_runs)"
"$real_git" -C "$seed" push origin main:dev --force >/dev/null 2>&1
empty_output="$(cd "$work" && "$PROMOTER" 2>&1)" && {
  echo "Expected the promoter to refuse an empty promotion" >&2
  exit 1
}
grep -q "nothing to promote" <<<"$empty_output"
echo "An empty promotion is refused"

echo "The dev-to-main promoter stays manual, green-gated, and explicit"
