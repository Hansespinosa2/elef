# Elef Desktop

The desktop app lives in this workspace. `crates/elef-core` owns file and folder operations without a Tauri dependency; `src-tauri` exposes the named command boundary; `frontend` contains the static library shell.

## Local development

```sh
cd desktop/frontend
npm ci
npm test
npm run build
npm run tauri:dev
```

`tauri:dev` loads the built static frontend and does not start a development server. Re-run `npm run build` after frontend edits. The shell supports folder discovery, create/open/rename, move-to-Trash, the Rails CodeMirror source and visual editors, worker-rendered preview and slide editing, local media, portable `.elef` import/export, portable authoring settings, and updater integration. The renderer's slide/document structure is not yet at full web parity, and the signed release cycle still needs its key ceremony and device verification; see [the desktop acceptance plan](../docs/desktop/delivery-plan.md).

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

The shared authoring scenario runs as Playwright Test against Rails and the real desktop binary in CI. The desktop test build opts into the embedded localhost WebDriver plugin with a separate Tauri capability; normal builds exclude both. Linux CI uses a headless display, while the Apple Silicon macOS leg also launches the binary.
