# S1 — Rails-side inventory

Status: **partial** · inspected at code commit `7055e4d` on 2026-10-01 · owner: Andres

This report records the Rails contracts discovered before desktop implementation. The spike is not complete: a JavaScript renderer bundle has not yet been built, the 10-fixture Rails wrapper probe has not run, Shiki's engine has not been checked in MiniRacer, and macOS installation has not been exercised.

## Editor endpoint inventory

The editor currently uses `fetch()` only for autosave, preview, media creation/upload, pasted image reads, command-palette search/settings, bug reports, and the deferred PPTX path. The browser requests JSON for the Rails endpoints and serializes editor form data as `FormData` except for settings and bug reports.

| Web request | Request payload | Success payload | Error responses | Desktop mapping and implementation status |
|---|---|---|---|---|
| `PATCH /presentations/:id` or `PATCH /documents/:id` (autosave) | Rails form fields (`presentation[...]` or `document[...]`): source, title where applicable, theme, typography, lock version, base revision, edit session ID; `_method=patch`; editor mode | `200` JSON: `id`, `work_id`, `title`, `source`, `lock_version`, `draft_digest`, checkpoint/revision fields, published-release fields, `status: "saved"` | `409` `{ status: "conflict", message, current: <saved payload>, recovery_revision_id, recovery_revision }`; `422` `{ errors, current }` | **Shipped, desktop-specific:** `save_source({ id, source, base_hash })` and the Rust hash handshake. `main.js` owns desktop save orchestration; the Rails autosave controller is not reused yet. |
| `POST /presentations/:id/preview` or `POST /documents/:id/preview` | Same form fields, plus `revision` and `projection=editor`; `_method` and `commit` removed before sending | `200` JSON: `html`, `editor_map`, `style: { theme, typography }`, `warnings`, `revision` | `422` JSON: `{ html: null, editor_map: null, warnings, revision }` | **Planned, M3:** `render_preview({ id, source })` runs locally in the renderer worker. No desktop renderer or editor map ships yet; visual mode stays disabled. |
| `POST /presentations/:id/assets` or `POST /documents/:id/assets` | Multipart `file`, `fit`; Rails accepts up to 50 MiB. Documents accept images; presentations accept images and MP4 | `201` JSON: `{ digest, lock_version, revision_token, source }`, where `source` is Markdown using `elef-asset:<sha256>` | `422` `{ error }` for unsupported media or size; Rails storage/validation failures can also return `422` | **Planned, M2:** `upload_asset({ id, bytes, filename, content_type, fit })`; implement using the local asset protocol, not base64 through `invoke()`. |
| `GET /presentations/:id/assets/:digest` or `GET /documents/:id/assets/:digest` | Digest path component | Raw asset bytes with the stored MIME type and `Cache-Control: private, max-age=3600` | `404` empty response | **Planned, M2:** read-only `elef-asset://<deck-id>/<digest>` protocol response, resolved only under the deck. |
| `POST /presentations` or `POST /documents` (called by the media controller when a new Rails work must be persisted before upload) | Multipart work fields: title, source, theme, typography, editor mode | `201` JSON: `{ id, edit_url, upload_url, lock_version, revision_token }` | `422` `{ errors: [...] }` | No Rails equivalent: the library shell creates a deck folder before opening its editor, so the controller's new-work persistence branch is not used. |
| `GET /search?q=…&type=…` (command-palette search) | Query string | `{ query, type, results }` | No explicit JSON error contract | Not an editor endpoint. Desktop library search is local and does not preserve Rails URLs. |
| `PATCH /settings` (command-palette workspace appearance) | JSON `{ workspace: { theme, typography } }` | `{ theme, typography }` | `422` `{ error }` | **Partial:** portable theme preference is shipped in `.elef/config.json`; typography and command-palette settings remain planned. |
| `POST /bug_reports` | JSON `{ bug_report: { expected, actual, steps } }` | `{ url }` | `422` `{ error, errors }`; `429` `{ error }`; `503` `{ error }` | **Deferred:** stretch only; omitted from the host page and CSP network policy. |
| `GET`/`POST /presentations/:id/pptx` | Draft form data for POST; version query for either method | PPTX export model JSON | `400` or `422` `{ error }`; missing resources can be empty `404` | **Deferred:** out of v1. |

The adapter maps known Rails outcomes as follows: `409 → conflict`, `404 → not_found`, validation `422 → invalid_input`, oversized media → `too_large`, rejected paths → `path_rejected`, and filesystem failures → `io_error` or `internal`. The web controllers' generic error path handles any non-2xx response without clearing the buffer. Desktop typed errors remain `{ code, message, retryable, details? }` at the Rust boundary; `invalid_library` distinguishes a missing selected library from invalid command input.

`resources :snippets, :math_shortcuts` are management screens, not editor fetches. **Planned:** the editor receives one JSON array through the source field's `data-authoring-registry` attribute. `AuthoringRegistry.for_editor` combines the default and persisted entries and enriches them with `namespace`, `aliases`, `search_terms`, `contexts`, `behavior`, `commit_behavior`, `documentation_example`, and (for directives) `argument_schema`. The desktop host must provide that same array shape from `.elef/snippets.json`, `.elef/math-shortcuts.json`, and the shared built-in entries; the current host supplies `[]`.

## Static editor host page contract

`app/views/works/_form.html.erb` is the source of the host-page contract. Desktop does not execute this template or boot Rails. Its static template needs:

- A work form with the editor's Rails-compatible field names (`presentation[source]` or `document[source]`), title for presentations, theme, typography, save status, retry button, and conflict controls.
- Root controllers: `dirty`, `preview`, `autosave`, `visual-editor`, and `media`; presentations also use `presentation-editor` and `slide-overview`.
- A `.source-field` containing `editor`, `snippet-palette`, `math-shorthand`, `math-shortcut-palette`, and `mermaid-assist`; documents also use `document-link-palette`.
- The source textarea proxy, CodeMirror surface, editor mode buttons, presentation slide overview, document-link title JSON, and the authoring-registry JSON described above.
- `data-editor-map-json` and the editable projection markup. The editor map is currently generated by `Source::Document.editor_map`; no equivalent JavaScript implementation exists in this branch yet.
- A single preview installation function. In the current web controller, the live preview sink is `preview_controller.installProjection`, which assigns `payload.html` to the preview container's `innerHTML`. Initial Rails-rendered HTML is emitted by the host template. Desktop must route initial and updated preview markup through the same audited sanitizer/insertion function.

The editor controllers do not subscribe to Turbo navigation events. The current `bug_report_events.js` recorder does listen to `turbo:load`; it is excluded with bug reports in desktop v1. Turbo Drive, Rails CSRF, and Rails URLs are therefore not part of the desktop host contract.

## Renderer consumers and build plan

The actual Ruby implementation is `Source::HtmlRenderer`, wrapped by `Source::Renderer`. Its server-side consumers are the presentation view helper, document-link renderer, document block renderer (through document links), and the presentation PPTX exporter. `WorkPreview` renders HTML through Rails partials; those partials also consume the Ruby source renderer. After the desktop renderer exists, M3w must cover every call site found in this inventory and the remaining source-wide search.

The current renderer is Redcarpet + Rouge + the KaTeX JavaScript included by the `katex` Ruby gem. The Rails gem version is `0.11.0`; its vendored KaTeX runtime reports `0.17.0`. The vendored Mermaid runtime is `11.17.2`. Importmap pins CodeMirror 6 modules directly (with their versions recorded in `config/importmap.rb`), while desktop needs a locked npm dependency graph.

Proposed build shape: a root npm workspace owns a standalone `packages/renderer` package and the desktop frontend; `npm run build:renderer` emits one deterministic `renderer.bundle.js` to a path Rails and Tauri both consume. `esbuild` bundles the same pure renderer entry into the worker and the Node fixture runner. The choice of checked-in versus CI-built bundle remains open until the first package and Rails test exist.

## Feasibility evidence

- Host: Omarchy Linux x86_64, Ruby 4.0.6, GCC toolchain, Node 26.10.0. PostgreSQL is unavailable in the local session; Rails CI passed in the repository's documented SQLite mode.
- In an isolated `/tmp` bundle, current MiniRacer `0.22.1` plus `libv8-node 24.12.0.1` installed successfully on this host.
- `MiniRacer::Context` passed a JavaScript evaluation, a 1-second timeout probe, four independent contexts on four Ruby threads, and a post-fork context with `MiniRacer::Platform.set_flags!(:single_threaded)`.
- The local host has WebKitGTK 4.1 development files and Chromium. macOS arm64 was not available. The probe did not exercise the production bundle, memory exhaustion, or Puma itself.
- S1's exit is therefore **not met yet**. The implementation must add the renderer package, test the real bundle and 10 fixtures, exercise Shiki's chosen regex engine under MiniRacer, and record macOS/CI installation evidence before ADR-007 can be accepted.
