# Elef archive layout (`.elef` files)

Normative layout for the ZIP archives produced and consumed by the desktop
transfer path. Code truth is `crates/local-store/src/` (transfer:
`archives.rs` — `export_elef`, `import_elef`, `extract_archive`,
`validate_archive_path`, `single_wrapper_name`, `collect_archive_items`;
discovery: `discovery.rs` — `choose_source_file`, `source_file_key`,
`available_deck_name`, `discover_decks`; decks: `decks.rs` —
`normalized_name`, `validate_deck_name`; manifests: `manifest.rs`);
prose truth is [data-format.md](../docs/desktop/data-format.md#elef-archive).
This document restates the rules both must keep; on conflict the code wins
and this file is a bug.

## Container

- A `.elef` file is a ZIP archive (directories + deflated files).
- Export writes entries sorted by name with fixed metadata (compression
  level 6, default timestamp, `0o100644`) for deterministic output
  (`export_elef`). Byte identity across runs is intended but not asserted
  here; the freshness/corpus suites pin behavior.

## Member layout

- The deck's files sit at the archive root (`collect_archive_items`:
  paths relative to the deck directory, `/`-separated).
- Import also accepts a single wrapping directory: when every file is
  nested under one top-level directory, that prefix is stripped and the
  wrapper name becomes the imported deck name (`single_wrapper_name`,
  `import_elef`).
- After unwrapping, the staging root must contain a Markdown source file
  chosen by the source-file rule (top-level `*.md`, preferring
  `presentation.md`, then `document.md`, then shortest name, then
  case-insensitive and bytewise lexical order: `choose_source_file`,
  `source_file_key`). An archive with no top-level Markdown file is
  rejected (`CoreError::InvalidInput`).
- `elef.json` at the root is optional. When present it must parse as a
  [deck manifest](deck-manifest.schema.json); a UUID already in the
  library prompts for replace / keep-both / cancel (`import_elef`).
- In-progress save temp files (`.elef-save-*.tmp`) are never exported.

## Rejection rules (import)

An archive is rejected before anything lands in the library when any
entry (`validate_archive_path`, `extract_archive`):

- has an empty, absolute, or drive-qualified path, or contains `\`, NUL,
  `:`, a control character, or an empty / `.` / `..` segment;
- is encrypted or a symlink, or carries a non-regular, non-directory
  unix mode (devices, fifos, sockets);
- duplicates another entry after Unicode normalization + case folding
  (`normalized_name`).

Whole-archive limits (`local-store` constants):

| Limit | Constant | Current value |
|---|---|---|
| Archive file size | `MAX_ARCHIVE_FILE_BYTES` | 600 MiB |
| Total uncompressed size | `MAX_ARCHIVE_UNCOMPRESSED_BYTES` | 500 MiB |
| Entry count | `MAX_ARCHIVE_ENTRIES` | 10,000 |
| Per-entry compression ratio (entries ≥ 1 MiB) | `MAX_ARCHIVE_COMPRESSION_RATIO` / `MAX_ARCHIVE_RATIO_CHECK_BYTES` | 1000× / 1 MiB |

Data is extracted to a staging directory inside the library (`.elef-import-*`),
validated, then renamed into place; replacing an existing deck moves the
prior deck to the OS Trash (`import_elef`).

## Deck directory rules (shared with non-archive flows)

- A deck is an immediate, non-hidden child directory of the library
  containing a top-level Markdown file; nested folders are contents, not
  decks; symlinks are never followed (`discover_decks`, data-format.md).
- Deck names are compared after Unicode normalization + case folding
  (`normalized_name`); keep-both copies take `Name (2)`, `Name (3)`, …
  (`available_deck_name`).
