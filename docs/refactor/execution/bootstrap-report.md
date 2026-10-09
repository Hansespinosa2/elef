# Agent-system installation and revision evidence

## Scope and authority

This revision prepares the installed workflow for a fresh agent told `go`; it does not execute product migration. The current state remains Phase 00 PLAN, review round 0, without a frozen plan or completed phase.

Reviewed sources: root README; original DROP-IN, bootstrap prompt/docs/templates; constitution; all thirteen phase contracts; status/template; kickoff; durable architecture/development docs; root AGENTS; and all five installed skills, references and helpers. Retired source scaffolding remains available in Git history at `7ea43d33c7abcedef25aaf1b9710fec9674a0690`.

Architecture and phase criteria remain in the constitution/contracts. The revised router distinguishes target rules, current implementation facts and execution state. Explicit protocol clarifications resolve staging deadlocks: initial PLAN freezes are committed before DO rather than waiting for the later phase review/ACT; constitution §7 identifies when target-owner invariants are introduced while retaining every final requirement; P12-11 remains mandatory as an ACT postcondition after its authorizing candidate review. No package boundary, contract API, behavior, performance ceiling or final technical requirement was relaxed. Phase 00's active contract and status hash are unchanged.

## Installed workflow

| Skill | Responsibility |
|---|---|
| `elef-campaign` | Numeric phase execution, repository-only resume, committed freezes, isolated gate attempts, evidence reconstruction and blockers |
| `implementation-strategy` | Semantic ownership, package admission, fixed scope, deletions, rollback and criterion proof map |
| `code-change-verification` | Proportional canonical checks, explicit toolchains, resource recovery and actual results |
| `independent-phase-review` | Immutable owned bundles, fresh reviewer sessions, context receipts, complete reports and safe collection |
| `docs-sync` | One fact owner, current documentation and coordinated Phase 12 retirement |

The router and installed skills are read-only campaign instructions except for expressly planned final retirement/repointing. A future workflow correction requires an evidenced blocker and owner-approved change. Git does not enforce filesystem write protection; this is the campaign's instruction policy.

Gate attempts execute a detached committed candidate, retain streamed partial and failed output, and select completed results atomically. Unknown root files cannot enter the candidate checkout. PASS reconstruction requires exact predecessor checkpoints, a committed plan freeze before production, committed CHECK/ACT authorization, exact candidate gate success, complete criterion/invariant review rows, and a matching independent launch/report receipt. Bookkeeping changes preserve a review round's original input snapshot. Dirty or unowned worktrees are retained for inspection.

## Lineage

- Campaign branch: `feat/refactor-desktop-and-web`.
- Campaign base: `88f61a7a8ffd7c276bafcf06eee09c36a8adf134` (v9 source bundle).
- Base parent: `b266299838deddec2d00fef80f6c5bbebb4c607e` (desktop-v1 merge).
- Pre-refactor reference: `f9e00e026ab4249d99dc2fe0816ace6e3e5331db`.
- Reference-to-base ancestry was checked with `git merge-base --is-ancestor` (exit 0).
- The campaign remote matched the pre-revision HEAD `7ea43d33c7abcedef25aaf1b9710fec9674a0690` after fetch. Later `dev` changes do not replace the frozen campaign base.

## Verification

- All five skill manifests passed the skill creator's `scripts/quick_validate.py` (exit 0 each).
- `PYTHONDONTWRITEBYTECODE=1 python3 .agents/skills/elef-campaign/scripts/test_campaign_state.py`: 34 tests, exit 0. [Verbatim summary](agent-system-fixtures.txt) covers freezes/re-plans, failed/partial gates, isolated retries, report/context identity, dirty cleanup, bookkeeping recovery, committed ACT history and a complete synthetic thirteen-phase chain.
- `campaign_state.py validate --json`: valid Phase 00 PLAN, no errors or warnings.
- `campaign_state.py reconstruct`: earliest unproven Phase 00, no proven checkpoint, as expected before migration.
- Python AST syntax checks and `bash -n .../review_bundle.sh`: exit 0. Final staged whitespace validation excludes the verbatim round-1 report, whose two trailing spaces are intentional Markdown line breaks; all other changes pass `git diff --cached --check`.

Synthetic Git fixtures exercise protocol mechanics only; they never create actual campaign PASS evidence. [Fresh `go` startup report](go-acceptance.md) and [receipt](go-acceptance-context.json) record a separate ephemeral agent in an isolated clone. Its only user prompt was `go`; a developer boundary restricted the acceptance exercise to read-only startup. It selected the campaign and strategy skills, loaded authority, found Phase 00 PLAN, validated/reconstructed state and identified missing baseline/plan/tooling/native prerequisites. This proves startup routing and evidence recovery, not completion of the product migration. Its `/tmp` checkout has different free disk from the campaign checkout; it did not change the locked baseline.

## Independent findings and corrections

[Round 1](agent-system-review-round-1.md) identified nine defects. Committed freeze/CHECK/ACT/predecessor history, blocked guards, complete phase inventory, immutable retry evidence, isolated inputs, stable round snapshots, staged invariant applicability and factual acceptance reporting now have explicit checks or authority corrections.

[Round 2](agent-system-review-round-2.md) ([receipt](agent-system-review-round-2-context.json)) independently inspected the shared tree and found four remaining issues. All four corrections have dedicated fixture coverage. The exact-head/status cycle is resolved through a hashed immutable DO gate snapshot consumed by `ELEF_GATE_STATUS_PATH`; blocked phase counters retain the ordinary phase-position invariant; gate/checker process identities and checkout activity prevent overlapping retries/cleanup; reviewer receipts require actual terminal evidence and collected report identity before cleanup. The development guide now labels the protected server as interactive preview and sends automation to isolated test environments. The reviewer also verified the same-byte re-plan and BLOCKED ACT corrections added during its audit.

[Round 3](agent-system-review-round-3.md) ([receipt](agent-system-review-round-3-context.json)) reviewed the staged source independently and found one remaining gap: completed attempts bound stdout but not stderr. Both streams are now hashed and verified, and missing/changed stderr has regression coverage. It reported no other blocking findings in the reviewed recovery, identity, phase-proof or cleanup paths.

## Cleanup

Removed setup-only `bootstrap/`, DROP-IN, fallback `.agents-temp/`, AGENTS-TEMP, the installer/patch and preliminary revision report. Updated kickoff and README links to installed skills. Runtime plan/reviewer references and status initialization remain because later phases and restart recovery consume them. Retained audit reports and this factual lineage record are campaign evidence, not installation templates.

The existing campaign PR is [draft #136](https://github.com/Hansespinosa2/elef/pull/136), targeting `dev`; no duplicate was created.

## Practical prerequisites

The campaign checkout probe reported Linux x86_64, 27,831 MB RAM, 55,657 MB swap, 16 CPUs, 234,321 MB free disk, display `none`, native runner `unavailable`, and port 3000 in use. Detected defaults were Node 26.10.0, Ruby 4.0.6, Cargo/Rust 1.98.0, Python 3.14.7, Chromium 152 and PostgreSQL 18.6. These are observed defaults, not approval to replace locked versions. Recursive shell wrappers for `codex`/`gh` were bypassed using their actual installed binaries; the skill records that recovery and instructs future agents to preserve global configuration.

The environment probe is factual and does not install toolchains. Node-sensitive checks require Node 22; Ruby and other locked versions must be verified against the current repository during Phase 00. Missing native webview/display tooling must be installed within authorized scope or supplied by verified exact-candidate CI. Signing, real device first installs, live deployment and soak remain the five named human gate classes. No product, native, browser, macOS or release test is claimed by this preparation audit.
