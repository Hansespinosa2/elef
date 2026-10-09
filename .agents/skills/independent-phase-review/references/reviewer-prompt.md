# Elef phase {{PHASE}} independent review, round {{ROUND}}

You are a fresh-context reviewer. Audit the candidate independently; do not seek implementer reasoning or change sources.

## Inputs

- `{{BUNDLE}}/CONSTITUTION.md` — read intent/doctrine and boundary/validation/review rules.
- `{{BUNDLE}}/PHASE.md` — every criterion ID is required.
- `{{BUNDLE}}/PLAN.md` — frozen scope, finite checklists and fixed fixtures.
- `{{BUNDLE}}/status.json` and `SHAS.txt` — base {{BASE}}, candidate {{HEAD}}.
- `{{BUNDLE}}/diff.patch`, `diffstat.txt`, `evidence/` — raw proof and prior review findings.
- `{{WORKTREE}}` — repository detached at the candidate. Inspect relevant durable docs/code there.

## Verification

Confirm worktree HEAD, base ancestry, gate exit/candidate/hash, immutable gate status snapshot and frozen plan/contract identity. The snapshot head must exactly equal candidate HEAD; its base/phase/plan/contract match reviewed state. For gate reruns set ELEF_GATE_STATUS_PATH to the bundled immutable snapshot so the candidate's older embedded status cannot silently substitute. Rerun decisive read-only checks when available, serializing heavyweight work and reducing concurrency after resource kills. Source edits, commits and pushes are prohibited; ignored build outputs/dependency caches are allowed. Preserve unknown files.

For unavailable local native checks, verify stored CI evidence for the exact candidate and required real runner/scenarios. Inspect run/job URLs, source and tested checkout SHAs, commands/results and artifacts. A passing job that did not run the required scenario is insufficient. If neither local nor CI evidence exists, mark that criterion BLOCKED with the prerequisite. Keep the five human release gates explicitly pending; apply the phase contract's technical-versus-release distinction without pretending human acceptance occurred.

Judge every phase criterion and every constitution §7 invariant. Apply constitution §7’s explicit rollout schedule. An invariant marked N.A. needs its introduction/removal phase and locked baseline evidence; inherited migration debt cannot grow or silently become permanent. Record a criteria conflict if the contract cannot satisfy an invariant as written. Reject weakened evidence unless the phase explicitly permits a stronger/equivalent replacement. Subjective checks use only the plan's fixed fixtures/checklists. Stable finding IDs allow detection of repeat failures.

## Report

Write `{{BUNDLE}}/report.md`, naming your fresh session/process identity. Use exact metadata lines and one row per phase criterion and I01..I18. For P12-11 only, record `PENDING(ACT)` after verifying its completion-transition preconditions; final ACT verifies the actual checkpoint postcondition. Other phase criteria cannot be deferred.

```markdown
# Phase {{PHASE}} review — round {{ROUND}}
Candidate: {{HEAD}}
Base: {{BASE}}
Review context: <isolated session/process identity>

## Phase criteria
| Criterion | PASS/FAIL/BLOCKED | exact evidence | finding (stable ID) | required fix |
|---|---|---|---|---|

## Permanent invariants
| Invariant | PASS/FAIL/BLOCKED/N.A. | exact evidence or N.A. reason | finding (stable ID) | required fix |
|---|---|---|---|---|

## Human gates
<gate class, state and release impact>

## Verified / not verified
<actual commands/exits/platform/toolchain; exact CI evidence; unavailable checks>

Result: PASS
```

The single Result line is PASS only when every candidate criterion and applicable invariant passes, with only the explicitly labeled ACT postcondition pending. Otherwise use FAIL or BLOCKED(reason). Evidence is file:line, an actual command/exit/output, or verified CI run/job/artifact. Do not convert unavailable evidence into PASS. Name earlier round numbers when stable findings recur.
