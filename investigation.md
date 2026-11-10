# macOS updater investigation, 2026-11-10

## Confirmed defect and scope

The v0.1.8 close flow takes the armed update before awaiting installation. A second close sees no armed handle and a clean editor and returns without preventing close. Tauri's onCloseRequested implementation destroys the window when the event is not prevented. The in-flight guard used to occur after that early return.

Sources:
- [Released v0.1.8 close flow](https://github.com/Hansespinosa2/elef/blob/5dc808cf2ecf168e6edf9bf54d77d0b57db6047d/apps/desktop/frontend/src/close-flow.js)
- [Published v0.1.9](https://github.com/Hansespinosa2/elef/releases/tag/desktop-v0.1.9)
- Tauri @tauri-apps/api 2.12.1, window.js onCloseRequested, installed from committed apps/desktop/frontend/package-lock.json: awaits handler, then calls destroy when not prevented.

Regression: before-node22.log runs the final test file against an unchanged copy of v0.1.8's close-flow module; exit 1. after-node22.log runs it against the fixed module; exit 0. These are JavaScript flow tests on Linux, not an on-device macOS reproduction.

Fix: check the in-flight operation before dirty/armed state. Once approved, finish closing with destroy rather than generating another close request. Save conflicts, failed saves and cancelled installation retain their existing decisions. The new tests cover clean and dirty-to-clean installation, plus failure recovery.

## Release artifact checks

The archived v0.1.9 manifest and the public latest manifest were identical at investigation time. A request to the exact manifest artifact URL with Accept: application/octet-stream returned the same bytes as the published archive. verify-release.mjs extracts the public key from the published v0.1.8 Mach-O and verifies v0.1.9's artifact signature and signed version comment using Node crypto. See release-verification.json. These checks establish download/signature correctness here; they do not establish write permissions, App Translocation, Gatekeeper, or network access on the owner's Mac.

## Native test coverage

The previous Stable packaged macOS test called install_update directly and bypassed the user's button and quit flow. The revised test checks for updates, clicks Install on quit, requests native window close, answers the native confirmation, holds the signed package download, requests close again and verifies the window survives, then releases the download and checks binary replacement. It intercepts only the process restart to preserve WebDriver; the existing runner starts the installed replacement in the next session and verifies version 0.2.0, library-selection preservation, readiness and backup cleanup. This is an ephemeral-key fixture, not the production v0.1.8 to v0.1.9 transition. CI results are recorded in the PR.

## Remaining incident uncertainty

The owner's macOS version, installation path, quit mechanism and second-confirmation/error behavior were requested and are not yet available. The repeated-quit defect is proven. It is not yet proven to be the sole explanation of the owner's reported single-quit incident. No release was published, no signing key was changed, and the installed v0.1.8 app was not modified.
