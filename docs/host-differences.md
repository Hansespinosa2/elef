# Host differences inventory

Reach for when: adding a behavior that differs between the web and desktop hosts.

One Elef product, two hosts. Every entry below is a concrete platform or
capability difference with a verifiable reason. Bare host-name preference
("it differs because the hosts differ") is rejected from this file (P10-03).

Capability keys come from the `HostCapabilities` interface
(`packages/contracts/src/errors.ts`). Adapter declarations (the
`capabilities` object each factory returns):

| key | fake (`createFakeHost`, `tests/host-conformance/adapters/fake-host.js`) | rails (`createRailsHost`, `apps/web/app/javascript/host/rails-http-host.js`) | tauri (`createTauriHost`, `apps/desktop/frontend/src/tauri-host.js`) |
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
  (`docs/desktop/adr/002-tauri-shell.md`); the web app is
  deployed server-side, so no client updater exists or is needed.
- Supported side: desktop settings show the updater affordance and the native
  updater verification flow runs
  (`apps/desktop/e2e/specs/desktop.spec.js`, test "shows the updater
  affordance on the updater-capable desktop settings" and
  `describe("native updater verification")`).
- Disabled side: the web app shows no updater affordance
  (`apps/desktop/e2e/specs/web.spec.js`, test "the web app without an
  updater capability shows no updater affordance").

## HD-02 nativeMenus (tauri-only)

- Capability: `nativeMenus`.
- Concrete reason: the desktop renders OS menus through Tauri
  (`apps/desktop/src-tauri/src/menus.rs`); browsers expose no OS menu API, so the web
  app renders menus in-DOM.
- Supported side: desktop menu integration in the Tauri shell
  (`apps/desktop/src-tauri/src/menus.rs`).
- Disabled side: the web app renders menus in-DOM with no native menu surface
  (`apps/desktop/e2e/specs/web.spec.js`, "the web app without a nativeMenus
  capability renders menus in-DOM": opens the New menu, asserts 2 in-DOM
  menuitems).

## HD-03 localFilesystem (tauri-only)

- Capability: `localFilesystem`.
- Concrete reason: the desktop persists to user-selected work folders through
  the Tauri-independent local persistence engine and must work fully offline
  with no database server (constitution §2.4); the web app persists to
  PostgreSQL + Active Storage.
- Supported side: quiet-save suite (13 tests,
  `apps/desktop/e2e/specs/quiet-save.spec.js`) + local-store unit matrix
  (`cargo test -p local-store`, 73 tests).
- Disabled side: the web app has no work-folder access
  (`apps/desktop/e2e/specs/web.spec.js`, "the web app without a localFilesystem
  capability offers no library folder picker": asserts `#change-library`
  count 0 on the library page; the button exists only in the desktop host
  template `apps/web/app/views/desktop_host.html`).

## HD-04 deleteProgrammatic policy (dialog-mediated on desktop)

- Policy (not a capability): `deleteProgrammatic` is `true` for fake
  (`fakePolicy` in `tests/host-conformance/adapters/fake-host.js`) and rails
  (`railsPolicy` in `apps/web/app/javascript/host/rails-http-host.js`),
  `false` for tauri (`tauriPolicy` in
  `apps/desktop/frontend/src/tauri-host.js`).
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
- Desktop side: work targets resolve through the existing openWork/file-open
  seam (desktop file-open/graph e2e flows).

## HD-06 export surface (delivery differs, engine shared)

- Capability: none (product surface, not a port capability).
- Concrete reason: the web app delivers export bytes over HTTP download routes
  (the `get :export` member routes on presentations and documents in
  `apps/web/config/routes.rb`,
  `apps/web/app/javascript/controllers/pptx_export_host_controller.js`),
  while the desktop has no HTTP server to download from, so it saves the same
  bytes through a native save dialog (`save_pptx_bytes` in
  `apps/desktop/src-tauri/src/exports.rs`, driven by
  `apps/desktop/frontend/src/export-transport.js`). Both hosts run the shared
  client engine (`packages/client/src/features/export/pptx.ts`) over the same
  model shape: Rails serves it as JSON (`Presentations::PptxExport`), the
  desktop builds it from local source (`buildPptxModel` in
  `packages/client/src/features/export/pptx_model.ts`). The generator library
  ships offline on both hosts (web `public/vendor`, desktop `assets/`).
- Supported side (web): Rails pptx/pdf export service + system tests
  (`apps/web/test/services/presentations/pptx_export_test.rb`,
  `apps/web/test/system/pptx_export_test.rb`, `apps/web/test/system/media_pdf_export_test.rb`).
- Supported side (desktop): shared engine + model unit tests
  (`packages/client/test/export.test.ts`), desktop transport test
  (`apps/desktop/frontend/tests/export-transport.test.js`), the
  `ELEF_E2E_PPTX_EXPORT_PATH` save-dialog harness bypass (mirroring
  `ELEF_E2E_EXPORT_PATH`), and the Rust remote-image policy tests
  (`cargo test -p elef-desktop remote_images`).
- Supported side (shared definition): both hosts declare `export: true` and
  run the download → proof flow (`apps/desktop/e2e/specs/web.spec.js`,
  "shared export flow downloads PPTX in the web app";
  `apps/desktop/e2e/specs/desktop.spec.js`, "exports PPTX through the
  desktop Export menu option into the harness path", which opens the
  work-view Export menu, clicks the Download PPTX option, and asserts the
  harness file is a valid zip containing a slide plus the embedded deck
  image).
- Desktop trigger: one work-view Export menu whose options vary by kind —
  documents offer Print / Save PDF only, presentations add Download PPTX
  (the export registry scopes PPTX to presentations; `syncSourceLabel`
  hides the option for documents). The PPTX option plus the File →
  Export PowerPoint… menu item call the desktop export seam
  (`exportPptx` on the file-library transport); the PDF option (both
  kinds) reuses the File → Print… seam (`printCurrentWork`). The menu
  closes on activation, outside pointerdown, and Escape.
- Media resolution differs by necessity, bytes match by policy: the webview
  cannot fetch media (desktop CSP restricts `connect-src` to IPC), so the
  desktop `prepareMedia` seam resolves local `elefasset://` bytes through
  the `read_pptx_asset` command and remote images through the
  `fetch_remote_image` command, which ports the server's strict remote
  policy (HTTPS/443, public-DNS pinning, redirect cap, timeouts, image
  allowlist, 10 MB per image; the 30 MB per-export total accumulates in
  the seam). Export measurement stages media as same-origin `blob:`
  object URLs and the engine rasterizes SVG backgrounds and math as
  `data:` images, so `img-src`/`media-src` permit `blob:` and `img-src`
  permits `data:` (page-created objects and inert image data only;
  scripts stay `'self'`). Parity proof: the export-parity fixtures
  (packages/client/test/fixtures/export-parity/) pin byte-identical
  canonical models on both hosts (Ruby service test plus client test over
  the same sources); model HTML renders through the chrome-composed
  projection on both (server bundle, `@elef/renderer/projection`). Final
  .pptx bytes still differ per run by library design (JSZip entry dates
  plus docProps timestamps; the engine sets neither), so content equality
  — not file bytes — is the proven property past the model.

## HD-07 search implementation (contract-identical, locality differs)

- Capability: none (one `SearchPort` contract, two implementations).
- Concrete reason: the desktop must search offline with no server to query, so
  the Tauri adapter filters substring-side over `document_graph` plus work folder
  names (`searchPort.search` in `createTauriHost`,
  `apps/desktop/frontend/src/tauri-host.js`); the web adapter queries
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
