# ADR-007: One shared JavaScript renderer

- Status: Accepted
- Date: 2026-10-01 (accepted 2026-10-10: the single-renderer migration is complete in-tree — one bundle, no Ruby implementation left, both consumers on it; see Decision)
- Decider: Andres
- Confidence: medium

## Context

Maintaining separate Ruby and JavaScript Markdown renderers would make each rendering fix a permanent two-implementation task.

## Options considered

- Keep and synchronize separate Ruby and JavaScript renderers.
- Write a renderer in Rust for desktop.
- Use one JavaScript renderer in both Rails and desktop.

## Decision

Use one JavaScript renderer bundle. Rails runs it through MiniRacer; desktop runs it in a web worker. Mermaid rendering remains in the browser/webview because it needs a DOM. The renderer lives in `packages/renderer`: entry `packages/renderer/src/renderer_global.ts`, build `packages/renderer/build.mjs`, canonical output `packages/renderer/dist/elef-renderer.bundle.js`. Rails loads that bundle through MiniRacer (`Source::JavascriptRenderer::BUNDLE_PATH`); the desktop worker and the importmap `elef-renderer` pin consume the same build.

## Consequences

- Renderer behavior is tested from one fixture set (renderer fixtures + corpus) and both hosts consume the package-built bundle.
- No Ruby renderer implementation remains: `Source::Renderer` is a thin delegate to `Source::JavascriptRenderer`, and the boundary checker (R8) rejects any Ruby/Rust reinterpretation of Work syntax.
- Renderer changes update the shared tests and both consumers; see [development and testing](../../development.md).

## Revisit when

MiniRacer or the shared bundle cannot meet the supported Rails runtime requirements, or a measured renderer regression cannot be resolved within the shared implementation.
