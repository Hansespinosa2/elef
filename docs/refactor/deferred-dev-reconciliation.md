# Deferred dev reconciliation (owner decision, Phase 07)

Status: standing campaign rule until the post-campaign endgame. Single home for
this decision; phase contracts and gates link here, they do not restate it.

## Decision

`dev` keeps moving while the v9 campaign runs, and the campaign branch does not
merge `dev` back until the post-campaign endgame ("phase 13"). Consequences the
owner accepted:

- PR #136 (and any successor campaign PR) may stay CONFLICTING with `dev`
  for the rest of the campaign. PR mergeability is not a phase gate.
- New features built on `dev` against the old architecture are reconciled
  into v9 semantics once, at the end, as owner-led merge work — not
  interleaved with in-flight phases.
- Campaign phase diffs stay reviewable against their frozen plans because
  `dev` inflow never enters a phase candidate mid-phase.

## CI rule while the PR is conflicted

GitHub silently skips `pull_request` synchronize runs for a conflicted PR, so
the pull-request-only `record-ci-attestation` job cannot succeed. Until the
endgame, phase gates accept this equivalent instead (implemented in
`bin/check` per phase, starting with phase 7):

- a green `workflow_dispatch` run on the exact candidate tree, plus
- `run.head_sha == candidate_sha` in the evidence file.

Reasoning: a dispatch run tests the candidate commit itself, so matching SHAs
bind the validated tree exactly — tighter than a PR merge-ref binding, which
tests candidate-plus-base. Nothing about product assurance is weakened; only
the event that collects the evidence changes.

Phase gates for phases 8 and later implement the same equivalence instead of
requiring the pull-request-only job. When the endgame restores a mergeable
PR, later runs may return to pull-request evidence with no rule change needed
(the gate already accepts both shapes).

## Endgame scope (post-Phase-12 PASS)

1. Reconcile `dev`'s accumulated features into v9 (port new dev-built
   behavior into the new architecture; owner-led).
2. Merge the campaign branch to `dev` (owner action; remains outside the
   technical campaign).
3. Human release gates per the constitution then apply.

## History

- Phase 07: PR #136 went CONFLICTING after dev PR #141 merged. Repair
  candidate `7f3f6c7` went fully green via dispatch
  ([run 37882870249](https://github.com/Hansespinosa2/elef/actions/runs/37882870249))
  while pull-request CI stayed silent. Isolated gate at that candidate passed
  everything except the unattainable attestation job. Owner approved deferral
  and the equivalence above; the gate correction landed in the same commit
  as this file.
