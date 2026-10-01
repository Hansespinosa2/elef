# ADR-002: Tauri as the desktop shell

- Status: **Proposed**
- Date: 2026-09-30 (revised 2026-10-01)
- Decider: Andres
- Confidence: medium
- Accepted when: spikes S2, S3 and S4 pass ([delivery-plan.md](../delivery-plan.md))

## Context

We need a native shell for macOS and Linux that hosts the web frontend, provides menus, dialogs and file access, and auto-updates. The accepted preference is auto-update from day one, without paying for an Apple Developer ID in v1.

## Options considered

**Tauri.** Rust core plus the system webview; ~10 MB-class binaries; Rust is a good fit for file operations. The updater plugin verifies Ed25519 signatures itself, so **auto-update works on unsigned macOS builds** (Gatekeeper warns on first install; updates themselves install).

**Electron.** Mature, huge ecosystem, first-class Playwright support, and **the same Chromium on every OS**, which would reduce rendering divergence from the web app. But binaries are ~100 MB+, and on macOS Squirrel.Mac auto-update requires an Apple Developer ID signature. Without that identity there is no auto-update on the MacBook Air, which contradicts the accepted preference.

## Decision (proposed)

Tauri. The deciding factor is the updater: working auto-update with no Apple identity.

## Consequences

Positive: small binary, fast startup, native file access, signature-verified updates.

Negative, recorded deliberately:
- **Two system webviews** (WKWebView, WebKitGTK) instead of one Chromium. Editing parity ([requirements.md](../requirements.md) QS-1) is exposed to engine differences that the Chromium-based web tests (T1) cannot catch; the real-binary tier (T2) carries that burden. WebKitGTK is notably slower for large CodeMirror documents.
- **Desktop E2E:** `tauri-driver` (WebDriver) drives the real app on Linux CI; the same Playwright specs cannot run on it. The strategy is one scenario suite, two runner dialects ([test-strategy.md](../test-strategy.md)). macOS desktop E2E remains the weak spot (embedded driver plus a manual first-device check).
- Menus, dialogs and file pickers are Tauri APIs; platform-specific seams get platform-specific tests.
- The file formats ([data-format.md](../data-format.md)) are shell-independent and the file logic lives in `elef-core`, so a later move to Electron does not rewrite the data layer.

## Revisit when

A named feel or performance gap on WebKitGTK/WKWebView cannot be solved in the shared JS (see [ADR-004](004-frontend-reuse-transport-adapter.md) trigger), or Apple Developer ID signing becomes acceptable (which removes Electron's updater objection).
