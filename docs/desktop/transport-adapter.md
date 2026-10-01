# Transport Adapter — Seam Spec (IPC)

Status: draft skeleton v3 (2026-10-01). The highest-leverage seam in the desktop app. The current Rails inventory and partial MiniRacer feasibility evidence are recorded in [spike-results/S1-rails-inventory.md](spike-results/S1-rails-inventory.md). S1 is still open: the shared renderer bundle, 10-fixture wrapper probe, Shiki engine probe, and macOS install evidence remain to be completed. Sections marked **S1** are known gaps S1 must close.

## 1. What the codebase does today (verified 2026-09-30 at `2b668f0`)

- The editor's `fetch()`-based controllers (autosave, preview, media/upload, pptx-export, command-palette, bug-report) request `Accept: application/json` and parse JSON. The adapter does **not** reproduce Turbo Stream responses: same JSON shape in, same JSON shape out, whichever backend answered.
- The preview endpoint returns JSON containing rendered HTML (`{ html, warnings, editor_map, ... }`). The HTML comes from the shared renderer bundle (ADR-007); Rails loads the same bundle via mini_racer, so the same input yields the same HTML on both sides.
- The editor boots inside a server-rendered ERB host page (`app/views/works/_form.html.erb`): `data-controller` attributes, `data-editor-initial-source-value`, `data-authoring-registry` JSON, document-link titles. Desktop reproduces this as a **static host-page template** (no ERB at runtime) — **S1**.
- JS is bundled via importmap (CodeMirror 6.x, katex pinned by the gem). Desktop bundles the same pinned set with esbuild/vite. After cutover the npm KaTeX inside the renderer bundle is the only KaTeX in the rendering path.
- Turbo Drive handles web navigation. Desktop uses shell view-switching (library ⇄ editor); Turbo does not ship. **S1** confirms no controller depends on Turbo events.

## 2. Rules

1. **Controllers are untouched.** Only the transport changes (fetch → invoke or local handler).
2. **Two handler kinds.** *Rust-backed* handlers call a Tauri command. *Webview-local* handlers never leave the webview: `render_preview` runs the renderer bundle in a worker, with no IPC round-trip. (v3 clarification — earlier drafts listed `render_preview` as a command. If the intent was a Rust-hosted JS engine, record it in S1: it changes the performance and security model.)
3. **Typed errors.** Every Rust-backed failure returns `{ code, message, retryable, details? }`. Codes: `conflict`, `not_found`, `invalid_library`, `invalid_input`, `path_rejected`, `too_large`, `io_error`, `unsupported`, `internal`. **S1** documents how each Rails status/error shape maps to a code so controllers see the shape they expect.
4. **Conflict handshake lives in the adapter, not the controllers.** The adapter remembers the content hash it last received for each open deck (from load or from the last successful save) and sends it as `base_hash` with every save. On `conflict`, the desktop save flow retains the dirty buffer and opens the host page's conflict UI; the error includes `details.disk_hash` and `details.current.{source,source_file}`. **S1** must confirm the web autosave controller keeps its dirty state and does not retry destructively when a save returns an error.
5. **Contract tests on both sides.** Same input → same output shape against the Rails endpoint and the desktop handler ([test-strategy.md](test-strategy.md)).
6. **Images use the asset protocol**, never base64 over `invoke()`.
7. **Capability review per command.** Each command lists what it can touch and why the webview needs it. There is no generic "write this path" command ([security.md](security.md)). The capability file must equal this table (CI fitness check).
8. The adapter is the only desktop code that knows about "endpoints". The backend never sees HTTP.

## 3. Editor endpoints → handlers (first pass; S1 completes and verifies)

| Web (Rails) | Desktop handler | Kind | Payload | Touches | v1 |
|---|---|---|---|---|---|
| `PATCH /presentations/:id`, `/documents/:id` (autosave, FormData) | `save_source` | Rust | `{ id, source, base_hash } → { ok, saved_at, content_hash }` (adapter adds `base_hash`) | That deck's source file only | yes |
| `POST …/preview` | `render_preview` | local (worker) | `{ id, source } → { html, warnings, editor_map, style, revision }` | Nothing (pure function) | planned M3; not shipped |
| `POST …/assets` | `upload_asset` | Rust | file → `{ digest, url }` (asset-protocol URL) | That deck's `images/` only; size cap to be set | planned M2; not shipped |
| `GET …/assets/*digest` | asset protocol handler | protocol | binary | Read-only, canonicalized under the library root | planned M2; not shipped |
| `resources :snippets, :math_shortcuts` | `*_snippet`, `*_math_shortcut` CRUD | Rust | same JSON shapes as Rails | `.elef/snippets.json`, `.elef/math-shortcuts.json` | planned; not shipped |
| `POST /bug_reports` | `submit_bug_report` | Rust | deferred — needs a network-policy decision (Q6) | — | stretch |
| `…/history`, `…/restore`, `…/publish`, `…/fork`, server `…/export` | — | — | behind flags or replaced (export → `.elef`) | — | no |
| `…/present`, `…/print`, `…/pptx` | `present` view / OS source print / — | — | presentation mode is an M3 stretch; PPTX out of v1; OS print currently prints Markdown source | — | stretch / partial / no |

The shipped subset is library scan/open/create/rename/delete, source save, portable settings, and `.elef` import/export. The remaining rows are planned and are not desktop implementations. Full payload schemas and Rails parity for those rows remain S1/M2/M3 work.

## 4. Library-shell commands (new; no Rails equivalent, so no parity test)

The editor table above omits the new library shell. These need the same capability review.

| Command | Purpose | Touches |
|---|---|---|
| `list_decks` | Scan library root → `[{ id, name, path, modified }]` | Read-only, library root |
| `open_deck` | Resolve source file, read source, create `elef.json` if absent → `{ source, content_hash, manifest }` | One deck |
| `read_source_snapshot` | Read and hash the currently open source without creating or changing files | One deck, read-only |
| `create_deck`, `rename_deck` | Folder create / rename | Library root, one level |
| `delete_deck` | Move to OS trash (never unlink) — Q2 | One deck |
| `import_elef`, `export_elef` | Archive import (hardened) / export | Staging dir, library root; user-chosen destination via native dialog |
| `read_config`, `write_config` | `.elef/*.json` and app-data state | Those files only |

## 5. Open items (all S1)

Complete payload schemas; error mapping; host-page template contents; bundling plan; confirmation that preview HTML reaches the DOM through a single audited insertion point (see [security.md](security.md)); the asset URL scheme; where snippets and math shortcuts are keyed.
