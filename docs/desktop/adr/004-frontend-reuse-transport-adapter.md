# ADR-004: Reuse the Rails-owned frontend through desktop adapters

- Status: Superseded by [ADR-011](011-neutral-editor-runtime-package.md)
- Date: 2026-09-30 (revised 2026-10-01; superseded 2026-10-10)
- Decider: Andres
- Confidence: medium-high

> Superseded: shared product UI no longer lives under Rails `app/`.
> Shared interactive UI lives in `packages/client` (React) and
> `packages/editor-runtime` (Stimulus editor shell); both hosts consume
> those packages and no host imports from the other host. See ADR-011 for
> the v9 steady state. The record below is kept for history.

## Context

The web and desktop products should have the same editing, library, and document workflows. Maintaining parallel UI implementations would cause behavior and styling to drift.

## Options considered

- Reuse Rails-owned frontend behavior and provide desktop host adapters.
- Rewrite the editor and library as native desktop UI.
- Bundle Rails in the desktop application.

## Decision

Rails `app/` owns shareable product UI and behavior. Desktop builds those sources and adds the Tauri transport and native integrations. Desktop must not duplicate shareable HTML, CSS, controllers, or workflows. See [architecture](../../architecture.md) and [transport boundary](../transport-adapter.md).

## Consequences

- Playwright and WebdriverIO exercise the same scenario definitions against web and desktop.
- Library window chrome may differ where native behavior requires it; product interactions remain shared.
- A native rewrite needs a concrete, documented gap that shared code cannot solve.

## Revisit when

A named platform-specific feel or performance issue cannot be fixed in the shared frontend.
