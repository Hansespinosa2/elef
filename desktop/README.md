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

`tauri:dev` loads the built static frontend and does not start a development server. Re-run `npm run build` after frontend edits. The first launch asks for an existing library folder. The current shell supports folder discovery, create/open/rename, move-to-Trash, and the Rails CodeMirror editor with debounced, conflict-aware source saves. Its visual mode currently provides the editor's inline Markdown projection; full slide preview/editing, media transport, archive transfer, and updater remain later milestones.

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
