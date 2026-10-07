# Phase 06 — Work links and graph

**Goal:** separate graph semantics from graph visualization without inventing a graph package.

## PASS criteria

- **P06-01** Work link syntax/resolution and semantic node/edge derivation live in `work-model`.
- **P06-02** graph layout, coordinates, selection, zoom and visual interaction live in `client/features/graph` (or equivalent feature module), not `work-model`.
- **P06-03** no `packages/graph` exists unless the phase reviewer documents evidence satisfying every package-admission rule; default expectation is no package.
- **P06-04** ambiguous/broken link behavior matches baseline fixtures.
- **P06-05** stale async graph/search results after navigation are rejected by request/work identity.
- **P06-06** graph scenarios pass on both hosts using one scenario definition.
