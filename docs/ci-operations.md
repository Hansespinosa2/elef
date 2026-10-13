# CI operations

Reach for when: changing CI lanes or gates, reading the shadow plan, shepherding dev, promoting dev to main, or sizing sharding work.

## Lanes

| Lane | Workflow | Trigger | Purpose |
|---|---|---|---|
| Quick (PR) | `.github/workflows/ci.yml` | PRs, pushes to dev/main, dispatch | Thirteen evidence jobs plus Gate A; every PR must be fully green in v0 |
| Plan (shadow) | `plan` job in `ci.yml` | PRs and dispatch, never pushes | Reports which jobs a change affects; suggests skips but skips nothing |
| Matrix | `ci-gate` job in `ci.yml` | Always after plan + evidence | Ran/skipped matrix in the run summary: what failed where |
| Slow | `.github/workflows/slow-lane.yml` | Pushes to dev, dispatch | Full `bin/check all` envelope on the merged dev tip, with a status job |
| Nightly | `.github/workflows/nightly-diagnostic.yml` | Daily 06:00 UTC, dispatch | Timing ledger (longest-first) plus dev/main standing health; read-only |
| Measurement | `sqlite-compatibility.yml`, `native-performance.yml` | Dev pushes, schedule, dispatch | Full SQLite suite and native benchmarks; declared non-gating |
| Release | `.github/workflows/desktop-release.yml` | `desktop-v*` tags only | Draft, assets, publish, AUR (see [Desktop release operations](desktop/release-operations.md)) |

PRs land on a maximally information-dense signal. The fast-lane *target* is 10 minutes wall-clock (`desktop-fast` holds itself to 300 s; `plan` and `ci-gate` each carry a 10 min timeout), but this is unproven on a live PR as of this writing — the first PR run after merge is the proof, and `plan`'s full-history checkout (`fetch-depth: 0`) is the known overrun risk. The heavy evidence jobs still run on every PR during v0 — speed comes from caches and in-job lanes, not from skipping required work. Browser/desktop parity assertions still run on the PR in v0 (nothing was removed); the slow lane adds merged-tip parity coverage. Deferring anything off a PR later is allowed only when the failure location stays visible in the PR summary or status — that cross-posting is not yet wired (the slow lane posts only its own run summary), so no deferral may ship until it is.

## Shadow planner

`tooling/ci_affected.py` maps a changed-file list to the evidence jobs that can observe it. The `plan` job diffs the PR against its base and publishes the affected set, the shadow suggested skips, and the reasons to the run summary, plus a `plan.json` artifact. Enforcement is off: `ELEF_CI_PLAN_ENFORCE: "0"`, and the deployment verifier rejects any attestation outside shadow mode.

Planner rules that are load-bearing:

- All filtering stays in-job. Evidence jobs never gain push/PR `if:` conditions to skip work; a job that does less still runs and still reports success, so gate `needs` semantics never change.
- `plan` and `ci-gate` are informational. They must never appear in `release-gate` or `record-ci-attestation` needs (enforced by `check_release_ci.mjs` and `ci_single_run_test.rb`).
- Lockfile changes route to both desktop jobs, so the in-job audits observe them on Linux and macOS (pinned by the planner self-test).
- The `arch-package` invocation shape never changes (pinned container, exact SHA); the planner may only suggest skipping that job, never reshape it.
- Unknown paths, workflow changes, and empty diffs fail closed to the full thirteen.

Preview a change locally before pushing:

~~~sh
git diff --name-only origin/dev...HEAD > /tmp/elef-diff.txt
python3 tooling/ci_affected.py --diff-file /tmp/elef-diff.txt --format table
~~~

The planner map is pinned by 20 fixture diffs under `tooling/ci_affected_fixtures/` plus inline rule-order cases, all run by `tooling/ci_affected.py --self-test`, which is wired into `bin/check quick` and `desktop-fast`.

### Enforcement-flip checklist (post-v0, all required before any skip is honored)

1. The shadow plan has agreed with human judgment on at least two weeks of PRs, with disagreements filed as planner bugs and fixed.
2. The attestation carries the per-PR plan (affected set, suggested skips, planner version) and the verifier validates every skipped job against it; both ship in one change with `deployment_authorization_test.sh` cases proving accept/reject.
3. `ci_single_run_test.rb` and `check_release_ci.mjs` assert the new contract (schema version, plan block, needs discipline).
4. The flip itself is a separate, explicitly approved change — never bundled with a planner-map edit.

## Overhead-first speedups

Order of operations: caches, then in-job parallel lanes, then measured sharding, then selection. v0 ships:

- Finished cache coverage: npm, Rust, Ruby bundler (pre-existing), plus the pinned `cargo-audit` binary and Playwright browsers skipped on cache hit (OS deps still install every run; a cached browser without them would fail).
- Three in-job lanes in `desktop-fast` (Rust, Node suites, checkers), longest-first, with per-lane logs and the 300 s wall budget intact. `bin/check` stays sequential for local determinism.
- The nightly timing ledger (`tooling/ci_report.py timing`): per-step average/max/failure counts, longest-first. No sharding change lands without two weeks of ledger data, and shards split longest-first.

## Deploy gating

Both `dev` and `main` auto-deploy to the Mac mini servers on a green full pass; red never deploys. The mechanism is unchanged from the pre-v0 flow, with the attestation now at schema 3 carrying the shadow plan block:

1. A PR runs the full evidence suite; `record-ci-attestation` writes `deployment-attestation.json` (schema 3, required-job manifest, non-gating policy, shadow plan, tested tree).
2. After merge, `publish-deployment-ref` re-verifies the merged PR's checks, the attestation, and the tested tree, then advances `elef-deploy-dev` or `elef-deploy-main` (fast-forward only).
3. The machine-local watcher builds and starts the matching Compose instance. See the [Mac mini deployment runbook](mac-mini-deployment.md#automatic-deployment).

There are no exemptions: the verifier gates `dev` and `main` identically, and with enforcement off every merge to either branch passes full PR CI. `dev` may still go red after merge (flakes, systemic failures) — that is what the slow lane surfaces and the shepherd loop cleans up — but no branch is exempt from the full-suite gate, and nothing in this doc authorizes leaving `dev` red.

## Manual promotion (user only)

Only the owner promotes `dev` to `main`, at their discretion, normally when dev is fully green. The shepherd never promotes, and no automation merges the promotion PR. The helper prints the plan by default and opens the PR only with `--create`:

~~~sh
tooling/release/promote-dev-to-main            # dry run: commits, lane state, PR body
tooling/release/promote-dev-to-main --create   # open the PR (refuses while lanes are red)
tooling/release/promote-dev-to-main --create --allow-red "reason"  # recorded override
~~~

Merge the promotion PR by hand after it is fully green. Tag desktop releases only after the promotion, per [Desktop release operations](desktop/release-operations.md#tag-a-release).

## Shepherd loop (dev)

A standing agent loop keeps dev moving: it batches ready PRs, re-runs flaky jobs with evidence, reverts red merges that block the lane, lands product fixes for CI failures, and merges land-when-green PRs once their checks pass. It runs on a short cadence (every 15–30 minutes while PRs are active, hourly otherwise) and reads lane state with:

~~~sh
python3 tooling/ci_report.py status --repo Hansespinosa2/elef --branches dev,main
~~~

### Guardrails (non-negotiable)

> Process-only today: no branch protection, ruleset, CODEOWNERS, loop script, or status poster is committed yet, so these guardrails bind the operator by convention, not by automation. A direct push to `main` would deploy unreviewed code only if it is green-gated and tree-matched — the deploy backstop (red never deploys) holds regardless — but it would bypass review, and a stalled loop means red `dev` goes unnoticed. Committed enforcement is future work; until then the owner confirms the loop is running before relying on it.

- Never push to `main`, never merge the promotion PR, never tag a release.
- Never rewrite shared history: no force-push to `dev`/`main`, no rebase or amend of landed commits.
- Never land a fix without `bin/check quick` (and `affected` before handoff, per the change).
- Never act silently: every loop iteration ends in a standing-status message; every action (re-run, revert, merge) is announced with its reason and proof.
- Never weaken a test, check, baseline, or fixture to obtain green, and never silently change a frozen contract.

### Status shapes

Standing status (posted every iteration, even when idle):

~~~text
Elef CI standing status (<UTC time>)
- dev: <CI lane conclusion> / <slow-lane conclusion>; deploy ref <sha-or-behind>
- main: <CI lane conclusion>; deploy ref <sha-or-behind>
- Queue: <PRs waiting, with state>
- Action this round: <none | rerun X | reverted Y | merged Z + proof>
~~~

Alert (posted immediately when dev turns red or a deploy ref stalls):

~~~text
Elef CI alert (<UTC time>): <dev red | deploy ref stale>
- What failed where: <job> ([run](<url>)), ...
- Suspected cause: <PR/sha or unknown>
- Next step: <rerun | revert | fix PR> by <who>
~~~

### Rollback triggers

- A shepherd merge turns dev red: revert the merge first, diagnose second.
- Two consecutive slow-lane failures on different SHAs: stop merging, treat as an environmental or systemic failure, page the owner.
- Any deploy authorization failure on a green-looking PR: stop, treat the attestation chain as suspect, page the owner.
