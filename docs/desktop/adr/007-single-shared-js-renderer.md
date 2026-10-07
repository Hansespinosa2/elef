# ADR-007: One shared JavaScript renderer

- Status: Proposed
- Date: 2026-10-01
- Decider: Andres
- Confidence: medium
- Accepted when: the remaining consumer and exact-fixture gates in [issue #126](https://github.com/Hansespinosa2/elef/issues/126) are closed

## Context

Maintaining separate Ruby and JavaScript Markdown renderers would make each rendering fix a permanent two-implementation task.

## Options considered

- Keep and synchronize separate Ruby and JavaScript renderers.
- Write a renderer in Rust for desktop.
- Use one JavaScript renderer in both Rails and desktop.

## Decision

Use one JavaScript renderer bundle. Rails runs it through MiniRacer; desktop runs it in a web worker. Mermaid rendering remains in the browser/webview because it needs a DOM. The shared renderer and build entry point live under `app/javascript/lib/` and `script/`.

## Consequences

- Renderer behavior is tested from one fixture set and the desktop packages the Rails-built bundle.
- The Ruby renderer remains only as a rollback path until consumer parity, exact fixtures, and the production soak are complete.
- Renderer changes update the shared tests and both consumers; see [development and testing](../../development.md).

## Revisit when

MiniRacer or the shared bundle cannot meet the supported Rails runtime requirements, or a measured renderer regression cannot be resolved within the shared implementation.
