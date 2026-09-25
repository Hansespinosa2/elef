#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
PUBLISHER="$ROOT/scripts/publish-deployment-ref"
temporary_directory="$(mktemp -d)"
trap 'rm -rf "$temporary_directory"' EXIT

real_git="$(command -v git)"
remote_path="$temporary_directory/remote.git"
worktree="$temporary_directory/worktree"
wrapper_directory="$temporary_directory/bin"
mkdir -p "$wrapper_directory"

"$real_git" init --bare "$remote_path" >/dev/null
"$real_git" init -b test "$worktree" >/dev/null
"$real_git" -C "$worktree" config user.name "Deployment Ref Test"
"$real_git" -C "$worktree" config user.email "deployment-ref-test@example.invalid"
"$real_git" -C "$worktree" remote add origin "$remote_path"

printf 'base\n' > "$worktree/history.txt"
"$real_git" -C "$worktree" add history.txt
"$real_git" -C "$worktree" commit -m base >/dev/null
base_sha="$("$real_git" -C "$worktree" rev-parse HEAD)"

printf 'older\n' >> "$worktree/history.txt"
"$real_git" -C "$worktree" commit -am older >/dev/null
older_sha="$("$real_git" -C "$worktree" rev-parse HEAD)"

printf 'newer\n' >> "$worktree/history.txt"
"$real_git" -C "$worktree" commit -am newer >/dev/null
newer_sha="$("$real_git" -C "$worktree" rev-parse HEAD)"

for branch in dev main; do
  "$real_git" -C "$worktree" push origin "$base_sha:refs/heads/elef-deploy-$branch" >/dev/null
  "$real_git" -C "$worktree" push origin "$older_sha:refs/heads/$branch" >/dev/null
done

# Inject the newer CI run after the older publisher has checked the source
# branch and fetched the marker tip, but immediately before its git push.
cat > "$wrapper_directory/git" <<'WRAPPER'
#!/usr/bin/env bash
set -euo pipefail

if [[ "${1:-}" == push && "${RACE_ARMED:-0}" == 1 && ! -e "${RACE_TRIGGERED_FILE:?}" ]]; then
  : > "$RACE_TRIGGERED_FILE"
  "$REAL_GIT" push "$DEPLOYMENT_REMOTE" "$RACE_NEW_SHA:refs/heads/$RACE_SOURCE_BRANCH" >/dev/null
  "$REAL_GIT" push "$DEPLOYMENT_REMOTE" "$RACE_NEW_SHA:$RACE_DEPLOYMENT_REF" >/dev/null
fi

exec "$REAL_GIT" "$@"
WRAPPER
chmod +x "$wrapper_directory/git"

for branch in dev main; do
  deployment_ref="refs/heads/elef-deploy-$branch"
  triggered_file="$temporary_directory/$branch-race-triggered"

  if (
    cd "$worktree"
    PATH="$wrapper_directory:$PATH" \
      REAL_GIT="$real_git" \
      RACE_ARMED=1 \
      RACE_TRIGGERED_FILE="$triggered_file" \
      RACE_SOURCE_BRANCH="$branch" \
      RACE_DEPLOYMENT_REF="$deployment_ref" \
      RACE_NEW_SHA="$newer_sha" \
      DEPLOYMENT_REMOTE=origin \
      GITHUB_REF_NAME="$branch" \
      GITHUB_SHA="$older_sha" \
      "$PUBLISHER"
  ); then
    echo "Expected the delayed $branch publisher to be rejected" >&2
    exit 1
  fi

  if [[ ! -e "$triggered_file" ]]; then
    echo "The simulated newer $branch run did not race the publisher push" >&2
    exit 1
  fi

  published_sha="$("$real_git" ls-remote --heads "$remote_path" "$deployment_ref" | awk 'NR == 1 { print $1 }')"
  if [[ "$published_sha" != "$newer_sha" ]]; then
    echo "$deployment_ref regressed: expected $newer_sha, found $published_sha" >&2
    exit 1
  fi

  echo "$deployment_ref stayed at $newer_sha after the older publisher was rejected"
done
