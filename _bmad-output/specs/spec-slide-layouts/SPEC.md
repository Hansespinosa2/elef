---
id: SPEC-slide-layouts
companions:
  - implementation-plan.md
sources: []
---

> **Canonical contract.** This SPEC and the files in `companions:` are the complete contract for the Markdown slide-layout proof of concept.

# Markdown Slide Layouts

## Why

Elef needs a small, opinionated way to give individual slides distinct visual roles without reproducing PowerPoint's large slide-type catalog. The author needs to express those choices in portable Markdown, while the preview presents an intro slide as a deliberate title moment rather than applying one uniform layout to every slide.

## Capabilities

- **CAP-1**
  - **intent:** Authors can select `body` or `intro` for an individual slide in the Markdown source while Markdown remains the source of truth.
  - **success:** A source containing `:::slide-layout{intro}` parses with the slide layout set to `intro`; the directive is not rendered as visible slide content; visual edits preserve the directive; an omitted directive resolves to `body`.
- **CAP-2**
  - **intent:** An intro slide presents all of its Markdown content as a vertically centered, left-aligned content block with a generous inset and a substantially larger title.
  - **success:** A rendered intro fixture visibly differs from a body fixture in vertical centering, left alignment, inset, and title scale while retaining all authored content.

## Constraints

- The existing standalone `---` line remains the canonical slide boundary.
- Layout metadata is valid only at the beginning of a slide and scopes until the next slide boundary.
- Parsing must continue to protect standalone separators inside initial front matter and fenced code blocks.
- Visual editing and source serialization must preserve layout metadata instead of silently reverting the slide to `body`.
- Slides without metadata must retain the current body appearance.
- The proof of concept must use the existing React/TypeScript presentation domain and preview architecture.

## Non-goals

- A broad catalog of PowerPoint-style slide types.
- Arbitrary per-slide CSS or a general visual style editor.
- A full document theme/layout inheritance system.
- Layouts beyond `body` and `intro`.
- Replacing Markdown separators or storing layout state outside the Markdown document.

## Success signal

An author can add `:::slide-layout{intro}` before a slide heading, see a large centered-left intro slide in the preview, edit that slide visually, and save without losing the directive. Existing slides with no directive continue to render as body slides and existing Markdown parsing behavior remains intact.

## Assumptions

- The directive is treated as metadata by the parser and remains visible to the source editor.
- The rendered preview may normalize or omit the directive from the editable content DOM as long as source updates preserve it.

