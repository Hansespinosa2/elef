# Elef Desktop — Data Format Spec (storage seam)

Status: draft v3 (2026-10-01). The seam between the app and the user's files. Everything here must stay stable: agents, the web app, and any future sync read it. Format changes require an ADR.

Items marked **(proposed)** are new in v3 and wait on an open question in [risks-and-open-questions.md](risks-and-open-questions.md).

## Deck folder layout

```
My Deck/
  presentation.md        # the source file (rule below)
  images/
    diagram.png
  elef.json              # optional; auto-created when absent
```

- A deck is **any immediate child folder of the library root** containing at least one top-level `.md` file. No manifest is needed to recognize or open it.
- **Source-file rule** (deterministic, never interactive): among top-level `.md` files prefer `presentation.md`, then `document.md`, then the **shortest** filename, then alphabetical. Shortest-before-alphabetical stops `talk (conflicted copy).md` from shadowing `talk.md` (a real Dropbox/iCloud/Syncthing failure). One source file per deck.
- **Not decks:** dot-folders (except `.elef/` at the library root, which is config), folders nested inside a deck (they are deck content), symlinks (never followed during discovery). A notes folder with `.md` files two levels down does not become decks.
- `images/` holds referenced assets. Ordinary references are relative (`images/foo.png`); desktop serves them through a read-only, deck-scoped asset protocol after rejecting traversal and symlink components. Absolute paths are rewritten on import.
- Media inserted through Elef may use `elef-asset:<sha256>` references. Those point to a content-addressed file named `<sha256>.<extension>` under the deck's `images/` directory. Desktop resolves the reference through its read-only asset protocol; the Rails app resolves the same digest through its media store. The asset bytes travel with the deck folder and `.elef` archive.
- Deck folders contain **no version files, ever** (ADR-005).
- Transient exception: the atomic-write temp file (dot-prefixed, same directory) exists for milliseconds during a save and is removed on the next open if a crash left one behind (ADR-008). Discovery ignores dot-files.

## `elef.json` manifest

```json
{
  "id": "550e8400-e29b-41d1-a716-446655440000",
  "schema_version": 1
}
```

- `id`: UUID v4, the deck's stable identity. Created on first open if absent. Creation is **best effort**: if the folder is read-only the deck still opens, identity falls back to the path, and a notice is shown.
- `schema_version`: integer, bumped only when the folder contract changes. Readers tolerate newer versions: read what they understand, show a non-blocking "newer format" notice.
- Never required: a folder without one is still a deck. The user never creates it by hand.
- Folder name is display-only; renames never change identity.
- **UUID collisions.** Copying a deck folder copies its `elef.json`, so two folders can share one UUID. On a cold scan, normalized path order decides deterministically: the first path retains the UUID; other copies use their path-derived identity in the in-memory index. Opening a duplicate best-effort writes it a fresh UUID v4 manifest. If that folder is read-only, its path remains the identity and the app shows a notice. No persistent UUID map is required.

## `.elef` single-file format

- A zip whose root is the deck folder's contents: source `.md`, `images/`, `elef.json` when present. Import tolerates exactly one wrapping top-level folder (Finder's "Compress" adds one).
- Entries: relative paths only, `/` separators, UTF-8 names. Symlink entries, special files, absolute paths and `..` are rejected (import hardening, [security.md](security.md)). File modes and timestamps are ignored on import.
- Export is deterministic: entries sorted, timestamps fixed, so exporting identical folder contents yields identical bytes.
- **"Round-trips byte-identical" means:** export → import into an empty library → compare per-file SHA-256 of the deck folder; all equal. (Archive-level determinism is the stronger, testable bonus.)
- Import flow: extract to a staging dir → validate → read/keep `id` → if the UUID exists in the library, prompt (replace / keep both with new UUID / cancel) → move into the library root.
- The app registers `.elef` with the OS for double-click import. The container version tracks `schema_version`.

## Library-level files (`.elef/` in the library root)

Mirrors Obsidian's `.obsidian/`.

```
~/Elef/                  # library root (user-chosen)
  .elef/
    config.json          # portable library preferences (theme, hotkeys)
    snippets.json        # optional custom user snippets; same JSON shape as the web resource
    math-shortcuts.json  # optional custom user math shortcuts; same JSON shape as the web resource
  My Deck/
  Another Deck/
```

- Each file carries its own `schema_version`.
- **(proposed, Q4)** Device-specific state (window geometry, last-open deck, recents) lives in the OS app-data directory, not in the library root. Otherwise a library synced between the MacBook and Omarchy ping-pongs window geometry between two machines.
- Desktop reads the shared built-in authoring registry and overlays optional custom snippet/math-shortcut entries from these files. Missing files mean no custom entries. Writes validate the registry type, entry count, and JSON size, then atomically replace only the selected `.elef` file.

## Cross-platform rules

- **Case:** folder identity compared case-insensitively; import warns on case-only collisions (`My Deck` vs `my deck`).
- **Unicode:** names compared after NFC normalization; equivalent-but-different byte sequences warn like case collisions.
- **Names:** warn on characters and patterns that break elsewhere (`/ \ : * ? " < > |`, trailing dot or space, reserved device names). Warn, don't rename.
- **Paths:** `/` separators in stored references; no drive letters; UTF-8.
- **Atomicity:** every source write is temp file + flush + rename in the same directory, so a crash never leaves a half-written source file (ADR-008).
- **Library root on a synced or removable volume:** supported; the source-file rule, atomic writes and conflict detection are the safeguards. Not a v1 test target beyond the fixtures in [test-strategy.md](test-strategy.md).

## Schema evolution

- `schema_version` starts at 1. A reader meeting a higher version reads known fields and shows a non-blocking notice.
- Every change to this document that alters on-disk or in-archive bytes requires an ADR and a `schema_version` decision.
