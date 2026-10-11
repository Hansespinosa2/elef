# Desktop data format

The desktop library is a user-owned directory tree. This document records the formats read and written by desktop code; changes to these contracts need matching Rust and fixture coverage.

## Work folders

A work is an immediate, non-hidden child directory of the chosen library that contains a top-level Markdown file. Nested folders are work folder contents, not separate works. Discovery does not follow symlinks.

~~~text
Elef/
  .elef/
    config.json
    snippets.json
    math-shortcuts.json
  My Work/
    presentation.md
    images/
    elef.json
~~~

When a work contains several top-level Markdown files, desktop chooses deterministically: presentation.md first, then document.md, then the shortest filename, then case-insensitive and bytewise lexical order. This keeps a sync-tool conflicted copy from shadowing the original.

## Manifest

elef.json is optional and is created on first open when the directory is writable.

~~~json
{
  "id": "550e8400-e29b-41d1-a716-446655440000",
  "schema_version": 1
}
~~~

The id is a UUID. The folder name is display-only. A missing or invalid manifest does not prevent opening; desktop uses a path-derived identity and displays a notice where applicable. A manifest with a newer schema version is read for known fields and produces a non-blocking notice. Duplicate UUIDs are resolved deterministically during discovery; opening a duplicate can repair its manifest when writable.

## Source, assets, and portable links

Markdown is the editable source. Relative media paths stay inside the work folder. Media inserted by Elef may use a content-addressed elef-asset reference; its bytes are stored below that work folder's images directory.

Document links can carry optional elef_document_key and elef_aliases values in Markdown front matter. Rails and desktop use the shared link parser and resolver. See [ADR-010](adr/010-portable-document-links.md).

Source writes use an adjacent temporary file and atomic replacement with a source fingerprint check. The accepted behavior and the remaining external-writer race are described in [ADR-008](adr/008-safe-writes-and-conflict-detection.md).

## .elef archive

An .elef file is a ZIP archive containing the work folder's files at its root. Import also accepts a single wrapping directory. Export sorts entries and fixes archive metadata for deterministic output.

Import rejects absolute paths, traversal, symlinks, and special files. Current core limits are 10,000 entries, 500 MiB uncompressed, and 600 MiB for the archive itself; extreme compression ratios are rejected. Data is extracted to a staging directory under the library, validated, then moved into place. UUID collisions prompt for replace, keep both, or cancel. Replacing moves the prior work to the operating system's Trash.

The Tauri bundle registers the .elef extension. The app's file-open path accepts these archives for import.

The normative rules below are the prose truth for the ZIP archives produced and consumed by the desktop transfer path; the summary above restates them briefly. Code truth is `crates/local-store/src/` (transfer: `archives.rs` — `export_elef`, `import_elef`, `extract_archive`, `validate_archive_path`, `single_wrapper_name`, `collect_archive_items`; discovery: `discovery.rs` — `choose_source_file`, `source_file_key`, `available_work_folder_name`, `discover_work_folders`; work folders: `work_folders.rs` — `normalized_name`, `validate_work_folder_name`; manifests: `manifest.rs`). This section restates the rules both must keep; on conflict the code wins and this file is a bug.

### Archive container (normative)

- A `.elef` file is a ZIP archive (directories + deflated files).
- Export writes entries sorted by name with fixed metadata (compression level 6, default timestamp, `0o100644`) for deterministic output (`export_elef`). Byte identity across runs is intended but not asserted here; the freshness/corpus suites pin behavior.

### Archive member layout (normative)

- The work folder's files sit at the archive root (`collect_archive_items`: paths relative to the work folder, `/`-separated).
- Import also accepts a single wrapping directory: when every file is nested under one top-level directory, that prefix is stripped and the wrapper name becomes the imported work name (`single_wrapper_name`, `import_elef`).
- After unwrapping, the staging root must contain a Markdown source file chosen by the source-file rule (top-level `*.md`, preferring `presentation.md`, then `document.md`, then shortest name, then case-insensitive and bytewise lexical order: `choose_source_file`, `source_file_key`). An archive with no top-level Markdown file is rejected (`CoreError::InvalidInput`).
- `elef.json` at the root is optional. When present it must parse as a [work manifest](../../spec/work-manifest.schema.json); a UUID already in the library prompts for replace / keep-both / cancel (`import_elef`).
- In-progress save temp files (`.elef-save-*.tmp`) are never exported.

### Archive rejection rules (normative)

An archive is rejected before anything lands in the library when any entry (`validate_archive_path`, `extract_archive`):

- has an empty, absolute, or drive-qualified path, or contains `\`, NUL, `:`, a control character, or an empty / `.` / `..` segment;
- is encrypted or a symlink, or carries a non-regular, non-directory unix mode (devices, fifos, sockets);
- duplicates another entry after Unicode normalization + case folding (`normalized_name`).

Whole-archive limits (`local-store` constants):

| Limit | Constant | Current value |
|---|---|---|
| Archive file size | `MAX_ARCHIVE_FILE_BYTES` | 600 MiB |
| Total uncompressed size | `MAX_ARCHIVE_UNCOMPRESSED_BYTES` | 500 MiB |
| Entry count | `MAX_ARCHIVE_ENTRIES` | 10,000 |
| Per-entry compression ratio (entries ≥ 1 MiB) | `MAX_ARCHIVE_COMPRESSION_RATIO` / `MAX_ARCHIVE_RATIO_CHECK_BYTES` | 1000× / 1 MiB |

Data is extracted to a staging directory inside the library (`.elef-import-*`), validated, then renamed into place; replacing an existing work moves the prior work to the OS Trash (`import_elef`).

### Work folder rules (normative)

- A work is an immediate, non-hidden child directory of the library containing a top-level Markdown file; nested folders are contents, not works; symlinks are never followed (`discover_work_folders`; see Work folders above).
- Work names are compared after Unicode normalization + case folding (`normalized_name`); keep-both copies take `Name (2)`, `Name (3)`, … (`available_work_folder_name`).

## Library settings

The library-level .elef directory stores portable configuration and authoring registries:

- config.json: library appearance and hotkey preferences.
- snippets.json and math-shortcuts.json: optional user entries. Built-in entries remain in the shared frontend registry.

Names are compared after Unicode normalization and case folding. Cross-platform-incompatible names produce a warning; desktop preserves the original spelling.

## Trust boundary

Works, Markdown, media, and .elef archives are untrusted input. The webview has access to a small native command surface, so sanitization is one layer rather than the trust boundary. Folder discovery, archive validation, and the rules below are one contract: untrusted bytes enter only through validated paths.

### Webview boundary

The shipped policy is configured in apps/desktop/src-tauri/tauri.conf.json and checked by apps/desktop/scripts/check_architecture.py:

- Scripts are self-only. The policy does not allow inline scripts or eval.
- Frames are disabled; network connections are limited to Tauri IPC.
- Remote images are blocked. Local app, asset, and elefasset protocols supply packaged and work-local media.
- CodeMirror 6's `style-mod` inserts its base and theme rules in a `<style>` element, so the CSP permits inline style elements. Inline style attributes are also used for CodeMirror geometry and KaTeX formula layout. This is why style-src allows unsafe-inline; script-src remains self-only.

The preview sanitizer validates rendered content before it reaches the DOM. Mermaid uses strict mode. The hostile-work workflow exercises representative script, event-handler, frame, unsafe-link, remote-fetch, and remote-media payloads against web and native paths. Passing that corpus does not prove that arbitrary malicious input is harmless.

### Native commands and files

- Tauri capabilities expose named commands, not generic filesystem or shell access. The capability list is checked against command registration and the desktop adapter.
- Rust commands validate their inputs, resolve work identifiers through the selected library, canonicalize paths, and enforce containment within the library root.
- Source writes use atomic replacement with fingerprint checks; the check-to-replacement window against an external writer remains a documented residual race and the editor displays that warning. See [ADR-008](adr/008-safe-writes-and-conflict-detection.md).
- Archive import follows the [rejection rules](#archive-rejection-rules-normative) above: traversal paths, symlinks, and special files rejected, size and compression limits applied, staging before library entry.
- The asset protocol is read-only and scoped to one work folder's images. Uploaded media is content-addressed and cannot overwrite another asset.

### Updates and dependency checks

Updater artifacts are signed and verified against the public key configured into the app. Release packaging and signing are in .github/workflows/desktop-release.yml. Dependency audit and native capability/CSP checks run in CI.

For the decision record and verification limits, see [ADR-006](adr/006-security-model.md) and [development and testing](../development.md).

## Persisted-format version rules

The persisted format is the work folder on disk: the Markdown source, the optional `elef.json` manifest, work assets, and the `.elef` archive encoding of the same tree. (Rails rows are a server projection of this format, not a second format: `Source::Document` delegates all Work syntax to `@elef/work-model` via the shared renderer bundle — `apps/web/app/lib/source/document.rb:18-21`.)

### Rules

1. **Unknown fields are ignored, never rejected.** `read_manifest` (`crates/local-store/src/manifest.rs`) reads only `id` and `schema_version`; extra JSON members are skipped. New optional fields are backward and forward compatible by construction.
2. **Newer `schema_version` values stay openable.** A manifest above `MANIFEST_SCHEMA_VERSION` (`consts.rs`) is read for known fields with one non-blocking notice (`manifest_notices` in `manifest.rs`). A newer version must never block opening; it may gate newer features behind the notice.
3. **Missing or invalid manifests degrade, never block.** A work without a readable `elef.json` opens under a path-derived identity; first open recreates the manifest when the directory is writable ([Manifest](#manifest), `open_work_folder` in `work_folders.rs`).
4. **Removal or renames need a migration, not a version bump.** Deleting or retyping a field breaks rule 1. Such a change ships a code migration for existing works plus a schema update here, in the same commit.
5. **Limits are constants with tests.** The archive limits in [Archive rejection rules](#archive-rejection-rules-normative) mirror `local-store` constants; changing either side updates the other plus the boundary tests.
6. **Every format change extends this doc plus the `spec/` schema and fixtures in the same commit.** (Phase 12 owner decision D4b, relocated: prose lives here, machine-checked law lives in `spec/`.) New fields, versions, or layout rules land with doc updates and schema/fixtures proving both directions.

### Adjacent vocabularies (owned elsewhere, referenced here)

- Markdown front-matter link keys `elef_document_key` / `elef_aliases` (`Source::Document::PORTABLE_DOCUMENT_KEY/ALIASES`, `apps/web/app/lib/source/document.rb:5-6,78-96`; semantics in `docs/desktop/adr/010-portable-document-links.md`). Key renames follow rule 4.
- Library-level `.elef/config.json` (`LIBRARY_CONFIG_SCHEMA_VERSION`), `snippets.json` / `math-shortcuts.json` (`AUTHORING_REGISTRY_SCHEMA_VERSION`): same additive discipline; no committed schema yet (minimal-honest scope, D4b).
