# ADR-010: Store portable document-link metadata in Markdown front matter

Reach for when: touching document keys, aliases, the graph, or work export/import.

- Status: Accepted
- Date: 2026-10-05
- Decider: Andres

## Context

Rails stores stable document keys and title aliases in database rows. A desktop library has no database, and a work moved as a folder or `.elef` archive must retain its links. The approved `elef.json` contract stays limited to `{ id, schema_version }`.

## Options considered

- Keep graph metadata only in Rails rows: rejected, folder and archive copies lose custom keys and aliases.
- Add fields to `elef.json`: rejected, expands the intentionally tiny manifest and ties links to a manifest that is optional for opening a work.
- Store optional metadata in Markdown front matter (chosen): travels with the source, readable in any editor, no new file.

## Decision

Document works may carry two optional top-level front-matter fields: `elef_document_key` (a JSON-quoted string) and `elef_aliases` (a JSON array). The shared work-model reads them on both hosts. An explicit front-matter key takes precedence; Rails database fields remain an index mirror, and desktop uses the manifest UUID when the key is absent. Old readers preserve the lines as ordinary front matter; new readers ignore malformed values and fall back. Duplicate keys leave matching links unresolved instead of picking by scan order. Rails adds these fields to exported work packages from its records; the importer merges them into the imported Markdown and rebuilds its indexes.

## Consequences

- Keys and aliases travel with Markdown through folder copies and `.elef` archives.
- Portable metadata is visible in source mode and hand-editable; malformed JSON is ignored safely.
- Rails source stays byte-for-byte stable until exported for portability.

## Revisit when

The metadata grows beyond link identity and aliases, or another consumer needs structured work metadata outside Markdown.
