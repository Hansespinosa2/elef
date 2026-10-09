# Elef Art

Elef Art adds a presentation layer to an ordinary Markdown list. Markdown remains the source of truth: remove the `:::art` line and the list is still meaningful Markdown.

## Syntax and meaning

Write the exact, column-zero directive on its own line. It takes no arguments:

```markdown
:::art
- Reliability
- Simplicity
- Portability
```

An unordered root list becomes **Peers**. An ordered root list becomes a **Sequence**:

```markdown
:::art
1. Discover
2. Design
3. Build
4. Launch
```

Only direct items of the root list are Art items. Nested paragraphs and ordered/unordered lists remain normal recursive Markdown content inside their parent item. Any body content beyond the lead makes the Art block rich.

The directive must bind immediately to a root list, with only blank lines or valid `:::align{...}` / `:::position{...}` directives in between. A heading, paragraph, code block, closing `:::`, unknown directive, or other content prevents binding. A second `:::art` replaces the first pending directive and the first reports `ART_NO_LIST_TARGET`.

Art-looking text in code fences, display math, blockquotes, indented code, or nested list content remains ordinary text. Invalid Art arguments report `ART_INVALID_SYNTAX` and do not activate Art.

## Layout and fallback

- Documents wrap Peers as centered cards and show Sequences vertically with native ordered-list numbering.
- Presentations use the same Peer wrapping. Compact Sequences may use a horizontal row when the fixed host is wide enough; rich Sequences and all other Sequences are vertical.
- Layout never changes whether the source means Peers or Sequence. The author does not select a mode, orientation, or coordinates.
- Images, video, tables, code blocks, and other unsupported content keep their complete Markdown rendering in a plain-list fallback and report `ART_UNSUPPORTED_CONTENT`.
- An Art list containing an effective presentation step boundary falls back to complete Markdown and reports `ART_REVEAL_BOUNDARY`; split the Art list or remove the step marker inside it.
- If content cannot fit a fixed presentation host, all content stays in the semantic list and Art reports `ART_NO_FIT` in the editor. Art does not shrink text or hide content.
- Document pagination splits between root items. A single root item taller than a page remains intact and reports `ART_ITEM_TOO_TALL`.

Use `:art` in the directive palette to insert the modifier without rewriting list markers or content.

For implementation details, measured acceptance fixtures, requirement coverage, and current external blockers, see [the Constitution](CONSTITUTION.md), [integration map](INTEGRATION-MAP.md), and [verification manifest](VERIFICATION.json).
