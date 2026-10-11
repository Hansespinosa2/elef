# ADR-011: Shared editor shell lives in a neutral package (no host→host)

- Status: Accepted
- Date: 2026-10-10
- Decider: Andres (owner)
- Confidence: settled — owner interview 2026-10-10; code, `docs/architecture.md`, and ADR-004 already treat the neutral package as decided

## Context

The desktop application booted ~45 web-host JavaScript files (~9.9k lines:
Stimulus editor shell + application bootstrap) through a build-time alias that
rewrote `lib/` and `controllers/` imports into `apps/web/app/javascript/`.
That is a host→host dependency, forbidden by the architecture rule that hosts
never depend on each other, and it stranded navigation and orchestration
outside their owning package. A full React migration of the editor core was
estimated at ~10k redesigned lines with typing-path risk — its own effort, not
cleanup. This ADR sets the steady state. It supersedes ADR-004 ("Rails `app/`
owns shareable product UI").

## Options considered

- A. Full migration: de-Stimulus the shell into the React client (~10k lines
  redesigned; typing-path risk).
- B. Neutral package: rehome the shell verbatim into `packages/editor-runtime`
  with a narrowed boot API; both hosts consume the package; the alias and the
  transitional ownership rule retire. (Owner-selected.)
- C. Waiver: bless the alias as steady state. Rejected: fossilizes the defect
  the refactor existed to remove.

## Decision

`packages/editor-runtime` (name owner-confirmed) is permanent architecture,
not transitional debt. The shared Stimulus editor shell and desktop bootstrap
live there; both hosts consume the package; no host imports from the other
host. Shared interactive UI lives in `client` (React) and `editor-runtime`
(Stimulus editor shell), each the single owner of its surface. Revisit trigger
(not a removal condition): if Stimulus ever blocks a product feature or
demonstrably drags feature velocity, a migration may be proposed on that
evidence as its own effort.

Settled in the decision interview 2026-10-10 (owner chose permanent over
transitional). Rationale: the team ships fast in Stimulus; no velocity pain
exists to justify debt status; a vague "someday migrate" condition would be
fiction.

## Consequences

- ADR-004 ("Rails `app/` owns shareable product UI") is superseded by this
  record; its status is Superseded.
- Two UI frameworks are an explicit, owned, permanent property:
  contributors meet React (client) + Stimulus (editor-runtime); the seam is
  the narrowed boot API + mount tokens, enforced by the boundary checkers.
- `check_frontend_ownership.py`'s transitional Rails→desktop rule retires,
  replaced by a permanent no-host→host tripwire.
- TypeScript lives in packages only; host code stays thin JavaScript glue
  typed at the seams.

## Documentation amendment — 2026-10-11

Refactor-campaign process references (phase numbers, review rounds, frozen
plan items) were removed from this record after the campaign retired; the
decision, rationale, and consequences are unchanged.
