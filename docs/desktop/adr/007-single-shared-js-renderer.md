# ADR-007: One shared JavaScript renderer

Reach for when: touching Markdown rendering, the Rails renderer bridge, or the renderer bundle.

- Status: Accepted
- Date: 2026-10-01 (migration complete in-tree 2026-10-10)
- Decider: Andres

## Context

Separate Ruby and JavaScript renderers would make every rendering fix a permanent two-implementation task.

## Options considered

- Keep and synchronize separate Ruby and JavaScript renderers.
- Write a renderer in Rust for desktop.
- One JavaScript renderer in both Rails and desktop (chosen).

## Decision

One JavaScript renderer bundle (`packages/renderer`, output `dist/elef-renderer.bundle.js`). Rails runs it through MiniRacer; desktop runs it in a web worker. Mermaid stays in the browser/webview because it needs a DOM. No Ruby renderer implementation remains: `Source::Renderer` delegates to `Source::JavascriptRenderer`, and the boundary checker (R8) rejects any second interpretation of Work syntax.

## Consequences

- Renderer behavior is tested from one fixture set; both hosts consume the package-built bundle.
- Renderer changes update the shared tests and both consumers.

## Revisit when

MiniRacer or the shared bundle cannot meet the supported Rails runtime requirements, or a measured renderer regression cannot be resolved within the shared implementation.
