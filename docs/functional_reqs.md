# Elef Functional Requirements

## 1. Purpose

This document defines what Elef must enable users to do. It describes the full product vision in product terms, without prescribing programming languages, frameworks, data stores, hosting architecture, or other implementation choices.

Elef is an opinionated, programmable presentation system that helps technically fluent users move from ideas and source content to polished, consistent, reliable presentations with minimal manual layout work.

## 2. Scope and priority

Requirements use the following priority model:

- **P0:** Essential to Elef's identity and minimum useful product.
- **P1:** Important capability that materially strengthens the product but is not required for the core promise.
- **P2:** Valuable expansion that is not central to Elef's identity.
- **Deferred:** A meaningful future possibility whose product behavior is intentionally not specified yet.

“P0/P1/P2” expresses importance, not delivery schedule.

## 3. Product principles

1. **Thinking to slides:** Users should be able to capture and structure ideas as quickly as they can write or type them.
2. **Semantic over geometric:** Users describe meaning and intent rather than manually positioning shapes and arrows.
3. **Beautiful by default:** A small set of coherent defaults should produce attractive results without repeated styling decisions.
4. **Source remains legible:** The authored representation should be readable, reviewable, editable, and suitable for version control.
5. **Deterministic foundation:** The same source and inputs should produce the same presentation unless the user intentionally changes them.
6. **AI assists, not governs:** AI may help users work with the presentation, but the product remains useful and understandable without AI.

## 4. Requirements

### 4.1 Presentation creation and project organization

#### FR-001 - Create a presentation from a blank starting point

- **Priority:** P0
- **Requirement:** Elef shall let a user create a new presentation immediately without completing a naming or configuration ceremony.
- **Rationale:** The first interaction should support capturing an idea, not administration.
- **Success criteria:** A user can begin authoring a blank presentation in one direct action and can return to it later without losing the initial work.

#### FR-002 - Open and continue an existing presentation

- **Priority:** P0
- **Requirement:** Elef shall let a user open an existing presentation and continue authoring it with its source, visual appearance, assets, and presentation settings intact.
- **Rationale:** Presentations are ongoing bodies of work rather than disposable exports.
- **Success criteria:** Reopening a presentation restores the same authored content and meaningful presentation state.

#### FR-003 - Organize presentation-related material together

- **Priority:** P1
- **Requirement:** Elef shall support a presentation being associated with its source, media, data, scripts, references, and other supporting material as one understandable work unit.
- **Rationale:** Users should not need to reconstruct which files produced a presentation.
- **Success criteria:** A user can identify the material associated with a presentation and understand how it contributes to the result.

#### FR-004 - Recover interrupted work

- **Priority:** P0
- **Requirement:** Elef shall preserve recoverable user work when the application, presentation, or persistence operation is interrupted.
- **Rationale:** Losing fast, unrepeatable thinking destroys trust in the product.
- **Success criteria:** An interruption does not silently discard the latest recoverable edits, and the user receives a clear path to continue or recover them.

### 4.2 Source authoring

#### FR-005 - Author presentations with Markdown

- **Priority:** P0
- **Requirement:** Elef shall allow users to author presentation content using familiar Markdown conventions for headings, paragraphs, lists, quotes, code, links, and images.
- **Rationale:** Markdown is fast to write, readable outside the application, and well suited to source-controlled work.
- **Success criteria:** A user familiar with Markdown can create ordinary slide content without learning a proprietary syntax.

#### FR-006 - Use a readable presentation extension language

- **Priority:** P0
- **Requirement:** Elef shall provide a compact, readable presentation-specific language for capabilities that ordinary Markdown cannot express, while preserving ordinary Markdown as the default authoring experience.
- **Rationale:** Semantic presentation structures need expressive input, but a sprawling DSL would recreate the friction of manual slide authoring.
- **Success criteria:** Presentation extensions can be read and edited as source, avoid coordinate-level geometry, and remain understandable without inspecting generated layout data.

#### FR-007 - Preserve source readability

- **Priority:** P0
- **Requirement:** Elef shall preserve authored source order, meaningful text, and semantic intent when rendering or editing a presentation.
- **Rationale:** The source is a durable artifact for review, reuse, automation, and assistance.
- **Success criteria:** A user can inspect source and understand the presentation without reverse-engineering opaque generated objects.

#### FR-008 - Provide live source-to-presentation feedback

- **Priority:** P0
- **Requirement:** Elef shall update the visual presentation as the user authors or edits source, without requiring a separate manual rendering step for ordinary changes.
- **Rationale:** Immediate feedback is central to a fast thinking-to-slides workflow.
- **Success criteria:** A user can type, see the result, and iterate without leaving the authoring context or invoking a manual build command.

#### FR-009 - Give clear feedback for invalid source

- **Priority:** P0
- **Requirement:** Elef shall identify source errors or unsupported content clearly while preserving the user's editable source and any unaffected presentation content.
- **Rationale:** Errors must be recoverable and must never look like successful output.
- **Success criteria:** An invalid edit produces an actionable explanation and does not silently replace the document with stale or empty content.

### 4.3 Semantic components and layout

#### FR-010 - Render semantic presentation components

- **Priority:** P0
- **Requirement:** Elef shall support semantic components for common presentation structures, including process, comparison, timeline, hierarchy, matrix, cycle, funnel, cards, columns, and related structures.
- **Rationale:** Users think in concepts and relationships, while manual shape placement is slow and fragile.
- **Success criteria:** A user can express a supported structure semantically and receive a coherent visual arrangement without specifying individual coordinates.

#### FR-011 - Automatically lay out semantic components

- **Priority:** P0
- **Requirement:** Elef shall determine appropriate geometry, spacing, alignment, and relationship visualization for supported semantic components.
- **Rationale:** Automatic layout is the primary mechanism for eliminating repetitive SmartArt and shape work.
- **Success criteria:** Equivalent semantic input produces a balanced, consistent arrangement that adapts when labels or item counts change.

#### FR-012 - Support nested components

- **Priority:** P1
- **Requirement:** Elef shall allow supported components to contain other components where the combination has a meaningful presentation interpretation.
- **Rationale:** Real presentations combine text, equations, figures, and structures within larger conceptual units.
- **Success criteria:** A user can compose a meaningful nested structure without falling back to arbitrary shape coordinates.

#### FR-013 - Create or configure extensions through the user experience

- **Priority:** P1
- **Requirement:** Elef shall provide a guided way for advanced users to create, configure, or extend semantic components without requiring every extension to be authored manually from scratch.
- **Rationale:** Extensibility should increase the system's usefulness without making the core experience dependent on hand-written DSL expertise.
- **Success criteria:** An advanced user can define a reusable extension through an understandable workflow and use it as a normal component thereafter.

#### FR-014 - Adapt layouts to content

- **Priority:** P0
- **Requirement:** Elef shall adapt supported layouts to changes in text length, item count, media dimensions, and component content while preserving the component's semantic structure.
- **Rationale:** Users should be able to change ideas without repairing every dependent object by hand.
- **Success criteria:** Common content changes reflow the relevant structure without overlapping, clipping, or requiring manual repositioning.

### 4.4 Themes and visual design

#### FR-015 - Apply Oradia as the default design system

- **Priority:** P0
- **Requirement:** Elef shall apply the Oradia theme as the default visual system for new presentations and presentation elements.
- **Rationale:** The product should produce a recognizable, coherent result without repeating theme setup.
- **Success criteria:** New content uses consistent Oradia typography, color, spacing, hierarchy, and component styling automatically.

#### FR-016 - Use curated visual choices by default

- **Priority:** P0
- **Requirement:** Elef shall present a small, coherent set of default visual choices rather than requiring users to select from an exhaustive catalog for ordinary authoring.
- **Rationale:** Choice overload slows the user's thinking-to-slides workflow and undermines consistency.
- **Success criteria:** A user can create a polished presentation without choosing fonts, colors, or detailed styling for every element.

#### FR-017 - Support advanced theme extensibility

- **Priority:** P1
- **Requirement:** Elef shall allow advanced users to extend or override the default visual system while preserving semantic roles and consistent behavior.
- **Rationale:** The product should support personal and organizational identity without becoming a free-form formatting tool.
- **Success criteria:** An advanced customization can be reused across presentations and does not require restyling every individual element.

#### FR-018 - Keep presentation appearance consistent

- **Priority:** P0
- **Requirement:** Elef shall apply the same theme, typography rules, component conventions, and visual hierarchy consistently across a presentation unless the user intentionally overrides them.
- **Rationale:** Consistency is a core quality of a polished presentation and a major weakness of ad hoc slide editing.
- **Success criteria:** Adding or changing content does not unexpectedly revert to unrelated defaults or introduce inconsistent styling.

### 4.5 Media, equations, and content types

#### FR-019 - Insert media by direct manipulation

- **Priority:** P0
- **Requirement:** Elef shall let users add common media, including PNG and other image files, through an easy drag-and-drop or equivalent direct insertion workflow.
- **Rationale:** Small visual assets and external images are common in real presentation work and should not require file-management friction.
- **Success criteria:** A user can add an image to a presentation directly and see it rendered in a sensible layout.

#### FR-020 - Render equations with LaTeX

- **Priority:** P0
- **Requirement:** Elef shall allow users to author mathematical notation using LaTeX and render it as polished presentation content.
- **Rationale:** Equations must remain expressive, legible, and faithful to the author's intent.
- **Success criteria:** Common equations render clearly, remain associated with their source, and participate in layout without manual image preparation.

#### FR-021 - Support common presentation content

- **Priority:** P0
- **Requirement:** Elef shall render text, lists, images, equations, code, figures, tables, and diagrams using the same coherent presentation model.
- **Rationale:** Users need to combine explanatory and technical material without switching authoring systems.
- **Success criteria:** These content types can coexist on slides and inherit the presentation's theme and layout rules.

### 4.6 Presenting and interaction

#### FR-022 - Provide a dedicated Present mode

- **Priority:** P0
- **Requirement:** Elef shall provide a dedicated presentation mode optimized for delivering a deck to an audience.
- **Rationale:** The presentation view is the highest-priority delivery experience.
- **Success criteria:** A user can enter Present mode directly, navigate through the deck predictably, and present without editor chrome or distracting controls.

#### FR-023 - Preserve presentation stability

- **Priority:** P0
- **Requirement:** Present mode shall use a stable, intentional version of the presentation and shall not unexpectedly change because source inputs are edited or recomputed during presentation.
- **Rationale:** A presentation must not change underneath the presenter.
- **Success criteria:** The user can enter Present mode with confidence that the displayed deck remains stable for the duration of the presentation.

#### FR-024 - Support practical declarative transitions

- **Priority:** P0
- **Requirement:** Elef shall support simple declarative state transitions including appear, disappear, and highlight.
- **Rationale:** These transitions communicate sequence without the burden and distraction of elaborate animation systems.
- **Success criteria:** A user can define a small number of presentation states and move between them predictably.

#### FR-025 - Support richer transitions as an extension

- **Priority:** P2
- **Requirement:** Elef should support morph, move, and other restrained transitions when they preserve authoring simplicity and visual consistency.
- **Rationale:** Some users will benefit from richer transitions, but they are not central to Elef's identity.
- **Success criteria:** Additional transitions remain optional, quick to understand, and subordinate to the content.

#### FR-026 - Pin a canonical presentation version

- **Priority:** P1
- **Requirement:** Elef shall let a user pin a presentation as a canonical version for presenting, sharing, or reference.
- **Rationale:** Users need a simple safeguard against unexpected changes before an important presentation.
- **Success criteria:** A user can pin a version with one clear action and later identify and present that canonical version.

### 4.7 Validation and overflow

#### FR-027 - Detect content overflow

- **Priority:** P1
- **Requirement:** Elef shall detect when slide content exceeds or threatens the usable presentation area.
- **Rationale:** Silent clipping and crowded slides undermine trust and visual quality.
- **Success criteria:** The user receives a clear indication of overflow or unsafe density before presenting or exporting.

#### FR-028 - Explain and help resolve overflow

- **Priority:** P1
- **Requirement:** Elef shall identify the content contributing to overflow and offer understandable ways to resolve it, including reflow, reduction, or splitting content.
- **Rationale:** Detection is useful only when it helps the user make a better presentation.
- **Success criteria:** A user can understand why a slide is overloaded and choose a corrective action without manually inspecting hidden geometry.

### 4.8 Executable and reproducible content

#### FR-029 - Associate derived content with its inputs

- **Priority:** P1
- **Requirement:** Elef shall allow data-driven figures, tables, and other derived content to remain associated with the source inputs and transformations that produce them.
- **Rationale:** Users should be able to trust and explain where presentation numbers came from.
- **Success criteria:** A user can inspect the origin of a derived result without reconstructing a chain of screenshots and manually exported files.

#### FR-030 - Support Python-backed analysis

- **Priority:** P1
- **Requirement:** Elef shall support Python-backed analysis or computation as a first-class way to produce presentation content.
- **Rationale:** Python is valuable for research, analysis, and reusable computation, even though it is not the majority authoring workflow.
- **Success criteria:** A user can use Python-derived results in a presentation while retaining a comprehensible relationship between analysis and displayed content.

#### FR-031 - Recompute dependent content intentionally

- **Priority:** P1
- **Requirement:** Elef shall identify and update presentation content that depends on changed data or computation, while making the update understandable to the user.
- **Rationale:** Reproducibility requires dependency awareness, but unexpected changes must not undermine presentation stability.
- **Success criteria:** A changed input can update dependent content in authoring mode, and the user can see what changed before relying on it.

### 4.9 Export and sharing

#### FR-032 - Export faithful presentation artifacts

- **Priority:** P1
- **Requirement:** Elef shall export presentations to PDF, PPTX, HTML, and images while preserving intended content, visual hierarchy, theme, and slide order as far as each format permits.
- **Rationale:** Users need to deliver work beyond the application.
- **Success criteria:** Exported artifacts are recognizable as the same presentation and do not contain unexplained clipping, missing content, or inconsistent styling.

#### FR-033 - Preserve the native source relationship

- **Priority:** P1
- **Requirement:** Elef shall keep exported artifacts associated with the source presentation so users can identify the origin and regenerate or revise them.
- **Rationale:** Exports should not become disconnected screenshots with unknown provenance.
- **Success criteria:** A user can identify which presentation produced an export and return to its source.

#### FR-034 - Support simple sharing

- **Priority:** P2
- **Requirement:** Elef should let users share a presentation or a canonical version through an understandable, permission-aware workflow.
- **Rationale:** Sharing increases the usefulness of finished presentations without defining collaboration as core.
- **Success criteria:** A user can share a selected presentation state and recipients can access the intended content.

#### FR-035 - Support collaboration

- **Priority:** P2
- **Requirement:** Elef should support collaborative access and contribution to presentations while preserving authorship, source clarity, and presentation consistency.
- **Rationale:** Collaboration is valuable but is not central to Elef's identity.
- **Success criteria:** Multiple authorized users can work with a presentation without silently losing changes or obscuring what content is authoritative.

### 4.10 AI assistance

#### FR-036 - Operate fully without AI

- **Priority:** P0
- **Requirement:** Elef shall provide its core authoring, rendering, validation, and presenting experience without requiring AI services or AI-generated content.
- **Rationale:** Deterministic behavior and user understanding are foundational.
- **Success criteria:** A user can create, revise, render, present, and export a presentation without enabling or consulting AI.

#### FR-037 - Assist with structured presentation work

- **Priority:** P1
- **Requirement:** Elef shall allow optional AI assistance to author, edit, transform, explain, or reorganize Markdown and semantic presentation content while keeping the resulting source visible and user-controlled.
- **Rationale:** AI is most useful when it operates on an understandable structured document rather than an opaque slide file.
- **Success criteria:** AI-generated changes can be inspected, accepted, rejected, and revised as ordinary presentation source.

#### FR-038 - Use deterministic feedback to guide AI assistance

- **Priority:** P1
- **Requirement:** Elef should use observable presentation information, such as structure, density, overflow, and consistency findings, to guide AI suggestions rather than delegating layout truth to AI.
- **Rationale:** AI should recommend useful changes based on the actual rendered document.
- **Success criteria:** Suggestions refer to identifiable presentation conditions and do not claim that content fits or renders correctly without product validation.

