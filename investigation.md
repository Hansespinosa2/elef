# Desktop updater and About investigation

Final candidate: 6c78c569148f89835cf22f6fb7a809b2104ffe7d. PR: https://github.com/Hansespinosa2/elef/pull/249

## Owner's incident and accepted behavior

The owner reports macOS 26.6.2 (25G83), installation from DMG into Applications, failure after trying the ordinary quit methods, and success when letting the original update flow finish. They explicitly want Install on Quit to remain quiet, require consent, and work across normal quit methods. They also request a visible installed version in About. This workspace is Linux; no claim is made that the exact owner-device state was reproduced.

## Confirmed race

The [released v0.1.8 close flow](https://github.com/Hansespinosa2/elef/blob/5dc808cf2ecf168e6edf9bf54d77d0b57db6047d/apps/desktop/frontend/src/close-flow.js) takes the armed update before awaiting installation. Another close sees no armed handle and a clean editor and returns without preventing close. Tauri @tauri-apps/api 2.12.1 window.js onCloseRequested awaits the handler, then calls destroy when the event is not prevented. The old in-flight guard occurred after the early return.

The evidence files original-close-flow.mjs, regression.test.mjs and before-node22.log preserve the unchanged released module plus the initial regression test (exit 1, two failures). after-node22.log records the initial guarded implementation (exit 0, 14 tests). The before/after PNGs capture those actual logs, not native Mac execution. The final tests additionally assert the requested quiet normal close and retained consent after save conflicts.

## Final implementation

- [Native preparation/activation](https://github.com/Hansespinosa2/elef/blob/6c78c569148f89835cf22f6fb7a809b2104ffe7d/apps/desktop/src-tauri/src/updates.rs): the existing capability-gated install_update command has a prepareOnly phase. Preparation asks a native Install on Quit/Later question, downloads/verifies the signed package and installs it into a private copy. Activation can only take the exact native-held prepared version, once. It cannot download or prompt. The plugin returns a download handle without inheriting the check timeout, so the handle receives an explicit 120-second timeout.
- [Runtime](https://github.com/Hansespinosa2/elef/blob/6c78c569148f89835cf22f6fb7a809b2104ffe7d/apps/desktop/frontend/src/update-runtime-macos.js): arm before preparation completes so a quit during download waits. Do not relaunch after activation.
- [Close flow](https://github.com/Hansespinosa2/elef/blob/6c78c569148f89835cf22f6fb7a809b2104ffe7d/apps/desktop/frontend/src/close-flow.js): guard all repeated requests before dirty/armed state; block input during quit/save/activation; restore it if the app stays open. A save conflict retains the approved update for the next safe quit.
- [Desktop bootstrap](https://github.com/Hansespinosa2/elef/blob/6c78c569148f89835cf22f6fb7a809b2104ffe7d/packages/editor-runtime/src/lib/file_library_application.ts): background availability only, native consent for manual checks, quiet progress and ready status, direct destruction after an approved close, and no mutating menu actions while closing.

## About root cause

The existing About implementation asked Tauri for the native app version but both production capabilities lacked core:app:allow-version. Its catch hid the version line. The E2E Stable capability includes core:default and an explicit version grant, masking the production omission. The fix grants only the read-only version permission in Stable and Dev production capabilities, retains a visible error fallback, asserts the production grant separately from E2E, and checks the actual About label against the native installed version.

## Public release checks

The [published v0.1.9](https://github.com/Hansespinosa2/elef/releases/tag/desktop-v0.1.9) manifest and the public latest manifest were identical at investigation time. The exact artifact URL with Accept: application/octet-stream returned the published archive bytes. verify-release.mjs extracts the public key from the released v0.1.8 Mach-O and verifies v0.1.9's archive signature and signed version using Node crypto. See release-verification.json. This does not prove network access, permissions, App Translocation or Gatekeeper behavior on the owner's Mac.

## Verification and limits

See the PR for exact commands, versions, exits, durations, CI candidate identity and review trace. Logs in this branch include the initial failures and successful checks. Expanded quick: PASS 19.1 s. Expanded affected: PASS 48.7 s (disposable SQLite). Feature-enabled native updater tests: 4 pass; feature-enabled clippy and fmt pass. About affected checkpoint: PASS 38.5 s. Final candidate CI is pending.

Initial guard candidate 1de2c963 passed [macos-15-arm64 native CI](https://github.com/Hansespinosa2/elef/actions/runs/42828368274/job/129871807747), checkout 687525265759d3353f338fc4b859a72b0f034b87 (head 1de2c963 merged into base 473fe17d). Its packaged install and separate replacement launch passed, with restart interception. The final candidate removes that interception and tests actual Cmd+Q/window-close handling, real process exit, and a separate replacement launch. It additionally checks no unapproved activation, native cancellation, unchanged live bytes during preparation, offline activation, and visible About version.

An earlier Rails system job failed on a missing presentation alignment selector. That focused test passes on unchanged base 473fe17d. A full base run with the same seed is being recorded separately; no claim is made that the exact alignment error was reproduced on base.

The CI runner is macOS 15, not the owner's macOS 26.6.2. Force Quit/process termination cannot complete an update. No release was published, no signing key changed, and no installed app on the owner's Mac was modified. An already-installed v0.1.8 updater needs a fixed build installed to acquire the client fix.
