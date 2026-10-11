# ADR-013: Tag-driven desktop release with amended constitution terms

Reach for when: asking why the desktop release has no coordinator or ledger, or why the release behavior differs from the proposed release constitution.

- Status: Accepted
- Date: 2026-10-11
- Decider: Andres

## Context

The proposed desktop release constitution described two halves: a behavior half (Stable/Dev profiles, a macOS-only updater boundary, Arch packaging, local-only diagnostics, compatibility fixtures, and a CI release gate) and a publication half (a release ledger with a reconciler, coordinator trust, a Pages update feed, CAS proofs, and gate-failure notification). The v0 port carries the behavior half onto the refactored tree; the publication half is deferred as a follow-up.

Two constitution terms also conflicted with already-landed behavior on this tree: its close-gating term reintroduced save prompts that quiet-save had removed, and its ownership term assigned shareable UI to Rails `app/` after the editor shell had moved to the neutral `packages/editor-runtime` package.

## Decision

Ship v0 releases on the tag-driven flow with two amendments to the constitution terms:

- Amendment 1 (quiet-save wins): ported quit and update activation composes with quiet-save `flushForClose` outcomes instead of the constitution's prepare-gating. An ordinary quit with a pending update installs and relaunches only after a safe save; a failed save or conflict defers the update and keeps the window open. No new prompts appear on the save path.
- Amendment 2 (`packages/*` wins): shared editor behavior lives in its owning package, never in Rails `app/`. Profile selection lives in the desktop entry and build boundary only; no profile flag changes Rails behavior.

The constitution is not ported verbatim. The coordinator, ledger, Pages feed, CAS proofs, and gate-failure notification stay dropped; tag-driven draft → publish plus the GitHub Releases `latest.json` feed already delivers v0 auto-update, and the deferred half revives only with its own follow-up. Code plus CI is the specification: the profile gate, the fixture gate, and Gate A enforce what the constitution prose described.

## Consequences

- Release operations live in the [release operations guide](../release-operations.md): tagging, the draft → publish flow, Gate A, the tag-flow emergency block, AUR recovery, and the rehearsal checklist. User install and update behavior lives in [Install and use Elef Desktop](../install-and-use.md).
- The macOS updater boundary, Arch packaging, diagnostics, fixtures, and gates are enforced by `check_release_profiles.mjs`, `check_release_fixture_manifest.mjs`, `check_release_ci.mjs`, and `check_architecture.py`, not by prose.
- A future coordinator follow-up must revisit this record: reviving the ledger or Pages feed reopens the dropped-half rationale recorded here.
