#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
AUTHORIZER="$ROOT/scripts/verify-deployment-authorization"
temporary_directory="$(mktemp -d)"
trap 'rm -rf "$temporary_directory"' EXIT

real_git="$(command -v git)"
repository="$temporary_directory/repository"
remote="$temporary_directory/remote.git"
wrapper_directory="$temporary_directory/bin"
mkdir -p "$wrapper_directory"

"$real_git" init --bare "$remote" >/dev/null
"$real_git" init -b dev "$repository" >/dev/null
"$real_git" -C "$repository" config user.name "Deployment Authorization Test"
"$real_git" -C "$repository" config user.email "deployment-authorization-test@example.invalid"
"$real_git" -C "$repository" remote add origin "$remote"
printf 'approved source tree\n' > "$repository/source.txt"
"$real_git" -C "$repository" add source.txt
"$real_git" -C "$repository" commit -m 'approved source tree' >/dev/null
commit_sha="$("$real_git" -C "$repository" rev-parse HEAD)"
tree_sha="$("$real_git" -C "$repository" rev-parse 'HEAD^{tree}')"
"$real_git" -C "$repository" push origin "$commit_sha:refs/heads/dev" >/dev/null

cat > "$wrapper_directory/gh" <<'GH'
#!/usr/bin/env bash
set -euo pipefail

command_name="${1:?}"
shift

if [[ "$command_name" == api ]]; then
  endpoint=""
  for argument in "$@"; do
    if [[ "$argument" == repos/* ]]; then
      endpoint="$argument"
      break
    fi
  done

  case "$endpoint" in
    "repos/$GITHUB_REPOSITORY/commits/$GITHUB_SHA/pulls?per_page=100")
      printf '%s\n' "${GH_COMMIT_PRS_JSON:?}"
      ;;
    "repos/$GITHUB_REPOSITORY/pulls/52")
      printf '%s\n' "${GH_PULL_REQUEST_JSON:?}"
      ;;
    "repos/$GITHUB_REPOSITORY/actions/runs/900")
      printf '%s\n' "${GH_RUN_STATUS_JSON:?}"
      ;;
    "repos/$GITHUB_REPOSITORY/actions/runs/900/jobs?filter=latest&per_page=100")
      printf '%s\n' "${GH_JOBS_JSON:?}"
      ;;
    "repos/$GITHUB_REPOSITORY/actions/runs/900/artifacts?per_page=100")
      printf '%s\n' "${GH_ARTIFACTS_JSON:?}"
      ;;
    *)
      echo "Unexpected gh api endpoint: $endpoint" >&2
      exit 1
      ;;
  esac
elif [[ "$command_name" == pr && "${1:-}" == view ]]; then
  printf '%s\n' "${GH_PR_CHECKS_JSON:?}"
elif [[ "$command_name" == run && "${1:-}" == download ]]; then
  shift
  output_directory=""
  while (($#)); do
    case "$1" in
      --dir)
        output_directory="$2"
        shift 2
        ;;
      *) shift ;;
    esac
  done
  mkdir -p "$output_directory"
  cp "${GH_ATTESTATION_FIXTURE:?}" "$output_directory/deployment-attestation.json"
else
  echo "Unexpected gh command: $command_name" >&2
  exit 1
fi
GH
chmod +x "$wrapper_directory/gh"

export PATH="$wrapper_directory:$PATH"
export GITHUB_REPOSITORY="example/elef"
export GITHUB_REF_NAME=dev
export GITHUB_SHA="$commit_sha"
export DEPLOYMENT_REMOTE=origin
export DEPLOYMENT_AUTH_WAIT_ATTEMPTS=1
export DEPLOYMENT_AUTH_WAIT_INTERVAL=0
export GH_ATTESTATION_FIXTURE="$temporary_directory/attestation.json"

build_fixtures() {
  local failed_job="${1:-}"
  local tested_tree="${2:-$tree_sha}"
  local run_conclusion="${3:-success}"
  local include_artifact="${4:-true}"

  GH_COMMIT_PRS_JSON="$(jq -n --arg sha "$commit_sha" '[{number: 52, merged_at: "2026-09-25T12:00:00Z", merge_commit_sha: $sha, base: {ref: "dev"}}]')"
  GH_PULL_REQUEST_JSON="$(jq -n --arg sha "$commit_sha" '{number: 52, merged_at: "2026-09-25T12:00:00Z", merge_commit_sha: $sha, base: {ref: "dev"}, head: {sha: $sha, ref: "feature/ci"}}')"
  GH_PR_CHECKS_JSON="$(jq -n '
    {statusCheckRollup: (
      ["desktop-fast", "scan_ruby", "scan_js", "test", "sqlite-test", "system-test", "desktop", "desktop-macos", "renderer-macos", "production-smoke", "development-smoke"]
      | to_entries
      | map({
          name: .value,
          workflowName: "CI",
          conclusion: "SUCCESS",
          status: "COMPLETED",
          startedAt: "2026-09-25T12:00:00Z",
          detailsUrl: ("https://github.com/example/elef/actions/runs/900/job/" + ((.key + 1) | tostring))
        })
    )}
  ')"
  GH_RUN_STATUS_JSON="$(jq -n --arg sha "$commit_sha" --arg conclusion "$run_conclusion" '{id: 900, run_attempt: 1, event: "pull_request", status: "completed", conclusion: $conclusion, head_sha: $sha, head_branch: "feature/ci", path: ".github/workflows/ci.yml", pull_requests: []}')"
  GH_JOBS_JSON="$(jq -n --arg failed "$failed_job" '{jobs: (["desktop-fast", "scan_ruby", "scan_js", "test", "sqlite-test", "system-test", "desktop", "desktop-macos", "renderer-macos", "production-smoke", "development-smoke", "record-ci-attestation"] | map({name: ., conclusion: (if . == $failed then "failure" else "success" end)}))}')"

  if [[ "$include_artifact" == true ]]; then
    GH_ARTIFACTS_JSON="$(jq -n '{artifacts: [{id: 123, name: "ci-attestation-pr52-run900-attempt1", expired: false}]}')"
  else
    GH_ARTIFACTS_JSON='{"artifacts":[]}'
  fi

  jq -n \
    --argjson pr_number 52 \
    --argjson workflow_run_id 900 \
    --argjson run_attempt 1 \
    --arg tested_sha "$commit_sha" \
    --arg tested_tree "$tested_tree" \
    '{pr_number: $pr_number, workflow_run_id: $workflow_run_id, run_attempt: $run_attempt, tested_sha: $tested_sha, tested_tree: $tested_tree}' \
    > "$GH_ATTESTATION_FIXTURE"

  export GH_COMMIT_PRS_JSON GH_PULL_REQUEST_JSON GH_PR_CHECKS_JSON GH_RUN_STATUS_JSON
  export GH_JOBS_JSON GH_ARTIFACTS_JSON
}

assert_rejected() {
  local description="$1"
  if (cd "$repository" && "$AUTHORIZER") >/dev/null 2>&1; then
    echo "Expected authorization to reject $description" >&2
    exit 1
  fi
  echo "Rejected $description"
}

build_fixtures
(cd "$repository" && "$AUTHORIZER")

build_fixtures system-test
assert_rejected "a PR run with a failed required job"

build_fixtures renderer-macos
assert_rejected "a PR run with a failed Apple Silicon renderer job"

build_fixtures "" "$(printf '0%.0s' {1..40})"
assert_rejected "a tested tree that differs from the merged tree"

build_fixtures "" "$tree_sha" failure
assert_rejected "a failed latest PR workflow run"

build_fixtures "" "$tree_sha" success false
assert_rejected "a missing CI attestation artifact"

echo "Deployment authorization accepted only the successful PR-tested tree"
