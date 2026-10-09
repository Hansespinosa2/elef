# Phase 12 — Cleanup, durable docs, and final architecture audit

**Goal:** leave a small self-explanatory repository, not permanent migration machinery.

## PASS criteria

- **P12-01** temporary compatibility register is empty except items whose owner-approved removal condition has not yet occurred; each remaining item names exact condition.
- **P12-02** architecture allowlist is empty or every remaining entry has explicit owner approval and removal condition.
- **P12-03** every production package passes the package-admission law; reviewer records why `contracts`, `work-model`, `renderer`, `client`, and `local-store` earn their boundaries and rejects any extra unjustified package.
- **P12-04** no duplicate renderer, Work semantics, shared product feature implementation or shared product stylesheet exists across hosts.
- **P12-05** no mutable state has two semantic owners; reviewer uses the constitution state table as finite checklist.
- **P12-06** `ELEF-DOCTRINE.md`, `docs/architecture.md`, `docs/development.md` and specialized runbooks contain all durable knowledge required for maintenance; `AGENTS.md` is a short router.
- **P12-07** a fresh agent, without this constitution, correctly routes five unseen changes and names validation commands in ≤5 minutes each using only durable repo docs.
- **P12-08** `docs/refactor/` can be deleted in a throwaway checkout and the repository still builds/tests/docs-checks successfully; no durable documentation links depend on it.
- **P12-09** `bin/check all` passes twice on clean checkout with identical verdicts and no diff.
- **P12-10** full architecture review has a finite checklist: host logic leakage, client host knowledge, duplicate knowledge, state ownership, package justification, cross-feature cycles, temporary compatibility, overly broad APIs, test-only complexity in production, docs/reality mismatch. Every item PASS.
- **P12-11** (ACT postcondition) after the candidate gate and independent review authorize completion, ACT commits final campaign `status.json` as `PASS` with all technical phases complete and only explicitly named human release gates pending, if any. The candidate gate/reviewer verify the transition preconditions and record this row as `PENDING(ACT)`; after the commit, reconstruction verifies the actual final status and all thirteen checkpoints before final handoff. A pending transition alone never completes the campaign.
- **P12-12** campaign-only agent machinery is removed or marked for deletion with `docs/refactor/`; only durable skills that still reduce steady-state engineering complexity remain, and they reference durable SSOT rather than copied migration rules.
