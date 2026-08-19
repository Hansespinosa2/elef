---
title: 'Per-slide Markdown layouts'
type: 'feature'
created: '2026-08-18'
status: 'done'
review_loop_iteration: 0
baseline_commit: 'a138f56879abc3c4a0d0dc167d1d796d302aea64'
context:
  - '{project-root}/_bmad-output/specs/spec-slide-layouts/SPEC.md'
  - '{project-root}/_bmad-output/specs/spec-slide-layouts/implementation-plan.md'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** Elef currently gives every slide the same body presentation, so an author cannot create a distinct title/introduction moment without leaving Markdown. The feature must add a small, opinionated layout vocabulary while keeping Markdown portable and canonical.

**Approach:** Add an optional slide-start `:::slide-layout{intro}` metadata directive. Parse it separately from slide content, default missing or invalid values to `body`, hide it in the rendered preview, and preserve it through visual and source editing.

## Boundaries & Constraints

**Always:** Keep standalone `---` as the slide separator. Recognize layout metadata only at the beginning of a slide. Support `body` and `intro`; missing or invalid metadata resolves to `body`. Preserve the directive in source and during visual serialization. Keep current body rendering and all existing front matter, fenced-code, math, task-list, focus, persistence, and accessibility behavior.

**Ask First:** None; layout syntax, defaults, intro behavior, and preservation rules were confirmed before implementation.

**Never:** Do not add a broad PowerPoint-style catalog, arbitrary per-slide style knobs, document-wide theme inheritance, or non-Markdown layout state. Do not reinterpret `---` in initial front matter or fenced code. Do not render the metadata directive as visible slide content.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|---|---|---|---|
| INTRO | `:::slide-layout{intro}` followed by Markdown | Slide layout is `intro`; rendered content excludes the directive | Fall back to body for malformed values |
| BODY_DEFAULT | No directive | Slide layout is `body`; current appearance remains unchanged | N/A |
| INVALID_LAYOUT | Unsupported layout name | Slide layout is `body`; source remains intact | Never throw for user-authored metadata |
| FRONT_MATTER | Initial document front matter plus a layout directive | Front matter remains document metadata; first slide receives its layout | Preserve existing front matter parsing |
| FENCED_CODE | Directive-like text inside a fence | Text remains code/content; slide layout is `body` | Never treat fenced text as metadata |
| VISUAL_EDIT | Intro slide edited in content preview | Content changes persist and the original layout directive remains | Preserve source if serialization cannot identify metadata |
| SOURCE_EDIT | Source block changes slide content | Updated content keeps the existing layout directive | Keep current source-edit behavior |

</frozen-after-approval>

## Code Map

- `src/domain/presentation/presentation.ts:1-15` -- define `SlideLayout` and add the normalized layout to `Slide`; existing callers receive `body` through parsing.
- `src/domain/presentation/markdown.ts:32-153` -- reuse front-matter and fence-aware section parsing; extract a leading layout directive per section and remove it from rendered slide Markdown.
- `src/domain/presentation/markdown.ts:155-230` -- preserve leading layout metadata through replacement and split transformations used by editing.
- `src/domain/presentation/index.ts:1-20` -- expose the layout type and parser helpers through the domain public API.
- `src/components/PresentationPreview.tsx:60-122` -- preserve layout metadata when serializing rendered DOM back to Markdown.
- `src/components/PresentationPreview.tsx:448-756` -- apply the normalized layout class and render content without the metadata directive; preserve current edit/source-block flows.
- `src/components/PresentationPreview.css:63-117` -- retain body styles and add intro positioning, inset, and title scale.
- `tests/unit/presentation.test.ts:21-158` -- extend parser and transformation coverage for defaults, invalid values, fences, front matter, and round trips.
- `tests/integration/presentation-preview.test.tsx` -- cover hidden directives, layout classes, intro rendering, and visual/source edit preservation.

## Tasks & Acceptance

**Execution:**
- [x] `src/domain/presentation/presentation.ts` -- add the `SlideLayout` union and normalized `Slide.layout` field -- give parsed slides an explicit layout contract.
- [x] `src/domain/presentation/markdown.ts` -- parse leading directives and preserve them across replacements/splits -- keep Markdown canonical and fence-safe.
- [x] `src/domain/presentation/index.ts` -- export new layout types/helpers -- keep component imports on the public domain boundary.
- [x] `src/components/PresentationPreview.tsx` -- hide metadata during rendering, apply layout classes, and restore metadata during serialization -- prevent visual edits from changing layout.
- [x] `src/components/PresentationPreview.css` -- style intro as a vertically centered, left-aligned, generously inset block with a substantially larger H1 -- implement the confirmed visual proof of concept.
- [x] `tests/unit/presentation.test.ts` -- add parser, transformation, and edge-case tests -- protect source semantics.
- [x] `tests/integration/presentation-preview.test.tsx` -- add rendered layout and edit round-trip tests -- protect user-visible behavior.

**Acceptance Criteria:**
- Given a slide beginning with `:::slide-layout{intro}`, when parsed, then its layout is `intro` and the directive is absent from rendered slide content.
- Given a slide without a directive, when rendered, then it uses `body` and retains the existing appearance.
- Given an invalid layout directive, when parsed, then the slide uses `body` without throwing.
- Given an intro slide, when rendered, then all authored content remains visible in a vertically centered, left-aligned block with generous inset and a substantially larger H1.
- Given front matter, fenced code, or standalone separators, when parsed, then existing slide-boundary semantics remain unchanged.
- Given an intro slide edited visually or through a source block, when serialized, then its `:::slide-layout{intro}` directive remains in the Markdown source.
- Given browser or Tauri persistence, when a layout-bearing source changes, then the existing save and preview flows continue to work.

## Design Notes

The source directive is metadata scoped by the existing slide separator:

```md
:::slide-layout{intro}
# Welcome to Elef

The authored Markdown remains the source of truth.
```

The preview should render only the content after the directive, while source operations retain the directive separately. This avoids making a custom directive part of the content-editable DOM, where DOM-to-Markdown serialization could otherwise erase it.

## Verification

**Commands:**
- `npm test -- --run tests/unit/presentation.test.ts tests/integration/presentation-preview.test.tsx` -- expected: targeted parser and preview tests pass.
- `npm run build` -- expected: TypeScript and production Vite build complete successfully.
- `git diff --check` -- expected: no whitespace errors.

## Suggested Review Order

**Markdown contract**

- Normalize the directive separately from authored content, preserving invalid metadata for round trips.
  [`markdown.ts:92`](../../src/domain/presentation/markdown.ts#L92)

- Carry normalized layout state on every parsed slide.
  [`presentation.ts:1`](../../src/domain/presentation/presentation.ts#L1)

- Preserve layout directives through replacement and split editing transformations.
  [`markdown.ts:107`](../../src/domain/presentation/markdown.ts#L107)

**Preview presentation**

- Apply layout classes while rendering only directive-free slide content.
  [`PresentationPreview.tsx:534`](../../src/components/PresentationPreview.tsx#L534)

- Give intro slides centered, inset, left-aligned presentation and larger titles.
  [`PresentationPreview.css:84`](../../src/components/PresentationPreview.css#L84)

**Verification**

- Cover parser defaults, fences, invalid values, and metadata-preserving transformations.
  [`presentation.test.ts:45`](../../tests/unit/presentation.test.ts#L45)

- Verify hidden directives, intro styling hooks, and edit preservation in the preview.
  [`presentation-preview.test.tsx:55`](../../tests/integration/presentation-preview.test.tsx#L55)
