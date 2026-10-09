# Host differences inventory

One Elef product, two hosts. Every entry below is a concrete platform or
capability difference with a verifiable reason. Anything justified only by
"desktop/web can be different" is rejected from this file (P10-03).

Capability keys come from `HostCapabilities`
(`packages/contracts/src/errors.ts:21-28`). Adapter declarations:

| key | fake (`tests/host-conformance/adapters/fake-host.js:272-279`) | rails (`app/javascript/host/rails-http-host.js:365-372`) | tauri (`desktop/frontend/src/tauri-host.js:377-384`) |
|---|---|---|---|
| accounts | false | false | false |
| collaboration | false | false | false |
| entitlements | false | false | false |
| updater | false | false | **true** |
| nativeMenus | false | false | **true** |
| localFilesystem | false | false | **true** |

## HD-01 updater (tauri-only)

- Capability: `updater`.
- Concrete reason: the desktop ships a signed self-update channel through the
  Tauri updater plugin against GitHub Releases
  (`docs/desktop/adr/009-distribution-and-update-channel.md`); the web app is
  deployed server-side, so no client updater exists or is needed.
- Supported side: desktop settings show the updater affordance and the native
  updater verification flow runs
  (`desktop/e2e/specs/desktop.spec.js:1945`, `:2324-2357`).
- Disabled side: the web app shows no updater affordance
  (`desktop/e2e/specs/web.spec.js:957-962`).

## HD-02 nativeMenus (tauri-only)

- Capability: `nativeMenus`.
- Concrete reason: the desktop renders OS menus through Tauri
  (`desktop/src-tauri/src/lib.rs`); browsers expose no OS menu API, so the web
  app renders menus in-DOM.
- Supported side: desktop menu integration in the Tauri shell
  (`desktop/src-tauri/src/lib.rs`).
- Disabled side: the web app renders menus in-DOM with no native menu surface
  (explicit assertion added in Phase 10 DO-3).

## HD-03 localFilesystem (tauri-only)

- Capability: `localFilesystem`.
- Concrete reason: the desktop persists to user-selected deck folders through
  the Tauri-independent local persistence engine and must work fully offline
  with no database server (constitution §2.4); the web app persists to
  PostgreSQL + Active Storage.
- Supported side: quiet-save suite (13 tests,
  `desktop/e2e/specs/quiet-save.spec.js`) + local-store unit matrix
  (`cargo test -p local-store`, 73 tests).
- Disabled side: the web app has no deck-folder access (explicit assertion
  added in Phase 10 DO-3).

## HD-04 deleteProgrammatic policy (dialog-mediated on desktop)

- Policy (not a capability): `deleteProgrammatic` is `true` for fake
  (`tests/host-conformance/adapters/fake-host.js:21-23`) and rails
  (`app/javascript/host/rails-http-host.js:6-8`), `false` for tauri
  (`desktop/frontend/src/tauri-host.js:8-10`).
- Concrete reason: desktop production delete is mediated by a native
  confirmation dialog; automation runs through the harness path instead.
- Proof: the conformance suite (`tests/host-conformance/suite.js`) skips
  programmatic-delete cases only for adapters that declare it up front, and
  asserts the declaration itself.

## HD-05 routing and read/publish surfaces

- Capability: none (host routing shape, established Phase 09).
- Concrete reason: the web app is a URL-addressed server application; the
  desktop is a single-window local application with OS file association and
  no URL space (`tauri.conf.json` carries no custom scheme).
- Web side: per-work URLs resolve through Rails actions; authoring renders
  `works/shell`, read/publish stay server-rendered web-only pages (Phase 09
  inventory; `parseWorkRoute` matrix in `packages/client` + navigation
  suites).
- Desktop side: work targets resolve through the existing openDeck/file-open
  seam (desktop file-open/graph e2e flows).

## HD-06 export surface (web-only)

- Capability: none (product surface, not a port capability).
- Concrete reason: the web app delivers export bytes over HTTP download routes
  (`config/routes.rb:45,65`, `app/javascript/controllers/pptx_export_host_controller.js`)
  over shared client logic (`packages/client/src/features/export/`); the
  desktop has no export UI and no download transport.
- Supported side: Rails pptx/pdf export service + system tests
  (`test/services/presentations/pptx_export_test.rb`,
  `test/system/pptx_export_test.rb`, `test/system/media_pdf_export_test.rb`).
- Disabled side: shared `test/e2e/scenarios/export.js` asserts the explicit
  desktop-disabled path (added Phase 10 DO-2).

## HD-07 search implementation (contract-identical, locality differs)

- Capability: none (one `SearchPort` contract, two implementations).
- Concrete reason: the desktop must search offline with no server to query, so
  the Tauri adapter filters substring-side over `document_graph` plus deck
  names (`desktop/frontend/src/tauri-host.js:1-6`); the web adapter queries
  the server. Behavior is contract-identical; only the execution locality
  differs.
- Proof: contract conformance suite green on rails + desktop adapters.

## Explicitly not entries

- `accounts`, `collaboration`, `entitlements` are `false` on every adapter:
  unimplemented capabilities, not host differences. Constitution §2.4 reserves
  accounts/subscription/cloud-sync/realtime-collaboration to the web when
  built; no adapter claims them today.
- Visual/editor chrome parity (toolbar placement, dialogs vs sheets) is
  covered by the shared scenarios themselves, not by difference entries.
