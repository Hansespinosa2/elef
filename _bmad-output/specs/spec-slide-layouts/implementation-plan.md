# Implementation Plan

## Contract and source grammar

Recognize an optional first non-empty line in each parsed slide:

```md
:::slide-layout{intro}
# Welcome to Elef

Markdown content remains unchanged.
```

The directive is metadata, not rendered content. The parser returns a normalized `layout` value on each `Slide`; absent or invalid values resolve to `body`. Supported values for this proof of concept are `body` and `intro`.

The existing initial document front matter and standalone `---` slide separators remain unchanged. A `---` inside initial front matter or a fenced code block must not become a slide boundary, and a directive-like line inside fenced code must remain ordinary code.

## Work slices

1. **Domain model**
   - Add a stable `SlideLayout` union and `layout` to `Slide`.
   - Parse and strip only the leading layout directive for rendering while retaining enough source information to round-trip it.
   - Keep invalid and missing directives on the `body` fallback.
   - Extend slide replacement/serialization helpers so metadata is preserved during visual edits and source-block edits.

2. **Preview integration**
   - Apply a layout-specific class to each slide.
   - Keep the directive out of the rendered content tree.
   - Add the `intro` class behavior: vertically center the content block, align it to the left, increase the inset, and make the first H1 substantially larger.
   - Preserve current body rendering, overflow handling, math behavior, task items, focus behavior, and slide numbering.

3. **Tests**
   - Unit-test parsing for body default, intro selection, invalid values, leading blank lines, separators, front matter, and fenced code.
   - Unit-test source replacement and visual serialization preserving the directive.
   - Integration-test that the directive is hidden in the preview, intro and body classes differ, authored content remains present, and visual edits retain metadata.
   - Add an accessible fixture for the intro title and subtitle/content block.

4. **Validation**
   - Run targeted presentation unit and integration tests.
   - Run the production TypeScript/Vite build.
   - Check the diff for whitespace errors.

## Acceptance criteria

- Given a slide beginning with `:::slide-layout{intro}`, when the document is parsed, then its layout is `intro` and the directive is not rendered as slide content.
- Given a slide without a directive, when it is parsed, then its layout is `body` and its preview is unchanged.
- Given an invalid or unsupported layout directive, when it is parsed, then the slide safely falls back to `body`.
- Given an intro slide, when it is rendered, then all authored Markdown content remains visible in a vertically centered, left-aligned block with a generous inset and a substantially larger H1.
- Given a slide containing a standalone `---`, initial front matter, or fenced code, when it is parsed, then existing separator semantics remain unchanged.
- Given a visually edited intro slide, when source is serialized, then the original `:::slide-layout{intro}` directive remains in the slide source.
- Given a source edit that changes the slide content but not the directive, when the preview rerenders, then the selected layout remains `intro`.
- Given browser or Tauri presentation flows, when a layout-bearing source changes, then existing persistence and preview behavior continue to work.

## Suggested file map

- `src/domain/presentation/presentation.ts` — `SlideLayout` and `Slide.layout`.
- `src/domain/presentation/markdown.ts` — leading directive parsing, normalization, and metadata-preserving transformations.
- `src/domain/presentation/index.ts` — public exports.
- `src/components/PresentationPreview.tsx` — layout class application and metadata-preserving edit serialization.
- `src/components/PresentationPreview.css` — body/intro layout styles.
- `tests/unit/presentation.test.ts` — parser and transformation coverage.
- `tests/integration/presentation-preview.test.tsx` — rendered preview and editing coverage.

## Deferred decisions

- Additional named layouts and whether a document-level default should be introduced.
- Whether layout metadata should eventually support additional attributes beyond a single named layout.
