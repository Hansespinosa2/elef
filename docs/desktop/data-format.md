# Desktop data format

The desktop library is a user-owned directory tree. This document records the formats read and written by desktop code; changes to these contracts need matching Rust and fixture coverage.

## Deck folders

A deck is an immediate, non-hidden child directory of the chosen library that contains a top-level Markdown file. Nested folders are deck contents, not separate decks. Discovery does not follow symlinks.

~~~text
Elef/
  .elef/
    config.json
    snippets.json
    math-shortcuts.json
  My Deck/
    presentation.md
    images/
    elef.json
~~~

When a deck contains several top-level Markdown files, desktop chooses deterministically: presentation.md first, then document.md, then the shortest filename, then case-insensitive and bytewise lexical order. This keeps a sync-tool conflicted copy from shadowing the original.

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

Markdown is the editable source. Relative media paths stay inside the deck. Media inserted by Elef may use a content-addressed elef-asset reference; its bytes are stored below that deck's images directory.

Document links can carry optional elef_document_key and elef_aliases values in Markdown front matter. Rails and desktop use the shared link parser and resolver. See [ADR-010](adr/010-portable-document-links.md).

Source writes use an adjacent temporary file and atomic replacement with a source fingerprint check. The accepted behavior and the remaining external-writer race are described in [ADR-008](adr/008-safe-writes-and-conflict-detection.md).

## .elef archive

An .elef file is a ZIP archive containing the deck's files at its root. Import also accepts a single wrapping directory. Export sorts entries and fixes archive metadata for deterministic output.

Import rejects absolute paths, traversal, symlinks, and special files. Current core limits are 10,000 entries, 500 MiB uncompressed, and 600 MiB for the archive itself; extreme compression ratios are rejected. Data is extracted to a staging directory under the library, validated, then moved into place. UUID collisions prompt for replace, keep both, or cancel. Replacing moves the prior deck to the operating system's Trash.

The Tauri bundle registers the .elef extension. The app's file-open path accepts these archives for import.

## Library settings

The library-level .elef directory stores portable configuration and authoring registries:

- config.json: library appearance and hotkey preferences.
- snippets.json and math-shortcuts.json: optional user entries. Built-in entries remain in the shared frontend registry.

Names are compared after Unicode normalization and case folding. Cross-platform-incompatible names produce a warning; desktop preserves the original spelling.

See [security.md](security.md) for path containment and archive validation details.
