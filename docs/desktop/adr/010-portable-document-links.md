# ADR-010: Store portable document-link metadata in Markdown front matter

- Status: Proposed
- Date: 2026-10-05
- Decider: Andres
- Confidence: medium-high
- Accepted when: shared graph tests prove key and alias resolution from a folder and `.elef` archive, and Rails package import/export round-trips the same metadata

## Context

Rails stores stable document keys and historical title aliases in database rows. A desktop library has no database, and a deck moved as a folder or `.elef` archive must retain the links that use those values. The approved `elef.json` contract stays limited to `{ id, schema_version }`.

## Options considered

- **Keep graph metadata only in Rails rows.** Rejected: folder and archive copies lose custom keys and aliases.
- **Add fields to `elef.json`.** Rejected: expands the intentionally tiny manifest and makes links depend on a manifest that is optional for opening a deck.
- **Store optional metadata in Markdown front matter** (chosen): it travels with the source, is readable in any editor, and does not add another file to a deck.

## Decision (proposed)

Document decks may carry two optional top-level front-matter fields:

- `elef_document_key`: a JSON-quoted string with the stable graph key.
- `elef_aliases`: a JSON array of historical or alternate titles.

These JSON values are valid YAML scalars. The shared Rails JavaScript reads them for both graph hosts. An explicit front-matter key takes precedence; Rails database fields remain an index mirror. Desktop uses the manifest UUID when the optional key is absent. Old readers preserve the lines as ordinary front matter; new readers ignore malformed values and continue with the database or manifest fallback.

Rails leaves canonical Markdown untouched during ordinary saves and adds these fields to exported work packages from its existing document-key and alias records. The importer merges package metadata into the imported Markdown and rebuilds its database indexes. The `elef.json` shape and folder `schema_version` do not change: these fields are additive, optional source metadata, and the source file remains openable without them.

## Consequences

- Keys and aliases travel with Markdown and are included unchanged in folder copies and `.elef` archives.
- Portable graph metadata is visible in source mode and may be edited by hand; malformed JSON is ignored safely.
- Database keys and aliases remain queryable by Rails; package export combines those records with any portable metadata already present in source.
- Existing desktop documents without these fields use their manifest UUID and title. Rails source remains byte-for-byte stable until it is exported for portability.

## Revisit when

The metadata grows beyond link identity and aliases, or another consumer needs structured deck metadata outside Markdown.
