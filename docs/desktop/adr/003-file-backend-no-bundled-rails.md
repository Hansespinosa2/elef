# ADR-003: File-backed Rust backend — no bundled Rails

- Status: **Proposed**
- Date: 2026-09-30 (revised 2026-10-01: renderer content removed; [ADR-007](007-single-shared-js-renderer.md) owns it)
- Decider: Andres
- Confidence: high
- Accepted when: spike S1 passes — the adapter is bounded and every editor endpoint is JSON ([delivery-plan.md](../delivery-plan.md))

## Context

The web app is Rails 8 + Hotwire: server-rendered ERB, Turbo, Stimulus, CodeMirror. The desktop needs the same editing experience backed by folders instead of Postgres.

## Options considered

**A. File-backed backend (chosen).** The Tauri/Rust backend does folder CRUD. The editor's existing JS is reused verbatim ([ADR-004](004-frontend-reuse-transport-adapter.md)); rendering is the shared JS bundle ([ADR-007](007-single-shared-js-renderer.md)).

**B. Bundled Rails.** Ship the whole Rails app in the desktop bundle (Puma on localhost) with a file-backed storage adapter replacing ActiveRecord. It looks like zero divergence, but:
1. **Embedding CRuby has no turnkey tooling.** The packers are ancient (RubyScript2Exe, 2007-era) or bespoke installer engineering. No `electron-builder` equivalent exists for Ruby: weeks of platform-specific packaging before anything runs.
2. **The storage adapter is a rewrite, not a swap.** Replacing ActiveRecord persistence across ~12 models (associations, transactions, ActiveStorage) is a large, risky refactor of the data layer — the divergence the preferences forbid, moved somewhere less visible.
3. **Weight and boot time** (heavy binary, Puma boot every launch) work against "usable soon".

## Decision (proposed)

A. File-backed Rust backend, with file logic in the UI-independent `elef-core` crate that the Tauri commands call. The crate split is implemented; ADR acceptance still awaits the S1 endpoint inventory and bounded-adapter evidence.

## Consequences

- A's costs are bounded and testable. The **transport adapter** is the one seam, specified and contract-tested on both sides. Verified 2026-09-30: the editor's fetch controllers already speak JSON (`Accept: application/json`), so the adapter maps JSON to JSON, not HTML ([transport-adapter.md](../transport-adapter.md)).
- The Ruby test suite keeps running for web unchanged.
- `.elef` and folder formats are shared and shell-independent; a future bundled-Rails variant, or the web app itself, could read the same folders. This decision does not burn that bridge.
- The library shell is file-backed and needs native folder/archive actions, but its core views and behavior are expected to match web. The current custom desktop views and final preview assembly leave parity work tracked in [issue #126](https://github.com/Hansespinosa2/elef/issues/126); this ADR's proposed status does not waive that preference.
- A fully shared *library* UI is not achieved in v1 (see ADR-004's honest note).

## Revisit when

S1 finds editor endpoints that return non-JSON (HTML/Turbo Stream) responses the controllers depend on, which would widen the adapter beyond a bounded seam.
