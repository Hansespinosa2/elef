# ADR-011: Shared editor shell lives in a neutral package (no host→host)

Reach for when: touching editor boot, the client/editor-runtime seam, or host adapter wiring.

- Status: Accepted
- Date: 2026-10-10
- Decider: Andres

## Context

The desktop booted ~45 web-host JavaScript files (~9.9k lines of Stimulus editor shell plus bootstrap) through a build-time alias rewriting imports into `apps/web/app/javascript/`. That is a host→host dependency, forbidden by the architecture rule that hosts never depend on each other. A full React migration of the editor core was estimated at ~10k redesigned lines with typing-path risk — its own effort, not cleanup.

## Options considered

- Full migration: de-Stimulus the shell into the React client (~10k lines redesigned; typing-path risk).
- Neutral package: rehome the shell verbatim into `packages/editor-runtime` with a narrowed boot API; both hosts consume the package (chosen).
- Waiver: bless the alias as steady state. Rejected: fossilizes the defect the refactor existed to remove.

## Decision

`packages/editor-runtime` is permanent architecture, not transitional debt. The shared Stimulus editor shell and desktop bootstrap live there; both hosts consume the package and no host imports from the other host. Shared interactive UI lives in `client` (React) and `editor-runtime` (Stimulus shell), each the single owner of its surface. This supersedes the retired "Rails `app/` owns shareable product UI" arrangement. Revisit trigger (not a removal condition): if Stimulus ever blocks a product feature or demonstrably drags feature velocity, a migration may be proposed on that evidence as its own effort.

## Consequences

- Two UI frameworks are an explicit, owned, permanent property; the seam is the narrowed boot API plus mount tokens, enforced by the boundary checkers.
- TypeScript lives in packages only; host code stays thin JavaScript glue typed at the seams.
