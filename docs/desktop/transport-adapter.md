# Transport Adapter — Seam Spec (IPC)

Status: draft v3 (2026-10-01). The highest-leverage seam in the desktop app. Implementation and remaining Rails inventory evidence are recorded in [spike-results/S1-rails-inventory.md](spike-results/S1-rails-inventory.md). The shared Markdown block renderer now ships to the desktop worker and Rails MiniRacer wrapper. S1 remains open for structure/editor-map parity, full fixture and consumer coverage, macOS-arm64 MiniRacer evidence, and production thread/fork/latency results.

## 1. What the codebase does today (verified 2026-09-30 at `2b668f0`)

- The editor's `fetch()`-based controllers (autosave, preview, media/upload, pptx-export, command-palette, bug-report) request `Accept: application/json` and parse JSON. The adapter does **not** reproduce Turbo Stream responses: same JSON shape in, same JSON shape out, whichever backend answered.
- The preview endpoint returns JSON containing rendered HTML (`{ html, warnings, editor_map, ... }`). Rails and desktop use the same JS Markdown block renderer, slide/document structure and editor-map builder. Rails partials/models and the desktop worker still assemble final projection markup separately, so full rendered preview parity is not established.
- The editor boots inside a server-rendered ERB host page (`app/views/works/_form.html.erb`): `data-controller` attributes, `data-editor-initial-source-value`, `data-authoring-registry` JSON, document-link titles. Desktop reproduces the editor contract in a **static host-page template** (no ERB at runtime); the Rails library views are not reused.
- JS is bundled via importmap (CodeMirror 6.x, katex pinned by the gem). Desktop bundles the same pinned set with esbuild/vite. After cutover the npm KaTeX inside the renderer bundle is the only KaTeX in the rendering path.
- Turbo Drive handles web navigation. Desktop uses shell view-switching (library ⇄ editor); Turbo does not ship. **S1** confirms no controller depends on Turbo events.

## 2. Rules

1. Existing editor controllers are reused. Desktop routes their JSON fetches through the transport and preview adapters; desktop-specific save/conflict orchestration remains outside the Rails controllers.
2. **Two handler kinds.** *Rust-backed* handlers call a Tauri command. *Webview-local* handlers never leave the webview: `render_preview` runs the renderer bundle in a worker, with no IPC round-trip. (v3 clarification — earlier drafts listed `render_preview` as a command. If the intent was a Rust-hosted JS engine, record it in S1: it changes the performance and security model.)
3. **Typed errors.** Every Rust-backed failure returns `{ code, message, retryable, details? }`. Codes: `conflict`, `not_found`, `invalid_library`, `invalid_input`, `path_rejected`, `too_large`, `io_error`, `unsupported`, `internal`. **S1** documents how each Rails status/error shape maps to a code so controllers see the shape they expect.
4. **Conflict handshake lives in the adapter, not the controllers.** The adapter remembers the content hash it last received for each open deck (from load or from the last successful save) and sends it as `base_hash` with every save. On `conflict`, the desktop save flow retains the dirty buffer and opens the host page's conflict UI; the error includes `details.disk_hash` and `details.current.{source,source_file}`. **S1** must confirm the web autosave controller keeps its dirty state and does not retry destructively when a save returns an error.
   - Tauri command arguments use lower camel case at the `invoke()` boundary, so the adapter transmits this value as `baseHash`; `base_hash` remains the transport contract field name used by the web-facing API description.
5. **Contract tests on both sides.** Same input → same output shape against the Rails endpoint and the desktop handler ([test-strategy.md](test-strategy.md)).
6. **Images use the asset protocol**, never base64 over `invoke()`.
7. **Capability review per command.** Each command lists what it can touch and why the webview needs it. There is no generic "write this path" command ([security.md](security.md)). The capability file must equal this table (CI fitness check).
8. The adapter is the only desktop code that knows about "endpoints". The backend never sees HTTP.

## 3. Editor endpoints → handlers (first pass; S1 completes and verifies)

| Web (Rails) | Desktop handler | Kind | Payload | Touches | v1 |
|---|---|---|---|---|---|
| `PATCH /presentations/:id`, `/documents/:id` (autosave, FormData) | `save_source` | Rust | `{ id, source, base_hash } → { ok, saved_at, content_hash }` (adapter adds `base_hash`) | That deck's source file only | yes |
| `POST …/preview` | `render_preview` | local (worker) | `{ id, source } → { html, warnings, editor_map, style }` | Nothing (pure function) | shipped; structure parity partial |
| `POST …/assets` | `upload_asset` | Rust | raw file bytes + `x-elef-filename`, `x-elef-declared-media-type`, and `x-elef-fit` headers → `{ digest, content_type, source }` | That deck's `images/` only; content-addressed; 50 MB per file and 400 MB/10,000 entries per deck; file type detected from bytes and checked against the declared type | shipped |
| `GET …/assets/*digest` | `elefasset://localhost/{deck_id}/{digest}` or `/path/images/...` protocol handler | protocol | binary | Read-only under that deck's `images/`; digest rechecked for content-addressed files; relative components decoded and traversal/symlinks rejected | shipped |
| `resources :snippets, :math_shortcuts` editor registry data | `read_authoring_registries`, `write_authoring_registry` | Rust | `{ snippets, math_shortcuts, hashes }`; writes send `{ registry, entries, base_hash }` and return `{ content_hash }`; desktop settings support create/edit/delete | `.elef/snippets.json`, `.elef/math-shortcuts.json` | shipped; stale edits return `conflict` |
| `POST /bug_reports` | `submit_bug_report` | Rust | deferred — needs a network-policy decision (Q6) | — | stretch |
| `…/history`, `…/restore`, `…/publish`, `…/fork`, server `…/export` | — | — | behind flags or replaced (export → `.elef`) | — | no |
| `…/present`, `…/print`, `…/pptx` | desktop presentation view / OS print dialog / — | — | presentation mode navigates the rendered slides; print uses the rendered preview and native dialog; PPTX remains out of v1 | — | shipped / shipped / no |

Selecting or refreshing a library reloads its custom authoring registries from `.elef/`; refreshed snippet and math entries are available the next time an editor is opened.
Custom rows use the Rails resource JSON shape on disk and are enriched into the editor-facing registry schema at the frontend boundary, including canonical legacy directive aliases and argument schemas.

The implemented subset is library scan/open/create/rename/delete, source save, portable settings and authoring registries, content-addressed media upload/read, worker preview, rendered print/presentation flows, and `.elef` import/export. The desktop library shell is custom rather than the Rails library views; the shared graph flow is covered by the cross-runner scenario. Remaining web-only endpoints and final preview-markup parity are not implemented.

## 4. Library-shell commands (new; no Rails equivalent, so no parity test)

The editor table above omits the new library shell. These need the same capability review.

| Command | Purpose | Touches |
|---|---|---|
| `list_decks` | Scan library root → `[{ id, name, path, modified }]` | Read-only, library root |
| `document_graph` | Read document Markdown files and build the graph from `[[title]]` links → `{ nodes, edges }` | Read-only, document source files only; code spans and fenced/indented code do not create edges |
| `open_deck` | Resolve source file, read source, create `elef.json` if absent → `{ source, content_hash, manifest }` | One deck |
| `read_deck_preview` | Read a bounded source sample for the library card preview; does not create or repair a manifest | One deck, source read capped at 256 KiB |
| `read_source_snapshot` | Read and hash the currently open source without creating or changing files | One deck, read-only |
| `create_deck`, `rename_deck` | Folder create / rename | Library root, one level |
| `delete_deck` | Move to OS trash (never unlink) — Q2 | One deck |
| `import_elef`, `export_elef` | Hardened archive import returns `{ deck, replaced, name_collision }`; normalized name collisions get a unique suffix and a visible notice. Export writes a deterministic archive | Staging dir, library root; user-chosen destination via native dialog |
| `upload_asset` | Store selected media as an immutable content-addressed file | One deck's `images/`; never overwrites an existing digest |
| `read_config`, `write_config` | `.elef/*.json` and app-data state | Those files only |

## 5. Open items (all S1)

Remaining S1 work: build a normalized final-projection fixture gate across Rails renderer consumers and desktop presentation constructs; measure renderer limits/latency; run MiniRacer on macOS arm64 and under production Puma thread/fork configurations; and measure the second-pass sanitizer in supported webviews. The hostile-deck corpus and shipped CSP now run on both system webviews; see [S5 results](spike-results/S5-hostile-deck-probe.md). Rails and desktop now call the same structure/editor-map functions, and Rails contract tests exercise them through MiniRacer. The static host page, asset URL scheme, custom registry storage and the preview DOM sinks are implemented and documented above.
