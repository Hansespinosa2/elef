# ADR-006: Layered desktop security that assumes breach

Reach for when: adding a Tauri command, changing CSP/capabilities, or assessing hostile-work risk.

- Status: Accepted
- Date: 2026-09-30 (accepted 2026-10-02)
- Decider: Andres

## Context

The web threat model doesn't transfer: on desktop the webview has IPC to a backend that writes files, and any `.elef` file or work folder is untrusted input. A hostile work must not reach `invoke()` and arbitrary file access. Renderer sanitization alone is not a model.

## Options considered

- Sanitizer only: rejected, one pipeline bug becomes file access.
- Sandboxed iframe as the sole IPC boundary: rejected, Tauri advisories describe iframes reaching IPC, and on Linux iframes can't be told apart from windows.
- Layered controls where each layer assumes the previous one failed (chosen).

## Decision

Adopt the layered model in [data-format.md](../data-format.md#trust-boundary): sanitization, strict CSP (`script-src` never relaxed), strict Mermaid, least-privilege capabilities, backend path discipline, import hardening, fingerprinted writes, hostility-safe commands, and signed updates with supply-chain hygiene. No new Tauri command ships without a capability review. Accepted after the shared hostile-work corpus passed on Linux and macOS ([CI run 37061835922](https://github.com/Hansespinosa2/elef/actions/runs/37061835922)); that acceptance covers the tested corpus, not arbitrary hostile works.

## Consequences

- The command allowlist and CSP are testable contracts; hostile fixtures must be neutralized in CI.
- Remote images are blocked in v1: a static CSP cannot express a per-work opt-in.
- Residual risk is documented in the trust contract, not hidden.

## Revisit when

Hostile content reaches IPC on a supported OS, the pinned Tauri version changes major/minor, or distribution widens beyond the owner's devices.
