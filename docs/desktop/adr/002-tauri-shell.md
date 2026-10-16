# ADR-002: Tauri shell with signed updates through GitHub Releases

Reach for when: touching the desktop shell, webviews, install/update flows, or release signing.

- Status: Proposed
- Date: 2026-09-30 (update-channel decision merged in 2026-10-11; decisions unchanged)
- Decider: Andres
- Accepted when: macOS and Linux install/update evidence is complete, updater key custody is performed, and the owner-device first-install experience passes

## Context

Elef needs an offline desktop app for macOS and Linux with native filesystem access and self-updates, without an update server or Apple Developer ID. Update verification is a security boundary: a signing key authorizes executable code.

## Options considered

- Tauri with GitHub Releases and Ed25519 update verification (chosen): small packages and signed updates without a Developer ID.
- Electron: mature tooling and consistent Chromium, but larger packages and a signing-dependent macOS updater path.
- A dedicated update service, or manual builds only: rejected, cost without benefit at this scale.

## Decision

Use Tauri. Publish signed update artifacts through GitHub Releases; the app verifies against its configured public key and uses the native confirmed install flow. Release packaging is defined in [the desktop release workflow](../../../.github/workflows/desktop-release.yml).

## Consequences

- macOS uses WKWebView and Linux uses WebKitGTK; parity is exercised against both native builds.
- Production release credentials and two offline encrypted private-key backups are owner-managed; test fixtures use ephemeral keys. A lost production key strands installed versions; a compromised key can authorize malicious releases.
- Unsigned macOS first-install friction remains until Developer ID signing is adopted.

## Revisit when

A concrete editing or performance gap cannot be solved in the shared frontend, distribution expands beyond the owner, key custody changes, or a platform change blocks the signed update path.
