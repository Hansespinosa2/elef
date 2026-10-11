# Elef

Elef is a Markdown authoring and presentation application with a Rails web app and a Tauri desktop app for macOS and Linux.

## Data and products

- In the web app, Rails and PostgreSQL own persistence.
- In the desktop app, each work lives in an ordinary folder on disk and can be edited offline. The desktop app has no database server.
- Shared editor, library, graph, and export UI lives in `packages/client` (React) and `packages/editor-runtime` (Stimulus editor shell); shared Work semantics in `packages/work-model`; shared projection in `packages/renderer`. Both hosts mount those packages; Rails owns web hosting and persistence, desktop adds native adapters.

## Start here

- [Product principles](ELEF-DOCTRINE.md)
- [Architecture and code map](docs/architecture.md)
- [Development and testing](docs/development.md)
- [Install and use Elef Desktop](docs/desktop/install-and-use.md)
- [Presentation media and printing](docs/presentation-media-and-printing.md)
- [Mac mini deployment runbook](docs/mac-mini-deployment.md)

The development guide covers the current Omarchy server, clean local setup, the `bin/check` tiers, Rails system tests, and the shared web/desktop parity harness.
