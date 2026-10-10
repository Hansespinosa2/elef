# ADR-011: Shared editor shell lives in a neutral package (no host→host)

- Status: Draft (decision interview in progress; NOT accepted)
- Date: 2026-10-10
- Decider: Andres (owner)
- Confidence: unsettled — see Unresolved below

## Context

The desktop application boots ~45 web-host JavaScript files (~9.9k lines:
Stimulus editor shell + application bootstrap) through a build-time alias that
rewrites `lib/` and `controllers/` imports into `apps/web/app/javascript/`.
That is a host→host dependency, forbidden by the frozen constitution §4
("hosts never depend on each other"), and it strands navigation/orchestration
outside the §5 owner ("navigation → client application"). The campaign's
transitional Rails→desktop ownership rule (`check_frontend_ownership.py`)
never retired. Phase 4–9 contracts never scoped a de-Stimulus of the editor
core (Phase 8 scoped P08-01 to session/text ownership), so a full React
migration is a second campaign, not cleanup. This ADR sets the v9 steady
state. It supersedes ADR-004 ("Rails `app/` owns shareable product UI").

## Options considered

- A. Full migration: de-Stimulus the shell into the React client (~10k lines
  redesigned; 3–5 phases; typing-path risk; collides with the Stimulus-shaped
  dev port).
- B. Neutral package: rehome the shell verbatim into `packages/editor-runtime`
  with a narrowed boot API; both hosts consume the package; alias and
  transitional rule retire. (Owner-selected fork.)
- C. Waiver: bless the alias as steady state. Rejected: fossilizes the defect
  the campaign existed to remove.

## Decision

`packages/editor-runtime` (name owner-confirmed) is permanent
v9 architecture, not transitional debt. The shared Stimulus editor shell and
desktop bootstrap live there; both hosts consume the package; no host imports
from the other host. The §4 "client = the complete host-neutral interactive
application" sentence is amended to: shared interactive UI lives in `client`
(React) and `editor-runtime` (Stimulus editor shell), each the single owner
of its surface. Revisit trigger (not a removal condition): if Stimulus ever
blocks a product feature or demonstrably drags feature velocity, a migration
may be proposed on that evidence as its own effort.

Settled in the decision interview 2026-10-10 (Q1: owner chose permanent over
transitional). Rationale: the team ships fast in Stimulus (three dev features
landed in it); no velocity pain exists to justify debt status; a vague
"someday migrate" condition would be fiction in the P12-01 register.

## Consequences

- ADR-004 ("Rails `app/` owns shareable product UI") is superseded by this
  record; its status moves to Superseded when this ADR is accepted.
- The package faces the package-admission law in writing (phase-12 plan §3);
  P12-03 reviewer judgment covers six packages. No P12-01 register entry.
- Two UI frameworks are an explicit, owned, permanent v9 property:
  contributors meet React (client) + Stimulus (editor-runtime); the seam is
  the narrowed boot API + mount tokens, enforced by the boundary checkers.
- `check_frontend_ownership.py`'s transitional Rails→desktop rule retires,
  replaced by a permanent no-host→host tripwire.

## Unresolved

1. (Campaign scope, recorded in the phase plan, not here) #148/#149 deletion
   timing, TS strictness bar, package name confirmation, host-TS scope,
   agent launch.
2. Final acceptance of this ADR (Draft → Accepted) at plan freeze / review.
