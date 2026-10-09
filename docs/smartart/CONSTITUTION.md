# Elef Art Constitution

> **Authoritative execution contract**
>
> If an autonomous implementation agent receives:
>
> `/goal = "execute CONSTITUTION.md"`
>
> it MUST audit the current repository, implement Elef Art v1, integrate it across web and desktop, validate every normative requirement, and leave the branch merge-ready. This document overrides earlier Art constitutions, chats, mockups, and experiments.

**Version:** 6.0\
**Feature:** Elef Art\
**Source syntax:** `:::art`\
**Doctrine:** semantic input → geometric output\
**Repository:** `Hansespinosa2/elef`\
**Target lineage:** current `dev`

---

# 0. Normative precedence

When repository implementation details differ from historical notes in this file:

1. source-language and product invariants win;
2. semantic behavior wins;
3. measurable acceptance criteria win;
4. implementation paths/classes may adapt to current repository reality.

The agent MUST NOT silently change product semantics to accommodate existing code.

If a required external environment is unavailable, mark that verification `BLOCKED_EXTERNAL` with evidence. Never count blocked work as verified.

If the repository itself contradicts a product invariant, continue all unblocked work and report the exact conflict; do not invent a new product decision.

---

# 1. Product model

There is exactly one Art directive:

```markdown
:::art
```

Art applies to exactly one root Markdown list.

The root list determines Art semantics:

```text
root unordered list -> peers
root ordered list   -> sequence
```

Everything nested inside a root list item remains ordinary recursive Markdown body content.

Example — Peers:

```markdown
:::art
- Reliability
- Simplicity
- Portability
```

Example — Sequence:

```markdown
:::art
1. Discover
2. Design
3. Build
4. Launch
```

Example — mixed recursive body:

```markdown
:::art
1. Research
   - Interview users
   - Review competitors
     1. Enterprise
     2. Consumer
2. Design
   1. Prototype
   2. Validate
```

This still contains exactly **2 Art items**.

The author never chooses:

- `flow`, `sequence`, or `peer` mode explicitly;
- rows or columns;
- orientation;
- layout name;
- coordinates;
- icons;
- connector paths;
- font-fitting behavior.

---

# 2. Invariants

| ID | Requirement |
|---|---|
| ART-INV-001 | Markdown is canonical. Removing `:::art` leaves meaningful ordinary Markdown. |
| ART-INV-002 | `:::art` is the only valid Art source directive in v1; Art accepts no arguments. |
| ART-INV-003 | Root `<ul>` derives Peers; root `<ol>` derives Sequence. |
| ART-INV-004 | Only direct children of the root list are Art items. Nested lists never become top-level Art items. |
| ART-INV-005 | Nested ordered/unordered combinations preserve their native Markdown semantics recursively. |
| ART-INV-006 | Geometry, content length, nesting depth, and host shape never change Peers ↔ Sequence semantics. |
| ART-INV-007 | Art never silently drops, duplicates, reorders, ellipsizes, hides, or intentionally truncates authored content. |
| ART-INV-008 | Art never shrinks its own font size to make content fit. |
| ART-INV-009 | Impossible fixed-host content becomes an explicit diagnosed no-fit state. |
| ART-INV-010 | Root and nested list semantics remain native HTML list semantics. |
| ART-INV-011 | Source order = parser order = DOM order = editing/focus order. |
| ART-INV-012 | Rendering is deterministic for identical parsed content, host geometry, theme, typography, browser engine, and loaded fonts. |
| ART-INV-013 | Art is usable before JavaScript enhancement; JS failure does not remove content. |
| ART-INV-014 | Shared Art semantics/rendering are implemented once and consumed by Rails and Tauri. |
| ART-INV-015 | No icons, chevrons, snake layout, Mermaid dependency, AI layout selection, or general diagram DSL in v1. |
| ART-INV-016 | Art decoration is renderer/CSS-only and never serializes back into Markdown. |

---

# 3. Exact source grammar

## 3.1 Art line

The v1 grammar is deliberately stricter than some existing Elef directives:

```regex
^:::art[ \t]*$
```

Therefore:

- Art must begin at column 0;
- trailing spaces/tabs are allowed;
- leading spaces/tabs are not allowed;
- arguments are not allowed.

Valid:

```markdown
:::art
```

Invalid Art forms:

```markdown
 :::art
   :::art
:::art{}
:::art{flow}
:::art{grid}
:::art extra
```

Names that merely begin with `art` are not Art:

```markdown
:::artist
:::article
```

This column-0 rule intentionally prevents an Art directive from being recognized as nested list content.

## 3.2 One-line modifier

| ID | Requirement |
|---|---|
| ART-SRC-001 | Art is always a one-line modifier, never a scoped/container directive. |
| ART-SRC-002 | A later standalone `:::` never closes Art. |
| ART-SRC-003 | Art recognition occurs before generic directive scope lookahead can reinterpret it as a container. |

## 3.3 Protected contexts

Art-looking text inside these contexts is ordinary content:

- fenced code using backticks or tildes;
- Elef display-math fences;
- blockquotes;
- indented/nested list content;
- indented code.

| ID | Requirement |
|---|---|
| ART-SRC-004 | Exact `:::art` inside a protected context never activates Art and emits no Art diagnostic. |

## 3.4 Binding

After a valid root `:::art`, only these may intervene before its target:

- blank lines;
- a valid `:::align{...}`;
- a valid `:::position{...}`.

The next top-level content block must be a Markdown list.

Examples:

```markdown
:::art

- A
- B
```

binds.

```markdown
:::art
:::align{center}
- A
- B
```

binds and the list receives both Art and the normal alignment semantics.

```markdown
:::align{center}
:::art
- A
- B
:::
```

also binds; alignment retains its ordinary Elef scope and Art applies only to the list.

```markdown
:::art
A paragraph.
- A
- B
```

does not bind.

```markdown
:::art
:::
- A
```

does not bind.

A second valid `:::art` before a target supersedes the first pending Art directive:

```markdown
:::art
:::art
- A
```

The first emits `ART_NO_LIST_TARGET`; the second binds. There is no duplicate-Art diagnostic.

| ID | Requirement |
|---|---|
| ART-SRC-005 | Art targets exactly one root list block and never skips an intervening barrier to find a later list. |
| ART-SRC-006 | Another valid Art directive supersedes the prior pending Art; prior Art reports no target. |
| ART-SRC-007 | A standalone closing directive is a binding barrier. |
| ART-SRC-008 | Art and valid alignment/position directives compose identically in editor mapping and rendering. |

## 3.5 Invalid-form diagnostics

| Source | Result |
|---|---|
| exact `:::art` | Art candidate |
| `:::art{...}` | `ART_INVALID_SYNTAX` |
| `:::art extra` | `ART_INVALID_SYNTAX` |
| ` :::art` / indented Art | ordinary/unknown directive behavior; no Art activation |
| `:::artist` / `:::article` | ordinary unknown-directive behavior; no Art diagnostic |
| valid `:::art` in protected context | ordinary content; no Art diagnostic |

| ID | Requirement |
|---|---|
| ART-SRC-009 | Invalid-form behavior follows the table above exactly. |
| ART-SRC-010 | The Art directive line itself never appears in rendered content. |

---

# 4. Shared source-resolution architecture

The current repository historically contains separate editor and presentation directive logic. Art must not add a third interpretation.

Create/extract the smallest shared source-resolution seam needed for Art.

It MUST preserve existing non-Art directive behavior unless an existing bug is independently covered by repository tests.

A recognized Art directive is consumed as metadata and is never concatenated with its target Markdown before `markdown-it` parses that target. This is important for ordered lists beginning above 1:

```markdown
:::art
3. Alpha
4. Beta
```

The list source passed to Markdown parsing begins at `3. Alpha`; Art does not become a preceding paragraph.

Conceptual resolved block:

```js
{
  markdown,
  source_range,
  modifiers: {
    position: ...,
    art: {
      directive_id,
      source_range
    }
  }
}
```

No Art semantic mode is stored in the directive. Mode is derived later from the parsed root list.

| ID | Requirement |
|---|---|
| ART-ARCH-001 | Editor mapping, document rendering, and presentation rendering consume the same Art binding result. |
| ART-ARCH-002 | Art source ranges remain available for editing ownership without inserting Art text into Markdown rendering. |
| ART-ARCH-003 | The shared extraction is minimal: existing alignment/position semantics are not gratuitously redesigned. |
| ART-ARCH-004 | Phase 0 produces an integration map naming the current functions/modules used for source resolution, Markdown parsing, document rendering, presentation rendering, pagination, block operations, Art authoring, and parity tests. |

---

# 5. Diagnostics

Machine-readable diagnostics coexist with existing human-readable warning UI.

Stable codes:

```text
ART_NO_LIST_TARGET
ART_INVALID_SYNTAX
ART_UNSUPPORTED_CONTENT
ART_REVEAL_BOUNDARY
ART_NO_FIT
ART_ITEM_TOO_TALL
ART_INTERNAL_ERROR
```

Diagnostic DOM attributes, if used, contain **only stable enum codes**, never raw directive/source text.

Human warning messages may contain escaped user-readable context only through the repository's normal text-safe warning path.

| ID | Requirement |
|---|---|
| ART-DIAG-001 | Tests assert diagnostic codes rather than prose. |
| ART-DIAG-002 | Raw source text is never copied into code/class/style/data diagnostic values. |
| ART-DIAG-003 | `ART_NO_FIT` and `ART_ITEM_TOO_TALL` are visible in the existing editor validation/warning experience, not console-only. |
| ART-DIAG-004 | An Art list that spans an effective presentation reveal boundary falls back to complete Markdown and reports `ART_REVEAL_BOUNDARY` with an actionable warning. |

---

# 6. Markdown tree semantics

`markdown-it` is authoritative for Markdown meaning.

Do not build a second Markdown-list parser from source regexes.

## 6.1 Root semantics

```text
root <ul> -> peers
root <ol> -> sequence
```

## 6.2 Recursive item grammar

Conceptually:

```text
ArtBlock       := RootList
RootList       := UnorderedList | OrderedList
ArtItem        := direct ListItem child of RootList
ArtItemContent := Lead BodyBlock*
BodyBlock      := Paragraph | NestedList
NestedList     := UnorderedList | OrderedList
ListItem       := Paragraph? BodyBlock*
```

Nested lists recurse according to the canonical parser.

This describes supported token-tree shapes; it is not a new parser.

## 6.3 Lead and density

The first direct paragraph/inline content of a root Art item is its lead.

Density is derived only from root-item body presence:

```text
compact = every root item contains only its lead
rich    = any root item contains any additional paragraph or nested list
```

An empty root list item:

- still counts as one Art item;
- has an empty lead;
- is classified compact unless it has body content;
- renders as an empty semantic item rather than being dropped.

## 6.4 Ordered numbering

Root and nested ordered lists use normal `markdown-it` numbering.

For:

```markdown
:::art
3. Alpha
7. Beta
20. Gamma
```

the root Sequence begins at 3 and follows the parser's normal sequential semantics.

## 6.5 Supported recursive content

Supported inside Art items:

- paragraphs;
- arbitrarily nested parser-recognized unordered/ordered lists;
- emphasis/strong;
- links;
- strikethrough if enabled by the existing renderer;
- hard/soft breaks according to existing renderer behavior;
- inline code;
- existing inline math.

Inline/block images and video/media are **not** supported inside Art v1. Their presence triggers whole-block fallback. This is intentional scope discipline; image Art is deferred.

Likewise these trigger whole-block fallback:

- fenced code block;
- table;
- heading;
- Mermaid block;
- other block media;
- other unsupported block token.

Deep list nesting is not rejected merely for depth. Art uses the parser's actual token output and MUST traverse it iteratively or otherwise without introducing a lower recursion limit than the canonical parser.

| ID | Requirement |
|---|---|
| ART-SEM-001 | Root list type alone determines Peers vs Sequence. |
| ART-SEM-002 | Direct root `<li>` count alone determines Art item count. |
| ART-SEM-003 | Nested list type/depth never changes root mode or creates Art items. |
| ART-SEM-004 | Density is derived from body presence, not keywords, item count, or geometry. |
| ART-SEM-005 | Ordered starts, including `0` and values >1 supported by the parser, are preserved. |
| ART-SEM-006 | Empty root items are preserved as empty compact items. |
| ART-SEM-007 | Unsupported media/block content forces whole-block `fallback-unsupported`; no hybrid Art rendering. |
| ART-SEM-008 | Art's token/tree traversal must not crash on nesting at or beyond the parser's configured nesting limit. |

---

# 7. DOM contract

Conceptual active Art:

```html
<section class="elef-art"
         data-elef-art-root
         data-art-mode="sequence"
         data-art-density="compact"
         data-art-status="ready"
         data-art-layout="sequence-horizontal"
         data-art-settled="true">
  <ol class="elef-art-list">...</ol>
</section>
```

Enums:

```text
data-art-mode:
  peers
  sequence

data-art-density:
  compact
  rich

data-art-status:
  ready
  pending
  fallback-unsupported
  fallback-no-fit
  error

data-art-layout:
  peers-wrap
  sequence-horizontal
  sequence-vertical
  plain-list

data-art-settled:
  true
  false
```

Fixed host:

```html
<div data-art-host="fixed" data-art-overfull="true|false">...</div>
```

SSR/default status:

```text
document/flowing Art -> ready
fixed presentation Art -> pending
```

Fixed presentation default layout remains complete while pending:

```text
Peers    -> peers-wrap
Sequence -> sequence-vertical
```

Fallback states still emit `data-art-mode` and `data-art-density` when those semantics were successfully derived; `data-art-layout="plain-list"` is used for unsupported/error fallback.

| ID | Requirement |
|---|---|
| ART-DOM-001 | Root list remains native `<ul>` or `<ol>` inside the Art wrapper. |
| ART-DOM-002 | DOM state uses only the enumerated values above. |
| ART-DOM-003 | Fixed-host overfull state is inspectable as `data-art-overfull`. |
| ART-DOM-004 | Renderer-only wrappers/decorations never enter source serialization. |

---

# 8. Single-source visual tokens

Art constants live in one CSS source of truth, preferably the existing token layer.

Required variables:

```css
--art-gap
--art-peer-basis-compact
--art-peer-basis-rich
--art-sequence-min-inline
--art-card-padding
--art-radius
--art-document-lead-size
--art-document-body-size
--art-presentation-lead-size
--art-presentation-body-size
```

Initial v1 values:

```text
--art-gap: 16px
--art-peer-basis-compact: 200px
--art-peer-basis-rich: 280px
--art-sequence-min-inline: 200px
--art-card-padding: 16px
--art-radius: 10px

document lead: 18px
document body: 16px
presentation lead: 24px
presentation body: 18px
```

JavaScript MUST NOT duplicate `--art-gap` or `--art-sequence-min-inline`; fixed-layout logic reads their computed pixel values from the Art root/host.

Typography families/weights inherit the active Elef typography mode.

Colors/borders use existing work/theme tokens rather than a new palette.

| ID | Requirement |
|---|---|
| ART-VIS-001 | Art has one token source; JS fit math reads the same computed CSS values used by layout. |
| ART-VIS-002 | Art has no responsive `font-size` using `vw`, `cqw`, `clamp()`, `zoom`, or transform-based shrink-to-fit. |
| ART-VIS-003 | Text is never line-clamped or ellipsized. |
| ART-VIS-004 | Art uses the active Elef font family/theme rather than a hard-coded mockup font/palette. |

---

# 9. Peer layout

Peers use one wrapping CSS system in documents and presentations.

Required model:

```css
display: flex;
flex-wrap: wrap;
justify-content: center;
gap: var(--art-gap);
```

Each Peer item uses a density-specific preferred basis:

```text
compact: 200px
rich:    280px
```

Conceptually:

```css
flex: 0 1 var(--art-peer-basis-*);
inline-size: var(--art-peer-basis-*);
max-inline-size: 100%;
```

Therefore cards do not grow to fill a partial row; incomplete rows remain centered and card widths stay consistent except when a host is narrower than the preferred basis.

One item is one centered preferred-width card.

| ID | Requirement |
|---|---|
| ART-LAY-001 | Peer column count is emergent CSS wrapping; no JS column search exists. |
| ART-LAY-002 | Peer items do not flex-grow merely to fill a partial final row. |
| ART-LAY-003 | A final partial row is centered using logical/layout properties. |

---

# 10. Sequence layout

Sequence has exactly two realizations:

```text
sequence-horizontal
sequence-vertical
```

No snake.

## 10.1 Flowing/document host

Sequence is always vertical.

## 10.2 Fixed host

Default/SSR is vertical.

Horizontal is eligible when:

1. density is compact;
2. `N >= 2`;
3. host layout width `W > 0`;
4. the exact pure function passes:

```text
(W - gap * (N - 1)) / N >= sequenceMinInline
```

There is no separate item-count cap. The minimum-inline rule naturally limits how many items can fit.

With the initial 1120px canonical full-slide width, 5 compact items can fit at 200px minimum; 6 cannot.

Rich Sequence is always vertical in v1.

## 10.3 Long-word policy

Horizontal Sequence uses normal word wrapping:

```css
overflow-wrap: normal
word-break: normal
```

If a long unbreakable token causes overflow, horizontal validation fails and Sequence switches to vertical.

Vertical Sequence and Peers may use `overflow-wrap:anywhere` as a content-preservation fallback.

## 10.4 Connectors

Sequence connectors express authored order only.

They are:

- simple lines, never arrowheads;
- CSS pseudo-elements/background/borders only;
- written with logical properties so RTL placement is correct;
- decorative and not exposed to accessibility APIs;
- fragment-local in paginated documents.

| ID | Requirement |
|---|---|
| ART-LAY-004 | Flowing Sequence is always vertical. |
| ART-LAY-005 | Rich fixed Sequence is always vertical. |
| ART-LAY-006 | Compact fixed Sequence horizontal eligibility uses only the pure formula above and computed CSS tokens. |
| ART-LAY-007 | `N=1` Sequence is vertical. |
| ART-LAY-008 | Horizontal failure may transition once to vertical; there is no third layout. |
| ART-LAY-009 | Horizontal long-token overflow triggers vertical fallback rather than mid-word horizontal fragmentation. |

---

# 11. Fixed-host contract

## 11.1 Host

Presentation rendering marks the actual bounded content container with:

```html
data-art-host="fixed"
```

For inferred columns this is `.slide-region`.

Every fixed Art host MUST establish positioning:

```css
[data-art-host="fixed"] {
  position: relative;
  min-height: 0;
}
```

For a non-column slide, use a stable bounded content wrapper; do not teach Art about template names.

## 11.2 Coordinate space

Slides are CSS-transformed for preview scaling. Art fit decisions MUST use untransformed layout-space properties, not `getBoundingClientRect()`.

Permitted geometry sources:

```text
clientWidth/clientHeight
scrollWidth/scrollHeight
offsetWidth/offsetHeight
offsetTop/offsetLeft
offsetParent
```

`offsetWithin(root, host)` walks `offsetParent`s, summing offsets until the **positioned host is reached**, and fails explicitly if host is not encountered.

## 11.3 Ready containment oracle

A fixed Art root may be `ready` only when all are true:

```text
host.scrollWidth  <= host.clientWidth  + 1
host.scrollHeight <= host.clientHeight + 1

root.scrollWidth  <= root.clientWidth  + 1
root.scrollHeight <= root.clientHeight + 1

rootLeft + root.offsetWidth  <= host.clientWidth  + 1
rootTop  + root.offsetHeight <= host.clientHeight + 1
```

and every root Art item has no internal scroll overflow beyond 1 layout-space CSS px.

Checking host overflow is mandatory so trailing siblings and multiple Art roots cannot be ignored.

## 11.4 Hidden hosts

If host/root width is zero or host height is zero:

```text
status = pending
settled = false
```

Do not declare fit/no-fit.

Re-evaluate after non-zero ResizeObserver geometry.

| ID | Requirement |
|---|---|
| ART-FIT-001 | Fixed hosts are bounded and positioned; the measurement origin is well-defined. |
| ART-FIT-002 | Fit uses unscaled layout-space properties only. |
| ART-FIT-003 | Ready status requires both root/item containment and whole-host containment. |
| ART-FIT-004 | Zero-size/hidden hosts remain pending rather than false no-fit. |

---

# 12. Fixed-layout lifecycle and performance

Use one presentation-level Art controller where practical.

Triggers:

- initial connection;
- projection/source refresh;
- fixed-host resize;
- theme/typography change;
- `document.fonts.ready`;
- `document.fonts` `loadingdone` when supported;
- hidden→visible transition.

Evaluation is globally batched.

### Pass A — decision/write

For every dirty Art root:

- Peers: apply/retain `peers-wrap`;
- Sequence: evaluate the pure horizontal formula and write horizontal or vertical.

Write all dirty roots before measuring any of them.

### Pass B — read

In the next animation frame, measure all dirty roots/hosts.

- valid roots settle;
- failed horizontal Sequences are queued for vertical;
- failed Peers/vertical Sequences become no-fit.

### Pass C — one fallback write/read

Write vertical to all failed-horizontal Sequences, then measure them together once.

There is **no compact-spacing retry** and no font-fitting loop.

Limits per evaluation cycle:

```text
Peer:     <= 1 layout commit, <= 1 measurement
Sequence: <= 2 layout commits, <= 2 measurements
global forced-layout phases: <= 2
```

`elef:art-settled` may be dispatched when a measurable root transitions to settled; `data-art-settled` is authoritative.

A 100-slide/100-Art-root instrumented test MUST confirm these bounds and absence of ResizeObserver oscillation.

| ID | Requirement |
|---|---|
| ART-PERF-001 | Layout writes are batched before geometry reads across roots. |
| ART-PERF-002 | No root exceeds the commit/measurement bounds above in one stable evaluation cycle. |
| ART-PERF-003 | Observer callbacks are rAF-coalesced and disconnected/cleaned up on controller disconnect. |
| ART-PERF-004 | Stable geometry produces no continuing ResizeObserver/MutationObserver loop. |

---

# 13. No-fit behavior

A fixed slide can contain more content than physically fits. Art cannot solve an impossible slide without changing authored content.

When the final permitted layout fails the ready containment oracle:

```text
data-art-status="fallback-no-fit"
data-art-overfull="true" on the host
diagnostic = ART_NO_FIT
```

The complete semantic DOM remains.

No font shrink, hiding, clipping-by-Art, or source rewriting is used to conceal the failure.

The slide itself currently uses finite overflow behavior; this is acceptable only because the editor surfaces the explicit no-fit warning.

Print/export/present do not silently rewrite Art to hide the no-fit state.

| ID | Requirement |
|---|---|
| ART-FIT-005 | `fallback-no-fit` is explicit, inspectable, and user-visible in editing. |
| ART-FIT-006 | A root may never report `ready` while the fixed host fails the containment oracle. |

---

# 14. Document pagination

Documents use only:

```text
Peers    -> peers-wrap
Sequence -> sequence-vertical
```

No Art fit controller runs in documents.

## 14.1 Wrapper integration

The Art wrapper remains inside the existing editable/document block shell. The paginator treats any block containing `[data-elef-art-root]` as an Art pagination unit.

For Art units:

1. try grouped splitting at the root Art `<ul>/<ol>`;
2. split only between direct root `<li>` children;
3. do **not** fall through to generic text splitting inside a root Art item.

This explicitly overrides the current generic text-splitting behavior for Art.

## 14.2 Fragment identity

Existing document flow IDs remain the logical fragment identity.

When an Art list is split, the cloned wrapper/list structure and flow-content target must remain mergeable by the existing merge lifecycle.

## 14.3 Ordered continuation

For each Sequence remainder:

```text
baseStart = ol.hasAttribute("start") ? Number(ol.getAttribute("start")) : 1
remainderStart = baseStart + numberOfRootItemsPlacedBeforeRemainder
```

Do not use `start || 1`; `start=0` must be preserved when accepted by the parser.

## 14.4 Oversized single item

If one root Art item is taller than an empty page:

- it remains atomic in v1;
- the paginator does not text-split it;
- the page uses the existing overflowing-content treatment;
- emit `ART_ITEM_TOO_TALL`;
- content remains accessible in editor overflow/scroll behavior and is not silently deleted.

## 14.5 Fragment connectors

Sequence connectors exist only between items in the same page fragment.

| ID | Requirement |
|---|---|
| ART-PAG-001 | Art pagination splits only between direct root items. |
| ART-PAG-002 | Generic text splitting is disabled for Art units. |
| ART-PAG-003 | Ordered continuation handles `start=0`, `start=1`, and starts >1 correctly. |
| ART-PAG-004 | Logical merge then repagination is idempotent for Art fragments. |
| ART-PAG-005 | An oversized single Art item remains atomic and produces `ART_ITEM_TOO_TALL`. |
| ART-PAG-006 | No Sequence connector crosses a physical page boundary. |

---

# 15. Editing and ownership

The Art line and target list are associated for block operations.

Use/extend the repository's existing block-operation range mechanism rather than inventing a separate editor transaction system.

## Delete

Deleting an Art target as a visual block deletes its associated Art line in the same source transaction.

## Move

Moving an Art target moves its associated Art line.

Alignment/position ownership follows existing Elef rules:

- a block-scoped position directive that existing block operations already own moves with the block;
- a group-scoped alignment container retains its normal group semantics;
- Art does not claim or move an unrelated group scope.

## Source conversion

If source editing turns the target list into non-list content, the Art line remains but becomes unbound and reports `ART_NO_LIST_TARGET`.

It never jumps to a later list.

## List split

If source editing turns one root list into two root list blocks, Art remains bound only to the first. The second is ordinary Markdown. This is intentional and does not itself produce an Art diagnostic.

## Byte stability

For visual block operations, source bytes outside the exact affected block-operation range remain unchanged.

| ID | Requirement |
|---|---|
| ART-EDIT-001 | Delete/move operations preserve Art-line ownership with the target list. |
| ART-EDIT-002 | Art cannot become an orphan that silently rebinds to a later list after block deletion. |
| ART-EDIT-003 | Unordered↔ordered source edits automatically change derived Peers↔Sequence semantics without changing any Art source syntax. |
| ART-EDIT-004 | Renderer-only Art DOM never becomes Markdown during round trip. |
| ART-EDIT-005 | Unaffected source outside the operation range is byte-stable. |

---

# 16. Authoring

Art belongs to Elef's metadata/directive namespace.

Mandatory palette entry:

```text
:art -> :::art
```

No:

```text
/art
:art-flow
:art-sequence
mode picker
layout picker
```

Applying `:art` to an existing list SHOULD insert the Art line at the canonical block-directive position without rewriting the list.

An optional visual `Art: Off | On` control is not part of the v1 completion gate.

| ID | Requirement |
|---|---|
| ART-AUTH-001 | `:art` is the only mandatory Art authoring command. |
| ART-AUTH-002 | Authoring Art never rewrites list markers/content merely to infer semantics. |

---

# 17. Accessibility and direction

- Peers retain unordered-list semantics.
- Sequence retains ordered-list semantics.
- Nested lists retain their native semantics.
- Prefer native `::marker` for Sequence numbering.
- If `list-style:none` is ever used, restore list semantics explicitly; do not use that path for Sequence unless numbering remains exposed accessibly.
- Connector lines are decorative.
- Art uses logical CSS properties for connector/card positioning.
- Art does not override `direction`.
- RTL content/order follows normal browser behavior.
- Art boundaries/ordering remain understandable in forced-colors mode even if purely decorative connector styling changes.

Document reflow acceptance:

```text
320 CSS px host
200% zoom-equivalent
400% zoom-equivalent
```

must preserve all content without Art-caused horizontal page scrolling.

| ID | Requirement |
|---|---|
| ART-A11Y-001 | Native root/nested list semantics remain exposed. |
| ART-A11Y-002 | Numbering is neither lost nor redundantly announced. |
| ART-A11Y-003 | Source/DOM/focus order remains identical. |
| ART-A11Y-004 | Connector/card CSS uses logical positioning and has an RTL regression test. |
| ART-A11Y-005 | Flowing/document Art passes 320px and 200%/400% reflow tests. |

---

# 18. Security

Existing renderer security remains authoritative:

- raw Markdown HTML remains disabled unless repository policy changes globally;
- existing link validation remains;
- Art does not add HTML interpolation of authored strings;
- diagnostic attributes contain enum codes only.

Static hostile forms must not generate executable markup or CSS.

| ID | Requirement |
|---|---|
| ART-SEC-001 | Art introduces no raw authored HTML path. |
| ART-SEC-002 | Malformed directive payloads cannot become class/style/data executable content. |
| ART-SEC-003 | Deep/pathological nesting cannot cause Art-specific unbounded recursion or stack failure. |

---

# 19. Canonical geometry and expected fixtures

Canonical presentation design space:

```text
slide = 1280 × 720
slide padding = 80px each side
full inner width ≈ 1120px
```

Canonical column test viewport MUST resolve the existing slide-region gap to 48px:

```text
two-column region ≈ 536px
three-column region ≈ 341px
```

Canonical document:

```text
frame width = 794px
page padding = 16mm each side
content width ≈ 673px ±2 layout px
```

Tests assert actual host dimensions before fixture assertions.

## FIX-01 — Document / rich Peers

```markdown
:::art
- **Speed**
  - Processes files locally
- **Transparency**
  - Everything remains Markdown
- **Portability**
  - Same source on web and desktop
- **Simplicity**
  - No proprietary document format
```

Expected:

```text
mode=peers
density=rich
layout=peers-wrap
status=ready
2 + 2 at canonical document width
```

## FIX-02 — Document / recursive mixed Peers

```markdown
:::art
- Research
  1. Interview users
  2. Review competitors
     - Enterprise
     - Consumer
- Design
  - Prototype
  - Validate
```

Expected:

```text
root Art items=2
mode=peers
nested ordered/unordered semantics preserved
status=ready or paginated by normal document flow
```

## FIX-03 — Full slide / 4 compact Sequence

```markdown
# Launch workflow

:::art
1. Discover
2. Design
3. Build
4. Launch
```

Expected in pinned Chromium/fonts:

```text
mode=sequence
density=compact
layout=sequence-horizontal
status=ready
containment oracle passes
```

## FIX-04 — Full slide / 4 rich Sequence

```markdown
# Implementation roadmap

:::art
1. Discovery
   - Interview users
   - Map the current process
2. Design
   - Prioritize constraints
   - Produce a prototype
3. Delivery
   - Build the system
   - Validate with teams
4. Adoption
   - Train users
   - Measure outcomes
```

Expected in pinned Chromium/fonts:

```text
mode=sequence
density=rich
layout=sequence-vertical
status=ready
containment oracle passes
```

This is a product acceptance target. If the initial Art-specific tokens fail it, tune only the single-source Art spacing/size tokens; do not add font-fitting or a new layout.

## FIX-05 — Full slide / 8 compact Sequence

```markdown
# Hiring pipeline

:::art
1. Role definition
2. Sourcing
3. Screening
4. Interviews
5. Offer
6. Onboarding
7. Ramp-up
8. Review
```

Expected in pinned Chromium/fonts:

```text
mode=sequence
density=compact
layout=sequence-vertical
status=fallback-no-fit
ART_NO_FIT present
all 8 items remain in DOM
```

This intentionally proves explicit v1 failure behavior for content beyond supported fixed-slide density.

## FIX-06 — Real inferred two-column slide

```markdown
# Research plan

## Goals

- Understand user needs
- Validate opportunities
- Build and test a solution

## Delivery

:::art
1. Scope
   - Interview users
   - Review landscape
2. Prototype
   - Wireframes
   - Validate flows
3. Test
   - Pilot with teams
4. Ship
   - Rollout and measure
```

Expected in pinned Chromium/fonts:

```text
repository layout=two-column
Art host≈536px
mode=sequence
density=rich
layout=sequence-vertical
status=ready
containment oracle passes
```

## FIX-07 — Real inferred three-column slide

```markdown
# Operating model

## Inputs

- Customer needs
- Market signals

## Decisions

- Prioritize
- Allocate

## Execution

:::art
1. Intake
2. Review
3. Approve
4. Execute
5. Audit
```

Expected in pinned Chromium/fonts:

```text
repository layout=three-column
Art host≈341px
mode=sequence
density=compact
layout=sequence-vertical
status=ready
containment oracle passes
```

## FIX-08 — Document / 7 compact Peers

```markdown
:::art
- Self-serve onboarding
- Workflow templates
- Reusable snippets
- Better search
- Presentation themes
- Review mode
- Offline-first desktop
```

Expected:

```text
mode=peers
density=compact
layout=peers-wrap
status=ready
partial final row centered
every normal-width card uses the same preferred basis
```

## FIX-09 — Ordered ranking

```markdown
:::art
1. Reliability
2. Simplicity
3. Performance
4. Portability
5. Transparency
6. Extensibility
```

Expected:

```text
mode=sequence
layout=sequence-vertical in document
native numbering
```

This is the accepted v1 tradeoff: ordered Art visually expresses source order even when content is a ranking rather than a process.

## FIX-10 — Unsupported inline image

```markdown
:::art
- Research
  - Review evidence
- Prototype
  ![mockup](images/mockup.png)
```

Expected:

```text
status=fallback-unsupported
layout=plain-list
ART_UNSUPPORTED_CONTENT
all Markdown content remains rendered
```

---

# 20. Pagination fixtures

Canonical pagination correctness does not rely on an ordinary fixture accidentally crossing an A4 page.

## PAG-FIX-01 — Forced Sequence split

Use a deterministic test harness/page constraint that forces a 6-item Sequence to split after exactly 2 items.

For root start 3:

```markdown
:::art
3. Alpha
4. Beta
5. Gamma
6. Delta
7. Epsilon
8. Zeta
```

Expected:

```text
fragment 1: start=3, two items
fragment 2: start=5, remaining items
```

## PAG-FIX-02 — Start zero

Force split after 2:

```markdown
:::art
0. Zero
1. One
2. Two
3. Three
```

Expected remainder:

```text
start=2
```

## PAG-FIX-03 — Oversized one-item Art

One root item exceeds an empty page.

Expected:

```text
no intra-item text split
page overflowing-content state
ART_ITEM_TOO_TALL
content retained
```

## PAG-FIX-04 — Repagination idempotence

Assert:

```text
merge(paginate(source-render)) -> repaginate
```

produces the same root item sequence, numbering, and fragment boundaries under unchanged geometry.

---

# 21. Binding corpus

Maintain a hand-authored, hand-labeled fixture corpus whose expected bindings are checked directly.

It must include:

- exact `:::art`;
- CRLF;
- trailing tabs/spaces;
- EOF immediately after Art;
- invalid `:::art{flow}`;
- invalid `:::art extra`;
- `:::artist`;
- Art in backtick fence;
- Art in tilde fence;
- Art in 4-backtick fence;
- Art in display-math fence;
- Art in blockquote;
- indented Art inside list content;
- ordered target using `1.`;
- ordered target using `1)`;
- ordered target starting `0`;
- ordered target starting `3`;
- Art before/after valid align/position directives;
- standalone `:::` barrier;
- two consecutive Art directives;
- paragraph barrier.

The corpus is the oracle. It is not generated from the implementation under test.

---

# 22. Generated and metamorphic testing

Use deterministic seeded/pairwise sampling capped at **400 generated cases per standard CI run**.

Axes include:

```text
root type: unordered / ordered
N: 1,2,3,4,5,6,8,12,20
lead lengths: short / medium / long / unbreakable
body: none / paragraph / nested ul / nested ol / mixed nesting
nesting: 0..4 in standard matrix
ordered delimiter: "." / ")" where parser supports
ordered start: 0 / 1 / >1
loose vs tight list
flowing widths: representative 220..800px
fixed widths: representative 220..1120px
fixed heights: representative 140..560px
theme: supported themes
typography: book / modern / technical
```

| ID | Requirement |
|---|---|
| ART-TEST-001 | Source root item count = semantic Art item count = rendered root item count. |
| ART-TEST-002 | Changing nested ordered↔unordered never changes root mode/item count. |
| ART-TEST-003 | Increasing nested depth never creates additional Art items. |
| ART-TEST-004 | Ready fixed Art passes the exact containment oracle. |
| ART-TEST-005 | Same same-engine inputs render the same mode/layout/status on repeated fresh renders after fonts settle. |
| ART-TEST-006 | Compact Sequence horizontal eligibility is monotonic as host width increases. |
| ART-TEST-007 | Pure eligibility function is tested at threshold−2px, threshold, threshold+2px independently of text/font layout. |
| ART-TEST-008 | Unsupported-content fallback preserves all rendered source content.

A separate pathological-depth test at/beyond the parser's configured nesting limit verifies no Art-specific crash.

---

# 23. Regression canaries

The suite MUST contain assertions that would fail for each specific broken implementation:

1. nested `<ol>` incorrectly becomes a Sequence Art node;
2. ordered continuation is off by one;
3. valid fenced `:::art` activates;
4. fixed controller always reports `ready`;
5. Peer layout stretches a lone final-row card;
6. Art font size uses `clamp()/vw/cqw/zoom` to fit;
7. lone oversized document Art item is text-split;
8. invalid `:::art{flow}` activates.

These are ordinary tests, not necessarily a mutation-testing framework.

---

# 24. Static CSS safety checks

Art CSS is linted/asserted so Art selectors do not use:

```text
line-clamp
text-overflow: ellipsis
visibility: hidden
display: none on authored content
overflow: hidden on authored text containers
font-size via vw/cqw/clamp
zoom
transform scale for fitting
```

Connector positioning uses logical properties rather than hard-coded left/right directionality.

---

# 25. Cross-engine and print verification

Pinned Chromium is the canonical pixel/geometry environment for FIX-01..10.

WebKit/Tauri parity MUST verify:

- source/semantic mode;
- item count/order;
- native list semantics;
- no content loss;
- horizontal eligibility decision from the same pure width formula;
- no-fit diagnosis when actual font metrics cannot satisfy containment.

Exact final `ready` vs `fallback-no-fit` may differ across engines only if loaded font metrics or actual host geometry differ; such divergence must still satisfy the same containment/status rules.

Print tests cover:

- document Peers;
- document Sequence fragments with numbering continuation;
- presentation settled horizontal Sequence;
- presentation no-fit state.

If WebKit/Tauri execution is unavailable, report those checks `BLOCKED_EXTERNAL`; do not fake verification.

---

# 26. Requirement traceability

Requirement IDs are category-based and MUST be globally unique.

Add a CI check that fails on duplicate normative IDs in this file.

Maintain a verification manifest mapping each normative ID to:

- one or more concrete test identifiers; or
- a named static architecture assertion when the requirement is not executable.

A requirement is not considered verified merely because its ID appears in a test title.

The final report distinguishes:

```text
VERIFIED
FAILED
BLOCKED_EXTERNAL
```

No `FAILED` or unacknowledged requirement may be reported complete.

---

# 27. Baseline and scope protection

Before feature changes:

1. run the entire existing repository test suite;
2. record branch/HEAD and existing failures;
3. grep for legacy/partial Art implementations or previous experimental syntax (`art{flow}`, snake, icons, chevrons, etc.);
4. produce the Phase 0 integration map;
5. preserve unrelated behavior.

Existing tests must not be deleted or weakened merely to land Art. If an existing assertion must intentionally change because Art changes public behavior, document that exact change.

---

# 28. Implementation phases

## Phase 0 — Audit

Verify current agent instructions/doctrine, architecture, source mapping, renderer, paginator, presentation canvas/CSS, directive handling, block operations, `:` palette, and parity harness.

Produce integration map and baseline test report.

## Phase 1 — Source resolution

Implement exact column-0 Art grammar, one-line exception, barriers/stacking, diagnostics, shared Art binding result, and the hand-labeled binding corpus.

## Phase 2 — Semantic renderer

Implement one shared Art semantic renderer consumed by document/presentation paths:

- root list parsing via existing `markdown-it`;
- Peers/Sequence derivation;
- recursive nested list preservation;
- density;
- unsupported-content classification;
- exact DOM state.

## Phase 3 — CSS + document pagination

Implement single-source tokens, Peer wrapping, vertical Sequence, native numbering, logical CSS connectors, Art-aware grouped pagination, ordered continuation, oversized-item behavior, and print.

## Phase 4 — Fixed presentation adaptation

Implement positioned fixed-host markers, pure horizontal eligibility, batched global lifecycle, containment oracle, hidden-host pending, no-fit diagnostics, and font/theme revalidation.

## Phase 5 — Authoring + ownership

Implement `:art` and block delete/move ownership using existing operation-range architecture.

Validate unordered↔ordered semantic derivation without source syntax changes.

## Phase 6 — Hardening

Run binding corpus, canonical fixtures, forced pagination fixtures, <=400 generated cases, pathological nesting, regression canaries, CSS safety checks, 100-root lifecycle budget, accessibility/reflow, print, and parity.

## Phase 7 — Documentation/final review

Document actual syntax, semantics, fallback, authoring, and limitations.

Review for second list parser, duplicate Art rendering paths, desktop-specific copies, explicit Art mode arguments, icons/chevrons/snake, source geometry, font fitting, hidden content, unbounded fit loops, and stale experimental Art code.

---

# 29. Completion gates

The feature is complete only when all non-blocked required checks pass.

### Source
- only exact column-0 `:::art`;
- no Art arguments;
- protected contexts do not activate;
- barriers/align/position rules exact;
- hand-labeled corpus green.

### Semantics
- root unordered = Peers;
- root ordered = Sequence;
- recursive nested lists preserved;
- root item count invariant;
- unsupported media/block fallback exact.

### Rendering
- shared Art renderer;
- native list semantics;
- exact DOM enums;
- no-JS defaults exact;
- no content hidden/truncated.

### Layout
- Peers use fixed preferred-basis wrapping;
- Sequence document/rich fixed = vertical;
- compact fixed Sequence uses pure width formula;
- no snake/font shrink;
- ready status passes whole-host containment.

### Pagination
- only root-item splits;
- no text split inside Art item;
- ordered starts including zero correct;
- oversized item explicit;
- repagination idempotent.

### Editing
- `:art`;
- delete/move ownership;
- orphan cannot jump;
- unordered↔ordered changes semantics automatically;
- unaffected source byte-stable.

### Quality
- FIX-01..10 explicit results;
- PAG-FIX-01..04;
- generated/metamorphic suite;
- regression canaries;
- CSS safety;
- performance budget;
- accessibility/reflow;
- print;
- parity or explicit blocked evidence;
- unique requirement IDs and complete verification manifest.

---

# 30. Final agent report

Must include:

## Implementation
Short description of source resolver, semantic renderer, CSS system, paginator integration, fixed controller, and authoring.

## Requirement status

```text
VERIFIED: ...
FAILED: ...
BLOCKED_EXTERNAL: ...
```

## Validation
Exact commands and outcomes.

## Canonical fixtures

| Fixture | Root type | Mode | Density | Layout | Status | Containment |
|---|---|---|---|---|---|---|

## Pagination fixtures
Fragment boundaries and `<ol start>` values.

## Architecture
Changed modules and why.

## Baseline/regressions
Full-suite before/after summary.

## Deferred

```text
explicit flow/process mode
icons
chevrons
snake
cycle
hierarchy/org chart
matrix/quadrant
Venn/radial
funnel/pyramid
image/media Art
table Art
arbitrary graph edges
manual geometry
AI layout/icon selection
PowerPoint SmartArt compatibility
```

## Blockers
Only genuine external blockers with evidence.

---

# 31. Decision record

| Decision | v1 choice | Rejected/deferred |
|---|---|---|
| Source syntax | exact column-0 `:::art` only | arguments / explicit modes |
| Root semantics | unordered→Peers, ordered→Sequence | keyword inference |
| Nested grammar | canonical recursive Markdown lists | nested Art nodes |
| Images/media | whole-block fallback | image Art in v1 |
| Documents | Peer wrap, Sequence vertical | document fit engine |
| Fixed Sequence | horizontal by pure width formula else vertical | snake |
| Peer geometry | centered non-growing preferred-basis wrap | auto-fit / JS column search |
| Fit | arithmetic + one fallback | iterative optimizer |
| Type | fixed Art tokens, never shrink-to-fit | dynamic font fitting |
| Sequence markers | native ordered semantics | editable badge DOM |
| Connectors | non-arrow logical CSS decoration | arrows/SVG layout engine |
| Tokens | CSS source of truth read by JS | duplicated JS constants |
| Invalid Art | deterministic diagnostic table | permissive fuzzy grammar |
| Oversized document item | atomic + explicit overflow diagnostic | intra-item text split |
| Authoring | `:art` only | `/art`, mode picker |
| Test oracle | labeled corpus + exact geometry + canaries | self-generated expectations |

---

# 32. Definition of done

Elef Art v1 is done when an author only needs:

```markdown
:::art
```

and ordinary Markdown supplies the rest:

```text
root unordered list -> Peers
root ordered list   -> Sequence
nested Markdown     -> recursively preserved item body
body presence       -> compact/rich density
actual host size    -> wrapping / horizontal / vertical geometry
```

The implementation must preserve source readability, recursive Markdown semantics, pagination, editing ownership, accessibility order, deterministic fixed-layout decisions, explicit failure states, and Rails/Tauri parity without introducing semantic mode syntax, icons, snake layouts, Mermaid coupling, source geometry, font fitting, or a general layout optimizer.
