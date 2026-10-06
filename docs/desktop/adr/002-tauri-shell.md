# ADR-002: Tauri desktop shell

- Status: Proposed
- Date: 2026-09-30 (revised 2026-10-01)
- Decider: Andres
- Confidence: medium
- Accepted when: S2, S3, and S4 evidence is complete, including the owner-device first-install experience

## Context

Elef needs an offline desktop application for macOS and Linux, with native filesystem access and signed updates. A paid Apple Developer ID is not available for v1.

## Options considered

- **Tauri:** Rust commands, system webviews, small packages, and signed updates without a Developer ID.
- **Electron:** mature tooling and consistent Chromium, but larger packages and a signing-dependent macOS updater path.

## Decision

Use Tauri. Its updater and native file boundary fit the platform and offline requirements.

## Consequences

- macOS uses WKWebView and Linux uses WebKitGTK; parity must be exercised against both native builds.
- The shared frontend and file formats remain shell-independent where possible. See [architecture](../../architecture.md) and [development and testing](../../development.md).
- Unsigned macOS first-install and owner-device acceptance remain release checks; see [install and use](../install-and-use.md).

## Revisit when

A concrete editing or performance gap cannot be solved in the shared frontend, or signing becomes available and changes the updater trade-off.
