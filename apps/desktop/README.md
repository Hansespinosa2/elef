# Elef Desktop

This directory contains the Tauri shell and file-backed runtime. Shared product UI and behavior live under apps/web/app/; the desktop build consumes them. See the [architecture map](../../docs/architecture.md) and [development guide](../../docs/development.md).

## Local use

For installation and everyday use, see [Install and use Elef Desktop](../../docs/desktop/install-and-use.md).

~~~sh
npm ci
npm test
npm run build
npm run tauri:dev
~~~

These commands run from apps/desktop/frontend. The configured Tauri dev and production hooks build the Rails-owned frontend before opening the app.

## Structure

- src-tauri builds on the shared crates/local-store core for Tauri-independent deck and archive operations.
- src-tauri: native command boundary, capabilities, menus, lifecycle, and updater integration.
- frontend/src: Tauri bootstrap and native transport adapters.
- e2e: shared Playwright web and WebdriverIO desktop scenarios.

CI runs native app scenarios on Linux and macOS. For the full checks and safe local test setup, follow the development guide.
