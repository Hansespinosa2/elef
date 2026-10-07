#!/usr/bin/env bash
# Prepare (or clean up) an isolated, fresh-context review for one Elef campaign phase round.
#
#   review_bundle.sh prepare <phase> <round>   -> detached worktree at status.head_sha + bundle dir
#   review_bundle.sh cleanup <phase> <round>   -> remove that worktree (bundle dir is kept until ACT copies the report)
#
# The bundle contains ONLY what CONSTITUTION.md section 8 allows: constitution, active phase
# contract, status.json, frozen plan, base/head SHAs, diff, and existing machine evidence.
# It never contains implementer reasoning. Workflow tooling only; it decides nothing.
set -euo pipefail

cmd=${1:?usage: review_bundle.sh prepare|cleanup <phase> <round>}
phase=${2:?phase number required}
round=${3:?round number required}

root=$(git rev-parse --show-toplevel)
status="$root/docs/refactor/status.json"
bundle="$root/tmp/reviews/phase-$phase-round-$round"
worktree="$(dirname "$root")/elef-review-p$phase-r$round"

case "$cmd" in
  cleanup)
    if git -C "$root" worktree list --porcelain | grep -qx "worktree $worktree"; then
      dirty=$(git -C "$worktree" status --porcelain)
      if [ -n "$dirty" ]; then
        echo "review worktree has changes (reviewer must be read-only on sources):" >&2
        echo "$dirty" >&2
      fi
      git -C "$root" worktree remove --force "$worktree"
    fi
    echo "removed $worktree"
    exit 0
    ;;
  prepare) ;;
  *) echo "unknown command $cmd" >&2; exit 2 ;;
esac

read -r base head <<<"$(python3 -c 'import json,sys; s=json.load(open(sys.argv[1])); print(s["phase_base_sha"], s["head_sha"])' "$status")"
[ -n "$base" ] && [ -n "$head" ] || { echo "status.json must name phase_base_sha and head_sha" >&2; exit 1; }

phase_file=$(ls "$root"/docs/refactor/phases/"$(printf '%02d' "$phase")"-*.md)
plan="$root/docs/refactor/execution/phase-$phase-plan.md"
[ -f "$plan" ] || { echo "missing frozen plan $plan" >&2; exit 1; }

mkdir -p "$bundle"
cp "$root/docs/refactor/CONSTITUTION.md" "$bundle/CONSTITUTION.md"
cp "$phase_file" "$bundle/PHASE.md"
cp "$status" "$bundle/status.json"
cp "$plan" "$bundle/PLAN.md"
git -C "$root" diff --stat "$base" "$head" > "$bundle/diffstat.txt"
git -C "$root" diff "$base" "$head" > "$bundle/diff.patch"
printf 'phase=%s\nround=%s\nphase_base_sha=%s\nhead_sha=%s\n' "$phase" "$round" "$base" "$head" > "$bundle/SHAS.txt"
mkdir -p "$bundle/evidence"
for f in "$root"/docs/refactor/execution/phase-"$phase"-*; do
  case "$f" in *-plan.md) ;; *) [ -e "$f" ] && cp "$f" "$bundle/evidence/" ;; esac
done
# Previous review rounds for this phase let the reviewer confirm prior findings were fixed.
for f in "$root"/docs/refactor/reviews/phase-"$phase"-round-*.md; do
  [ -e "$f" ] && cp "$f" "$bundle/evidence/"
done

if ! git -C "$root" worktree list --porcelain | grep -qx "worktree $worktree"; then
  git -C "$root" worktree add --detach "$worktree" "$head" >/dev/null
fi

prompt_src="$(dirname "$0")/../references/reviewer-prompt.md"
sed -e "s|{{PHASE}}|$phase|g" -e "s|{{ROUND}}|$round|g" -e "s|{{BUNDLE}}|$bundle|g" \
    -e "s|{{WORKTREE}}|$worktree|g" -e "s|{{BASE}}|$base|g" -e "s|{{HEAD}}|$head|g" \
    "$prompt_src" > "$bundle/REVIEWER-PROMPT.md"

echo "bundle:   $bundle"
echo "worktree: $worktree (detached at $head)"
echo "prompt:   $bundle/REVIEWER-PROMPT.md"
echo "report:   $bundle/report.md (reviewer writes this)"
