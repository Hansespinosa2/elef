# Elef Agent Instructions

Elef is one product hosted by Rails web and standalone Tauri desktop. Shared product behavior has one canonical implementation; host-specific behavior stays in host/native adapters.

## Start here

For the active refactor campaign, authority is:

1. `docs/refactor/CONSTITUTION.md`
2. `docs/refactor/status.json`
3. the current `docs/refactor/phases/NN-*.md`
4. the frozen phase plan named by status
5. durable repository docs and code

Do not duplicate these rules here.

## Skill routing

- If the user says **go**, continue, resume, finish, or run the refactor campaign: use `$elef-campaign`.
- Before a new campaign phase or nontrivial architecture/runtime/product change: use `$implementation-strategy`.
- After code, build, test, contract, or runtime behavior changes: use `$code-change-verification`.
- Before any campaign phase may be marked PASS: use `$independent-phase-review`.
- When durable docs or campaign state may change: use `$docs-sync`.

Do not invoke every skill for every trivial edit.

## Autonomy

Within campaign scope, agents may autonomously:

- inspect the repository and history;
- edit implementation/tests/docs;
- run deterministic local checks;
- fix failures caused by their work;
- create safe temporary worktrees;
- create checkpoint commits;
- advance between verified phases;
- resume from `docs/refactor/status.json`.

Do not ask for routine implementation decisions already resolved by repository authority.

## Safety

Never:

- discard unknown user changes;
- reset/rewrite unrelated work;
- weaken criteria/tests/baselines/fixtures to obtain PASS;
- silently change a frozen phase contract;
- grow an architecture allowlist merely to pass;
- invent credentials or signing material;
- claim an unrun or unavailable test passed;
- merge the campaign into `dev` or perform human-only release gates unless repository authority explicitly changes that rule.

## Verification

Use the repository's canonical `bin/check` entry point and `$code-change-verification`.

Ordinary edit loop: `quick` then `affected`.
Phase/full/native validation belongs at the appropriate gate, not after every small edit.

The normal autonomous environment is a resource-constrained Linux container (~8 GB RAM). Serialize unrelated heavyweight jobs, preserve safe caches, reduce concurrency on resource pressure, and never substitute a mock for unavailable native/macOS evidence.

## Campaign completion

A phase is complete only when its exact machine PASS marker, fresh independent reviewer PASS, and status transition all exist.

If status and repository reality disagree, reconstruct from evidence and resume from the earliest unproven phase.

Stop only at final technical PASS or a constitution-defined BLOCKED/human-gate condition.
