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
  work-view Export menu, clicks the PPTX option, and asserts the
  harness file is a valid zip containing a slide plus the embedded deck
  image).
- Desktop trigger: one work-view Export menu whose options vary by kind —
  documents offer PDF only, presentations add PPTX (the export registry
  scopes PPTX to presentations; the shared menu omits the option for
  documents). Both hosts mount the same client `ExportMenu`
  (`packages/client/src/features/export/ExportMenu.tsx`, options from
  `exportMenuOptionsFor` over the registry): each option delivers
  immediately on click with no Print/Save wording and no intermediate
  Export step. The web edit page mounts it through `export-menu-host`
  (PDF options stay anchors to the print routes with `from_export`, so
  the print page opens its PDF dialog immediately; PPTX runs the
  draft-form model fetch), the desktop work view mounts it through
  `file_library_application.ts` (PDF runs `printCurrentWork`, PPTX runs
  `exportPptxCurrentWork`). Neither host keeps its own menu markup or
  dismissal wiring. The PPTX option plus the File → Export PowerPoint…
  menu item call the desktop export seam (`exportPptx` on the
  file-library transport, delivered through the native save dialog titled
  "Save PowerPoint"); the PDF option (both kinds) and File → Print…
  call `printCurrentWork`, which delivers through the native `print_work`
  command (`apps/desktop/src-tauri/src/printing.rs`
  → `WebviewWindow::print()` → the platform print dialog with its PDF
  destination). Script `window.print()` is only the fallback: it is a
  silent no-op in the desktop webviews on macOS and Linux, so it never
  reached the platform pipeline there. Before printing, `printCurrentWork`
  prepares through the shared print contract (`packages/client/src/features/
  export/print.ts`): videos pause (as the web print-view controller does)
  and a kind marker (`printing-document` / `printing-presentation`) selects
  the matching web print geometry, so the PDF carries the Work preview only —
  shell, Export menu, notices, and editor affordances stay out — with fixed
  13.333 × 7.5 in presentation pages and flowing A4 document pages. The native
  dialog fires no `afterprint` event, and the platform dialog (with its PDF
  destination) outlives the resolve of the native print command, so the
  markers intentionally stay once set: clearing them when the command
  resolves renders the unmarked live editor shell into the PDF. Each
  preparation clears every marker (`ALL_PRINT_MARKERS`) first, then adds
  the current kind pair; markers are print-media-only, so keeping them is
  screen-safe. The WebDriver harness resolves the command without
  opening the dialog. The menu closes on activation, outside pointerdown
  or click, and Escape.
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
  the same sources); model HTML renders through the bare projection on
  both (server `bare: true` render, `@elef/renderer/projection`), so both
  hosts feed the shared engine identical chrome-free bytes. Final
  .pptx bytes still differ per run by library design (JSZip entry dates
  plus docProps timestamps; the engine sets neither), so content equality
  — not file bytes — is the proven property past the model.

## HD-07 search implementation (rank parity, locality differs)

- Capability: none (one `SearchPort` contract, two implementations).
- Concrete reason: the desktop must search offline with no server to query, so
  the Tauri adapter ranks adapter-side (`searchPort.search` in `createTauriHost`,
  `apps/desktop/frontend/src/tauri-host.js`); the web adapter queries
  the server (`WorkSearch`, `apps/web/app/services/work_search.rb`). Both run
  the same ranking: phrase-aware clauses, diacritic-insensitive matching,
  title 120 / alias 100 / heading 75 / content 40 weights,
  all-clauses-must-match, 180-char context excerpts, and score/updated/title/id
  ordering. The desktop reads document sources from `document_graph` and falls
  back to `read_source_snapshot` for works the graph omits (presentations), so
  headings and content match for every kind.
- Remaining gap (no alias store on desktop): the alias field is always empty in
  the desktop ranker because the desktop keeps no alias store (web aliases come
  from the `document_aliases` table, including previous titles recorded on
  rename). This is the web equivalent of a work with no aliases. Desktop users
  cannot create aliases, so there is no alias surface on which to disclose
  this; it is recorded here instead of in UI.
- Proof: desktop ranking suite
  (`apps/desktop/frontend/tests/tauri-host-search.test.js`) mirrors the server
  suite (`apps/web/test/services/work_search_test.rb`); contract conformance
  suite green on rails + desktop adapters.

## Explicitly not entries

- `accounts`, `collaboration`, `entitlements` are `false` on every adapter:
  unimplemented capabilities, not host differences. Constitution §2.4 reserves
  accounts/subscription/cloud-sync/realtime-collaboration to the web when
  built; no adapter claims them today.
- Visual/editor chrome parity (toolbar placement, dialogs vs sheets) is
  covered by the shared scenarios themselves, not by difference entries.
