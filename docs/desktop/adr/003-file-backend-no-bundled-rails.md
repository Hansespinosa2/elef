# ADR-003: File-backed desktop backend

- Status: Proposed
- Date: 2026-09-30 (revised 2026-10-01)
- Decider: Andres
- Confidence: high
- Accepted when: the desktop adapter contract and all required shared-editor operations are covered by the cross-host scenarios

## Context

The Rails web app persists through its own application stack. Desktop decks must remain ordinary user-owned folders and work without a local server or database service.

## Options considered

- **Rust file backend:** native filesystem operations over deck folders.
- **Bundled Rails:** would package a server and replace the web app's persistence layer.

## Decision

Desktop uses Tauri commands backed by `elef-core`; it does not bundle Rails or a database server. Rails remains responsible for web persistence. The desktop integration boundary is described in [transport-adapter.md](../transport-adapter.md).

## Consequences

- File operations can be tested without the UI or Tauri runtime.
- The web product and desktop product share frontend behavior while using host-specific persistence adapters.
- `elef-core` has no Tauri dependency; the architecture check enforces this boundary.

## Revisit when

A desktop feature cannot be implemented safely or maintainably through the file-backed command boundary.
