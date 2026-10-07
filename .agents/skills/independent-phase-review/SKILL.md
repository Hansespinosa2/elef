---
name: independent-phase-review
description: Verify a candidate Elef phase through a fresh read-only agent session, independent of the implementer conversation, before ACT may claim PASS.
---

# Independent phase review

Constitution §8 owns reviewer independence, caps and output. The candidate must be committed; status names CHECK, its full head/base and current round; the immutable gate attempt stdout and actual exit metadata are captured (failed/unavailable evidence may be reviewed as BLOCKED). Validate the state before preparing inputs.

## Prepare or recover

Run `.agents/skills/independent-phase-review/scripts/review_bundle.sh prepare N K`. It verifies phase/round/candidate and creates an owned bundle plus detached worktree under `tmp/reviews/phase-N-round-K/`. Repeated preparation accepts only matching inputs. Existing reports are collected, never overwritten or reused for a changed candidate. The bundle includes authority, phase, status, frozen plan, diff, machine evidence and prior reviews, without implementer reasoning.

Release implementation-owned heavyweight processes before review, preserving the owner's server. Reviewers run sequentially.

## Launch with fresh context

Use a native new agent session with its own conversation, or an installed noninteractive CLI process in the detached worktree. Its task is `Read <bundle>/REVIEWER-PROMPT.md and follow it exactly.` A fork that inherits implementer history is unsuitable. Give read access to inputs/repository, write access to its report and required build outputs, and no commit/push authority. Inspect the installed CLI's flags. Reserve the context receipt with state launching before invocation; immediately record returned identity and state running, with PID/process-start identity for CLI processes, before waiting. Follow the campaign reference's receipt lifecycle.

If no isolated mechanism is available, record BLOCKED(reviewer-unavailable) with resume_state CHECK and an exact unblock condition. A tool approval rejection or missing credential is recorded as evidence, never replaced with self-review.

## Collect and ACT

1. On restart, inspect the launch receipt and process/session state. Wait for an existing reviewer or recover its complete report; start another only after confirming the earlier attempt cannot finish, retaining the failed attempt record.
2. Confirm the tool session/process actually terminated and retain its completion response or exit in terminal_evidence. Mark the receipt completed/failed/interrupted; a report appearing is insufficient. Inspect candidate/base/context and all criterion/invariant rows. Partial reports are incomplete even with Result: PASS. Copy a complete report verbatim into reviews and add its SHA-256 to the receipt.
3. Inspect worktree source changes. A tracked source change invalidates that review; preserve the worktree and evidence, then prepare a new round. Cleanup refuses dirty worktrees; classify unexpected files before removing anything. Run cleanup only after collection is safe.
4. Commit report/receipt and set ACT. Return PASS/FAIL/BLOCKED with the report's evidence to `$elef-campaign`. That skill applies fixes and loop caps; this skill never edits implementation or self-certifies.

Fresh reviewer PASS, exact-candidate gate exit 0 and a committed ACT PASS transition are all required for phase completion.
