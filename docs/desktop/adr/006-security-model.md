# ADR-006: Defense-in-depth security model that assumes breach

- Status: **Accepted**
- Date: 2026-09-30 (accepted 2026-10-02; detail moved to [security.md](../security.md))
- Decider: Andres
- Confidence: medium (the enumerated hostile corpus passed on macOS and Linux; this does not prove arbitrary hostile content cannot reach IPC)

## Context

The web app's threat model doesn't transfer. On desktop the webview has IPC to a backend that writes files, and a `.elef` file or deck folder is untrusted input: someone else's deck, a downloaded sample, a synced folder. A hostile deck must not be able to call `invoke()` and read or write arbitrary files. The web renderer's `filter_html: true` plus URL allowlist is a start, not a model.

## Options considered

- **Sanitizer only.** Rejected: one bug in a Markdown-to-HTML pipeline becomes file access.
- **Sandboxed iframe as the IPC boundary.** Rejected as a *sole* defense: Tauri advisories describe iframes reaching IPC, and on Linux iframes cannot be told apart from windows ([security.md](../security.md) §5).
- **Layered controls where each layer assumes the previous one failed** (chosen).

## Decision

Adopt the layered model in [security.md](../security.md):
1. Renderer sanitization with the `SAFE_URL` allowlist (the Ruby semantics, replicated).
2. Strict CSP, a release-gate test; `script-src` never relaxed.
3. Mermaid in strict mode.
4. Tauri capabilities, least privilege: a named command set, scoped to the library root, no generic write or shell.
5. Backend path discipline: canonicalize, contain, don't follow symlinks.
6. Import hardening: zip-slip, symlink entries, size/entry/ratio caps.
7. Write safety: fingerprint check before save ([ADR-008](008-safe-writes-and-conflict-detection.md)).
8. **Commands safe when hostile:** every command validates its arguments and acts only inside the library root, so a script that does reach IPC has bounded reach.
9. Render time and memory limits, signed updates, supply-chain hygiene.

No new Tauri command ships without a capability review (what it can touch, why the webview needs it).

## Consequences

- The command allowlist and the CSP are testable contracts; threats T1–T9 each map to fixtures or CI checks ([test-strategy.md](../test-strategy.md)).
- Hostile fixtures (script payloads, traversal paths, zip-slip archives, zip-bombs) must be neutralized in CI.
- Remote images are blocked in v1 because a static CSP cannot express a per-deck opt-in (Q5). This supersedes the earlier "opt-in per deck" wording, which could not be implemented as written.
- Residual risk is documented, not hidden ([security.md](../security.md) §6).

## Revisit when

S5 finds hostile content reaching IPC on a supported OS, the pinned Tauri version changes major/minor, or distribution widens beyond the owner's devices.

## Dated amendment — 2026-10-02

Accepted after the shared hostile-deck workflow passed against the real Tauri WebView on Linux and macOS in [CI run 37061835922](https://github.com/Hansespinosa2/elef/actions/runs/37061835922). The tested corpus and its limits are recorded in [S5 results](../spike-results/S5-hostile-deck-probe.md). This acceptance applies to the layered security decision and the planned probe corpus; it is not a claim that arbitrary hostile decks are harmless. Sanitizer timing characterization and broader adversarial coverage remain follow-up work.
