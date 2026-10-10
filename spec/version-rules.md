# Persisted-format version rules

The persisted format is the deck directory on disk: the Markdown source,
the optional `elef.json` manifest, deck assets, and the `.elef` archive
encoding of the same tree. (Rails rows are a server projection of this
format, not a second format: `Source::Document` delegates all Work syntax
to `@elef/work-model` via the shared renderer bundle —
`apps/web/app/lib/source/document.rb:18-21`.)

## Rules

1. **Unknown fields are ignored, never rejected.** `read_manifest`
   (`crates/local-store/src/manifest.rs`) reads only `id` and
   `schema_version`; extra JSON members are skipped. New optional fields
   are backward and forward compatible by construction.
2. **Newer `schema_version` values stay openable.** A manifest above
   `MANIFEST_SCHEMA_VERSION` (`consts.rs`) is read for known fields with
   one non-blocking notice (`manifest_notices` in `manifest.rs`). A newer
   version must never block opening; it may gate newer features behind
   the notice.
3. **Missing or invalid manifests degrade, never block.** A deck without
   a readable `elef.json` opens under a path-derived identity; first open
   recreates the manifest when the directory is writable
   (`docs/desktop/data-format.md#manifest`, `open_deck` in `decks.rs`).
4. **Removal or renames need a migration, not a version bump.** Deleting
   or retyping a field breaks rule 1. Such a change ships a code
   migration for existing decks plus a schema update here, in the same
   commit.
5. **Limits are constants with tests.** The archive limits in
   [archive-layout.md](archive-layout.md) mirror `local-store` constants;
   changing either side updates the other plus the boundary tests.
6. **Every format change extends `spec/` + fixtures in the same commit.**
   (Phase 12 owner decision D4b.) New fields, versions, or layout rules
   land with schema/doc updates and fixtures proving both directions.

## Adjacent vocabularies (owned elsewhere, referenced here)

- Markdown front-matter link keys `elef_document_key` / `elef_aliases`
  (`Source::Document::PORTABLE_DOCUMENT_KEY/ALIASES`,
  `apps/web/app/lib/source/document.rb:5-6,78-96`; semantics in
  `docs/desktop/adr/010-portable-document-links.md`). Key renames follow
  rule 4.
- Library-level `.elef/config.json` (`LIBRARY_CONFIG_SCHEMA_VERSION`),
  `snippets.json` / `math-shortcuts.json`
  (`AUTHORING_REGISTRY_SCHEMA_VERSION`): same additive discipline; no
  committed schema yet (minimal-honest scope, D4b).
