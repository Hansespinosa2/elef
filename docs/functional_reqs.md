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

### 4.2 Presentation structure and contextual chrome

#### FR-039 - Define first-class presentation sections

- **Priority:** P0
- **Requirement:** Elef shall allow users to define named sections that contain one or more slides and shall treat those sections as part of the presentation's structure.
- **Rationale:** Sections are central to how the primary user organizes a story and navigates a substantial presentation.
- **Success criteria:** A user can create, rename, reorder, and navigate sections without manually encoding section membership on every slide.

#### FR-040 - Use heading hierarchy as a strong structural convention

- **Priority:** P0
- **Requirement:** Elef shall provide a strong default convention in which H1 identifies the presentation or title level, H2 identifies major sections, and H3 identifies subsections or recurring stages, while allowing a presentation to opt out of or customize that mapping.
- **Rationale:** A meaningful hierarchy helps authors structure a story and gives the system reliable context for navigation and recurring visual elements.
- **Success criteria:** A presentation using the convention receives useful structural behavior automatically, while an atypical presentation can explicitly choose a different mapping.

#### FR-041 - Provide automatic presentation context

- **Priority:** P0
- **Requirement:** Elef shall be able to display automatically updated contextual information such as the current section, subsection, slide number, and slide count in consistent presentation regions.
- **Rationale:** Recurring context reduces audience disorientation and eliminates repetitive manual header and footer work.
- **Success criteria:** As the user navigates slides, configured contextual information updates to represent the active section and presentation position.

#### FR-042 - Support reusable contextual elements

- **Priority:** P1
- **Requirement:** Elef shall allow users to define reusable presentation-wide elements, including section labels, project or topic markers, icons, and recurring stage indicators, and associate them with sections or other presentation structure.
- **Rationale:** Presentations often use a repeated visual grammar, such as a project icon and a CAR stage marker, that should be declared once and reused consistently.
- **Success criteria:** A user can define a contextual element once, associate it with relevant sections or states, and have it appear consistently without duplicating it on each slide.

### 4.3 Source authoring

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

### 4.4 Semantic components and layout

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

#### FR-043 - Provide constrained local visual adjustments

- **Priority:** P1
- **Requirement:** Elef shall allow users to make limited, semantic visual adjustments to an otherwise automatically rendered component or slide, including supported choices for emphasis, density, alignment, spacing, size tier, and component variant.
- **Rationale:** Automatic rendering should handle nearly all cases, but legitimate exceptions and small corrections will occur.
- **Success criteria:** A user can correct a small visual issue without abandoning semantic authoring or exposing arbitrary coordinate-level editing.

#### FR-044 - Preserve automatic design as the default

- **Priority:** P0
- **Requirement:** Elef shall make automatic layout and theme behavior the default path and shall not require local visual adjustments for ordinary, well-formed content.
- **Rationale:** The product's value depends on making the beautiful result automatic rather than recreating PowerPoint's formatting burden.
- **Success criteria:** Representative presentations achieve a polished result without manual per-slide or per-object tuning.

#### FR-045 - Support bounded visual effect presets

- **Priority:** P1
- **Requirement:** Elef shall provide bounded semantic presets for visual effects such as shadow, transparency, border, radius, and emphasis, with sensible component-specific defaults and limits.
- **Rationale:** Effects such as shadows and transparency are sometimes useful, but unrestricted controls would undermine consistency and accessibility.
- **Success criteria:** A user can apply or adjust a supported effect through a small set of understandable presets without entering arbitrary numeric styling values.

### 4.5 Themes and visual design

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

### 4.6 Media, equations, and content types

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

### 4.7 Presenting and interaction

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
- **Requirement:** Elef shall let a user pin the rendered output of a runnable presentation as a canonical version that does not automatically recompute or execute when opened or presented, while preserving provenance for the exact source, data, and assets behind that output.
- **Rationale:** Users need to preserve the exact result they intend to present without conflating runnable-output safety with editing history or fork relationships.
- **Success criteria:** A user can pin one rendered result, later present that same result without unexpected execution, and inspect which source, data, and assets produced it.

### 4.8 Validation and overflow

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

### 4.9 Executable and reproducible content

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

### 4.10 Export and sharing

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

### 4.11 AI assistance

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

### 4.12 Forking and presentation lineage

#### FR-046 - Create derived presentations with an explicit relationship

- **Priority:** P1
- **Requirement:** When a user creates a presentation from an existing presentation, Elef shall let the user choose whether it is a **Fork as continuation** or a **Fork as inspiration**, and shall record the resulting relationship in a presentation lineage graph.
- **Rationale:** The user needs both formal continuation for recurring work and looser inspiration for substantial reinterpretation, without losing the history of where a presentation came from.
- **Success criteria:** A derived presentation is visibly connected to its source with a solid or dotted relationship, while a presentation created from scratch is a new lineage root.

#### FR-047 - Preserve independent fork content

- **Priority:** P0
- **Requirement:** Both fork modes shall create an independent presentation that can be edited without changing the source presentation, while retaining the exact source snapshot from which it began.
- **Rationale:** Forking must support recurring presentations and experimentation without unsafe propagation or surprising edits to prior work.
- **Success criteria:** Changes to either presentation remain isolated, and the fork can identify the source presentation and source state used at creation.

#### FR-048 - Distinguish continuation and inspiration relationships

- **Priority:** P1
- **Requirement:** Elef shall represent **Fork as continuation** with a solid edge for formal continuation and **Fork as inspiration** with a dotted edge for independent derivation.
- **Rationale:** The graph should communicate whether a presentation continues a line of work or merely began from another presentation.
- **Success criteria:** Users can distinguish the two relationship meanings without opening either presentation's source.

#### FR-049 - Edit presentation lineage safely

- **Priority:** P1
- **Requirement:** Elef shall let users downgrade a solid relationship to dotted, chop or detach a dotted relationship, and rebase a derived presentation onto another presentation as a dotted relationship; it shall not promote a relationship back to solid.
- **Rationale:** A presentation's eventual purpose may diverge from its origin, but formal continuity should not be claimed retroactively.
- **Success criteria:** Lineage edits preserve the presentation content, update the graph visibly, and prevent a previously downgraded or dotted relationship from being relabeled as formal continuation.

#### FR-050 - Navigate presentation lineage

- **Priority:** P1
- **Requirement:** Elef shall provide a navigable directed lineage graph showing presentations derived from one another and the relationship type between them.
- **Rationale:** The graph helps users manage recurring presentations, understand progression, and find related work.
- **Success criteria:** A user can move from a presentation to its parents and descendants and understand whether each connection represents continuation or inspiration.

### 4.13 Fast authoring and cross-presentation reuse

#### FR-051 - Provide built-in and personal snippets

- **Priority:** P0
- **Requirement:** Elef shall provide useful built-in snippets and let users create, edit, organize, preview, and remove personal snippets for small source fragments such as LaTeX, presentation extension syntax, recurring text, and common authoring patterns.
- **Rationale:** Small reusable fragments make Markdown-first authoring fast without reintroducing whole-presentation templates.
- **Success criteria:** A user can manage a personal snippet library and use it across presentations without turning snippets into linked presentation content.

#### FR-052 - Open a fuzzy snippet palette from a canonical trigger

- **Priority:** P0
- **Requirement:** Typing `:` in the authoring context shall open a searchable, fuzzy-matching palette containing available snippets and allow the user to insert a selected result without leaving the editor.
- **Rationale:** A single memorable trigger reduces the friction of recalling DSL and LaTeX syntax.
- **Success criteria:** A user can type a partial term such as `:process` or `:beq`, find the intended snippet quickly, and insert it through keyboard interaction.

#### FR-053 - Complete snippets with Tab stops

- **Priority:** P0
- **Requirement:** Snippets shall support ordered editable placeholders, with the cursor entering the first placeholder after insertion and Tab moving through subsequent placeholders.
- **Rationale:** Inline completion preserves typing flow and is faster than reconstructing a component block manually.
- **Success criteria:** A user can accept a snippet, fill its fields in sequence, and finish without manually navigating between placeholder locations.

#### FR-054 - Support familiar customizable shortcuts

- **Priority:** P0
- **Requirement:** Elef shall provide familiar shortcuts for common authoring actions, including Cmd/Ctrl+B for bold, with sensible defaults that users can remap.
- **Rationale:** Keyboard-first editing is essential to the user's fast authoring workflow.
- **Success criteria:** A user can apply common formatting and authoring actions from the keyboard and change the shortcut for a common action without losing the default action.

#### FR-055 - Copy semantic visuals between presentations

- **Priority:** P1
- **Requirement:** Elef shall let users copy visual content from one presentation to another as independent editable semantic content, including the required referenced dependencies needed for the copied content to work in the destination.
- **Rationale:** Reusing a strong visual from an earlier presentation should be faster than rebuilding it while preserving Elef's structured, editable source.
- **Success criteria:** A copied visual remains editable in the destination, works without requiring the source presentation to remain available, and does not change when the source is later edited.

#### FR-056 - Offer an image paste alternative

- **Priority:** P1
- **Requirement:** When copying visual content between presentations, Elef shall offer paste as an image as an explicit alternative to editable semantic paste.
- **Rationale:** Users sometimes need exact appearance rather than editability, especially for complex or exceptional visuals.
- **Success criteria:** A user can choose an image result when preserving appearance is more important than preserving semantic editability.

#### FR-057 - Keep cross-presentation references deferred

- **Priority:** Deferred
- **Requirement:** Elef may later allow copied content to be intentionally converted into a reference to another presentation, but the initial product shall not create such references automatically.
- **Rationale:** Live references would introduce propagation, ownership, detach, and missing-source behavior that is not yet defined.
- **Success criteria:** Current copy and fork workflows remain independent and do not silently inherit later changes from another presentation.

### 4.14 Export state and preservation

#### FR-058 - Choose the export state

- **Priority:** P0
- **Requirement:** Elef shall export the latest valid rendered presentation by default and shall let users explicitly choose a pinned canonical result when exporting.
- **Rationale:** Ordinary exports should reflect current work while users retain control over stable delivery artifacts.
- **Success criteria:** A user can identify whether an export represents the latest valid render or a selected pinned result before creating it.

#### FR-059 - Handle stale exports explicitly

- **Priority:** P0
- **Requirement:** When the latest valid render is stale relative to editable source or runnable inputs, Elef shall warn the user and offer clear choices to export the prior valid result, render a new result, or pin and use the current result.
- **Rationale:** Export must not silently deliver content that differs from what the user believes they are exporting.
- **Success criteria:** A user cannot unknowingly export stale content and can intentionally choose the desired state.

#### FR-060 - Define format-specific export behavior

- **Priority:** P1
- **Requirement:** Elef shall provide PDF as a static presentation export, standalone HTML as an interactive export where supported, and PPTX as an export that balances visual fidelity with practical editability.
- **Rationale:** Each format supports a different subset of Elef's semantic, interactive, and animated behavior.
- **Success criteria:** Users understand the intended behavior of each export format and receive an output recognizable as the same presentation.

#### FR-061 - Materialize runnable content in delivery exports

- **Priority:** P0
- **Requirement:** PDF, HTML, PPTX, and image delivery exports shall use the selected valid rendered results of Python-backed, data-driven, and other runnable content rather than requiring execution in the exported artifact.
- **Rationale:** Delivery files should remain usable without the authoring environment or its computational dependencies.
- **Success criteria:** An exported presentation displays the selected computed results without unexpectedly executing or recomputing source content.

#### FR-062 - Export a self-contained presentation package

- **Priority:** P1
- **Requirement:** Elef shall provide a preservation-oriented export containing the presentation source, required assets, data, scripts, references, provenance, and selected pinned outputs needed to retain and reopen the presentation as a meaningful work unit.
- **Rationale:** A PDF, HTML, or PPTX delivery file is not a substitute for preserving the editable and reproducible presentation.
- **Success criteria:** A user can create a self-contained package, move it outside the current environment, and identify the source and supporting material associated with its preserved outputs.
