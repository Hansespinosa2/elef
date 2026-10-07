# Repository Instructions

## Architecture and ownership

- Elef is a Rails application for authoring and presenting Markdown decks. Raw Markdown is canonical; in the desktop app, each deck is a folder on disk. The desktop app has no Postgres dependency or bundled database server.
- Rails `app/` owns platform-neutral product behavior and UI: shared editor/library workflows, Stimulus controllers and modules, host markup, styles, and rendering code. Reuse these sources in both products. Do not add desktop-only copies of shareable HTML, CSS, or UI/UX logic.
- `desktop/` consumes Rails-owned frontend sources and owns only the Tauri bootstrap and transport, Rust file operations, native menus/dialogs/windows, lifecycle, updater, and UI that cannot be shared. Keep the dependency one-way: Rails never imports or depends on desktop code or Tauri APIs.
- Prefer changing an existing shared implementation and deleting redundant code over adding a new abstraction or parallel implementation. Keep Rails importmap and desktop package versions/build outputs in sync.
- Preserve the product boundaries: web persistence remains Rails-owned; desktop deck files are the source of truth. Do not add a database server to desktop.
- Use [ELEF-DOCTRINE.md](ELEF-DOCTRINE.md) for product principles, [docs/architecture.md](docs/architecture.md) for the current code map, and [docs/development.md](docs/development.md) for setup and validation paths.

## Development environment

- Work natively on the user's Omarchy device in the current checkout.
- Reuse the existing web app at `https://127.0.0.1:3000/`. Do not start a competing Rails server or change its port. If the URL is unavailable, inspect and repair the existing server/proxy/database setup; do not launch `bin/dev` or `rails server` as a workaround because those commands do not necessarily provide this HTTPS endpoint. Restart only for boot-time changes.
- The desktop app loads a built static frontend and does not need the Rails development server. Start it with `npm run tauri:dev --prefix desktop/frontend`; Tauri's configured pre-dev hook builds the Rails-owned frontend. If testing changes in the running app, rebuild with `npm run build --prefix desktop/frontend` and relaunch it.
- Rails request/system tests and the desktop E2E harness use test data and a test database. Never point tests at personal, production, or user deck data. Diagnose a local database connection failure against the existing Rails setup; do not work around it by changing ports or starting a competing server.
- The full desktop E2E harness can start its own Rails test server on port 3000 and mutates disposable test fixtures. Do not run it while the user's development server occupies that port. Prefer the fastest relevant unit/build check first, then run the isolated parity harness when the environment is available.
- Do not use the retired `scripts/elef-agent` Apple Container/worktree workflow.

## Testing and parity

Choose the smallest test that exercises the change, then add the cross-product leg when shared behavior is affected. Do not weaken, skip, or disable tests to get a green result.

Useful checks:

```sh
# Rails-owned shared frontend behavior
npm run test:javascript

# Desktop adapter tests and fast E2E harness unit tests
npm test --prefix desktop/frontend
npm run test:unit --prefix desktop/e2e

# Check one-way ownership and Tauri capability/CSP contracts
python3 script/check_frontend_ownership.py
python3 desktop/scripts/check_architecture.py

# Build the desktop consumer of Rails-owned frontend assets
npm run build --prefix desktop/frontend

# Rust file core / native backend
cargo test --manifest-path desktop/Cargo.toml -p elef-core --locked
cargo fmt --manifest-path desktop/Cargo.toml --all -- --check
cargo clippy --manifest-path desktop/Cargo.toml --workspace --all-targets -- -D warnings
```

- For Rails behavior, run the focused `bin/rails test <path>` first; use `bin/rails test test/system` for complete Rails browser workflows. System/browser automation must be headless. Use the configured test database, not the live development database.
- Shared user flows are defined once under `test/e2e/scenarios/`, owned alongside the Rails test suite. Playwright and WebdriverIO adapters under `desktop/e2e/` consume them for the web app and real Tauri binary on macOS and Linux. When changing shared editor, library, renderer, or save/conflict behavior, update/reuse those scenarios and verify both runners. The combined `npm test --prefix desktop/e2e` harness is the parity gate; follow `.github/workflows/ci.yml` for its isolated database, frontend/binary builds, fixtures, and platform setup. It is not safe to run alongside the live server on port 3000.
- Renderer or shared-style changes should also rebuild the relevant artifact (`npm run renderer:build` for the renderer; `bin/rails tailwindcss:build` for Tailwind; the desktop frontend build for its consumer) and check the resulting diff. Use the ownership/architecture checks after moving code across `app/` and `desktop/`.
- Treat CI as authoritative for native macOS/Linux behavior. A unit test, Chromium run, or static build does not establish real Tauri/WebKit behavior.
- Re-run the relevant test after the final code change. Report only what the performed checks establish, including platform and test tier.

## UI verification

- Browser automation must be headless.
- Distinguish DOM assertions, exact reproduction of user state, and an inspected screenshot. Do not claim screenshot or visual verification unless an image was actually inspected.

## Git and GitHub

- For new PR work, branch from the latest `dev` and target `dev`, unless the user specifies another base. If an open PR exists for the task branch, continue on that branch and use that PR as the merge boundary.
- Use the available GitHub integration for PR details, reviews, issues, and check status. Never print, request, save, or commit credentials; do not copy credentials into `.env` files.
- Commit coherent changes with concise imperative subjects. Never add co-author trailers, rewrite history, or revert unrelated changes.
- Do not merge unless explicitly asked. If asked to merge an open PR, merge it through GitHub rather than creating a substitute local merge commit. After merge, fetch the target branch and verify the merge commit is reachable from it; do not trust stale `origin/*` refs.
- PR descriptions must use the repository template, explain validation and database/migration impact, and must not record current merge status.
