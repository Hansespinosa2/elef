# Elef Desktop

The native app lives in this workspace. `crates/elef-core` owns file and folder operations without a Tauri dependency; `src-tauri` exposes the named command boundary; `frontend/src` contains the Tauri bootstrap, native transports, and lifecycle adapters. Rails `app/` owns the product workflow, host markup, and styles consumed by the desktop.

## Local development

For first install and everyday use, see [Install and use Elef Desktop](../docs/desktop/install-and-use.md).

```sh
cd desktop/frontend
npm ci
npm test
npm run build
npm run tauri:dev
```

`tauri:dev` loads the built static frontend and does not start a development server. Re-run `npm run build` after frontend edits. The shell supports folder discovery, create/open/rename, move-to-Trash, the Rails CodeMirror source and visual editors, worker-rendered preview and slide editing, local media, portable `.elef` import/export, portable authoring settings, and updater integration. Rails and desktop use the same JS editable-projection renderer with platform-specific links and media URLs. Full consumer-fixture parity, the signed release key ceremony, and owner-device verification remain open. See [the desktop acceptance plan](../docs/desktop/delivery-plan.md).

## Checks

```sh
cd desktop
cargo fmt --all -- --check
cargo clippy --workspace --all-targets -- -D warnings
cargo test --workspace
cargo audit --file Cargo.lock --deny warnings --ignore RUSTSEC-2025-0057 --ignore RUSTSEC-2024-0370 --ignore RUSTSEC-2024-0429 --ignore RUSTSEC-2026-0097
python3 scripts/check_architecture.py
cd frontend
npm audit --audit-level=high
```

The command list in `src-tauri/build.rs`, the runtime handler, and `capabilities/main.json` must remain identical. The capability grants only event listening, safe window close, and named app commands; no webview filesystem, shell, or dialog plugin command is exposed.

The shared authoring scenario runs through Playwright against Rails and WebdriverIO against the real desktop binary in CI. The desktop test build opts into the embedded WebDriver provider and its test-only command plugin through a separate Tauri capability and isolated frontend build; normal builds exclude them. Linux CI uses a headless display, while the Apple Silicon macOS leg also runs the web and desktop scenarios.

Native release performance is measured by `e2e/benchmark-native.mjs --binary /absolute/path/to/release/elef-desktop`, against a release binary built with `ELEF_E2E_BUILD=1`, the `webdriver` feature and both `tauri.e2e.conf.json` and `tauri.performance.conf.json`. The performance overlay uses HTTPS loopback: release builds reject the debug updater fixture's HTTP endpoint. With no local TLS server, update checking degrades offline through the normal error path. Linux requires an isolated headless X display and D-Bus session. The harness creates only a disposable 1,000-deck library, launches 20 fresh processes, measures startup and painted open/list operations, verifies input bytes during saves, and requests a normal native window close to verify the close guard. A separate native smoke sends the platform Quit shortcut. CI passes `--report-runner`, which retains every measurement and fails on functional or save-safety errors while reporting (not enforcing) performance budgets against its hosted hardware. Run without that flag on the MacBook Air and Omarchy to enforce the unchanged target budgets. JSON samples are saved under `desktop/target/` and uploaded by CI. Normal release packages exclude these measurement hooks.
