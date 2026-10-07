---
name: independent-phase-review
description: Use only when an Elef refactor phase claims readiness for PASS (phase_state CHECK) and must be verified by a genuinely fresh-context, read-only reviewer. Never use it to self-certify.
---

# Independent phase review

Authority: reviewer inputs, output table, loop caps and the `BLOCKED(reviewer-unavailable)` rule are defined in `docs/refactor/CONSTITUTION.md` §8. This skill is only the mechanics.

## Preconditions (orchestrator)

1. Candidate is committed; `status.json` has `phase_state: "CHECK"`, `head_sha` = candidate SHA, `review_round` = K (incremented for this round), and that status is committed.
2. `bin/check phase N --json` stdout for the candidate is stored verbatim at `docs/refactor/execution/phase-N-gate.txt` (or the failing output, if a criterion is BLOCKED by environment).
3. `python3 .agents/skills/elef-campaign/scripts/campaign_state.py validate` reports no errors other than the expected missing review.
4. Release heavyweight implementation processes first: Rails test servers the agent started, browsers/WebDriver, `cargo`/`esbuild` watchers, Tauri dev processes. Never stop the owner's server on `https://127.0.0.1:3000/`.

## Prepare the isolated input

```sh
.agents/skills/independent-phase-review/scripts/review_bundle.sh prepare N K
```

This creates `tmp/reviews/phase-N-round-K/` (constitution, phase, status, plan, SHAs, diff, evidence, filled `REVIEWER-PROMPT.md`) and a detached worktree `../elef-review-pN-rK` at the candidate. Do not add anything else to the bundle — in particular no summary of what you did, no reasoning, no "areas to focus on".

## Launch a fresh reviewer (first available, in order)

1. **Harness-native fresh subagent/worker** (e.g. a subagent with its own context, a new task/agent session). Its entire prompt is: `Read <bundle>/REVIEWER-PROMPT.md and follow it exactly.` Do not fork/inherit the implementer conversation.
2. **Clean noninteractive agent process** started in the review worktree with only that same one-line prompt — e.g. `codex exec`, `claude -p`, or another installed agent CLI (check `<cli> --help` for noninteractive and permission flags; give it write access only as needed for build outputs).
3. If neither can be created with a context that excludes the implementer conversation: set `phase_state: "BLOCKED"`, `blocker: {"code":"reviewer-unavailable", ...}`, commit, stop. Never review your own phase.

Run reviewers sequentially, never in parallel with heavyweight implementation work.

## Collect

1. Wait for `tmp/reviews/phase-N-round-K/report.md`. Copy it **verbatim** to `docs/refactor/reviews/phase-N-round-K.md`. Do not edit, summarize, or reformat it.
2. Run `review_bundle.sh cleanup N K`. If it reports reviewer source changes, the review is invalid: record that and repeat the round with a new reviewer.
3. Return the `Result:` line to `$elef-campaign` ACT. ACT — not this skill — classifies findings, applies the loop caps (10 rounds; same finding failing 3 consecutive rounds → `BLOCKED(repeat-finding)`) and updates status.

A `Result: PASS` is necessary but not sufficient: PASS also requires the exact machine marker and ACT's status transition.
