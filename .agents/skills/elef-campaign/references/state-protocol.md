# Campaign state protocol (mechanics)

Workflow conventions for `$elef-campaign`. They implement, and never override, `docs/refactor/CONSTITUTION.md` §1/§8/§10. If anything here conflicts with the constitution, the constitution wins and this file must be fixed via `$docs-sync`.

## Files

| Path | Written by | Content |
|---|---|---|
| `docs/refactor/status.json` | orchestrator | the single machine state (schema: constitution §1) |
| `docs/refactor/execution/phase-N-plan.md` | PLAN | frozen execution plan (template: `$implementation-strategy`) |
| `docs/refactor/execution/phase-N-gate.txt` | CHECK | exact stdout of `bin/check phase N --json` for the candidate |
| `docs/refactor/execution/phase-N-*.{md,json,log}` | DO/CHECK | other phase evidence (timings, probes, audits) |
| `docs/refactor/execution/status-reconstruction.md` | reconstruction | evidence used whenever status was rebuilt |
| `docs/refactor/execution/bootstrap-report.md` | bootstrap | agent-system install facts and deviations |
| `docs/refactor/reviews/phase-N-round-K.md` | reviewer (copied verbatim) | review report ending in `Result:` |
| `docs/refactor/baseline.{md,json}` | Phase 00 | baseline facts (phase contract) |

`tmp/reviews/` holds disposable review bundles (gitignored).

## Status conventions

A commit cannot contain its own SHA, so:

- `head_sha` = the candidate commit last verified/reviewed (in PLAN/DO: the latest commit the status describes, usually `phase_base_sha` or the last checkpoint). After `head_sha`, in states CHECK/ACT/PASS, only `docs/refactor/status.json`, `docs/refactor/reviews/**` and `docs/refactor/execution/**` may change; any other change invalidates the review (the validator enforces this).
- `phase_base_sha` = the commit that recorded the previous phase's PASS (for Phase 00: `campaign_base_sha`).
- `phase_contract_sha256` = SHA-256 of `docs/refactor/phases/NN-*.md` at phase start. A mismatch later means the contract changed: stop; only the owner (or an approved ADR for a later phase) may change it — `BLOCKED(criteria-conflict)` otherwise.
- `frozen_plan_sha256` = SHA-256 of the plan at freeze. Re-planning appends a dated *Re-plan* section explaining the defect, re-freezes, and records the new hash in the same commit.
- `last_verified_checks` = list of `{"command", "exit", "head", "duration_s", "tier"}` for checks that actually ran; never list a check that did not run.
- `blocker` = `{"code": "<constitution BLOCKED reason>", "detail": "...", "evidence": "<path/command>", "unblock": "<exact owner action>"}`.
- `pending_human_gates` = items `{"gate": 1-5, "phase": N, "detail": "..."}` using only the five gate classes in constitution §8.
- `next_action` = one executable sentence a fresh agent can act on.

State transitions: `PLAN → DO → CHECK → ACT → (DO | PLAN | PASS | BLOCKED)`; `PASS(N) → PLAN(N+1)` in a separate commit. `BLOCKED → <previous state>` only after the unblock condition is evidenced (record it).

## Commit conventions

Concise imperative subjects, no co-author trailers, never rewrite history:

- `Freeze phase N plan` · `Re-freeze phase N plan` · `Request phase N review round K` · `Record phase N review round K` · `Record phase N PASS` · `Start phase N+1` · `Block phase N: <code>` · `Reconstruct campaign status`
- Implementation commits describe the change itself (e.g. `Move elef-core into crates/local-store`).

Push the campaign branch after every status-changing commit that ends a step (freeze, review request, PASS, BLOCKED) and before any session ends: `git push origin feat/refactor-desktop-and-web` (never `--force`).

## Draft PR and remote CI evidence

The campaign PR (`feat/refactor-desktop-and-web` → `dev`) is the final owner merge boundary. Open it as a **draft** during Phase 00 if it does not exist (check with the GitHub integration first; use `.github/pull_request_template.md`, explain validation and database/migration impact, never record merge status). CI runs on pull-request pushes and covers native Linux (xvfb) and macOS Tauri jobs, so CI run results for the exact candidate SHA are acceptable evidence for native criteria — cite run URL + job + SHA in the gate/evidence files. Never mark the PR ready-for-review as a substitute for owner review, and never merge it.

## Native runner policy

- Never open visible windows on the owner's desktop (no setting `WAYLAND_DISPLAY`/`DISPLAY` to drive real Tauri locally). Local native runs need `xvfb-run` + `tauri-driver` + `WebKitWebDriver`; user-space installs (e.g. `cargo install tauri-driver --locked`) are allowed, system package installs needing `sudo` are not.
- If the local native runner is unavailable, use CI on the draft PR for the candidate SHA. If neither yields evidence, the criterion is `BLOCKED(native-runner-unavailable)` with the exact missing prerequisite in `blocker.unblock`; never a mock PASS.

## Reconstruction (status missing, stale or inconsistent)

1. `campaign_state.py reconstruct` → earliest phase lacking gate + PASS review evidence.
2. Verify against git: `git log --oneline --decorate <campaign_base>..HEAD`, the gate file's `head` is an ancestor of HEAD, the PASS review names that same candidate, and no non-evidence files changed between that head and the phase's PASS commit.
3. Completion is never inferred from file presence, plan presence, or commit subjects alone.
4. Resume at the earliest unproven phase: PLAN if no valid frozen plan exists for it, otherwise DO (plan exists and its hash is consistent) — re-verify any claimed DO progress by running checks.
5. Write `docs/refactor/execution/status-reconstruction.md` (what was inspected, commands, conclusion), regenerate `status.json` (use `init` only if absent, then edit), `validate`, commit `Reconstruct campaign status`.

`campaign_base_sha` for v9 is recorded in `docs/refactor/execution/bootstrap-report.md` with its lineage proof; do not change it.

## Final handoff (after Phase 12 PASS)

Report only: final campaign state; final HEAD; completed phases; verification evidence (paths/CI runs); pending human-only release gates; unresolved blocker if any; the draft PR URL. Then stop.
