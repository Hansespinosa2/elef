# Elef Non-Functional Requirements

## 1. Purpose

This document defines the qualities Elef must provide while delivering its functional capabilities. It describes user-visible quality expectations and product constraints without prescribing implementation technologies or architecture.

## 2. Scope and priority

- **P0:** Essential to Elef's identity and minimum useful product.
- **P1:** Important quality that materially strengthens the product.
- **P2:** Valuable quality or scale characteristic that is not central to the first product promise.
- **Deferred:** A meaningful future quality decision whose target is intentionally not specified yet.

P0/P1/P2 express importance, not delivery schedule.

## 3. Quality principles

1. Elef should feel faster than manual slide formatting.
2. Visual quality should come from coherent rules rather than repeated user decisions.
3. Rendering should be predictable, inspectable, and repeatable.
4. User work should be safe even when the environment or inputs are imperfect.
5. Advanced power should not make ordinary authoring harder.
6. Privacy and control should be understandable to the user.

## 4. Requirements

### 4.1 Visual quality and consistency

#### NFR-001 - Maintain visual coherence

- **Priority:** P0
- **Requirement:** Elef shall produce presentations with consistent typography, spacing, alignment, color roles, hierarchy, and component styling under the default design system.
- **Rationale:** Visual consistency and polish are core product value, not optional decoration.
- **Verification criteria:** Representative presentations with different content types remain recognizably part of one coherent design system without per-element restyling.

#### NFR-002 - Make attractive output the default

- **Priority:** P0
- **Requirement:** Elef shall provide a polished result for ordinary authored content without requiring users to tune detailed visual properties.
- **Rationale:** The product exists partly to remove the repetitive design work that makes PowerPoint slow.
- **Verification criteria:** A user can create a presentable deck using default settings and a small number of semantic choices.

#### NFR-003 - Avoid accidental style drift

- **Priority:** P0
- **Requirement:** Adding, moving, or changing content shall not unexpectedly introduce unrelated fonts, colors, spacing conventions, or component styles.
- **Rationale:** Style drift makes presentations look improvised and erodes trust in the defaults.
- **Verification criteria:** Equivalent content inserted in different parts of a presentation receives equivalent styling unless an intentional override applies.

#### NFR-004 - Preserve hierarchy and readability

- **Priority:** P0
- **Requirement:** Elef shall preserve a clear visual hierarchy between titles, supporting text, emphasis, structure, data, and decoration.
- **Rationale:** A simple slide should be easy to understand at presentation distance.
- **Verification criteria:** Reviewers can identify the primary message and supporting content on representative slides without relying on source inspection.

#### NFR-031 - Make shared presentation context visually consistent

- **Priority:** P0
- **Requirement:** Automatically generated section labels, slide counts, headers, footers, icons, and stage markers shall follow the presentation's visual system and shall not compete with the primary slide message.
- **Rationale:** Recurring contextual chrome should orient the audience without becoming a second, inconsistent layout system.
- **Verification criteria:** Shared elements remain aligned, legible, subordinate, and visually consistent across sections with different content.

#### NFR-032 - Keep visual customization bounded

- **Priority:** P1
- **Requirement:** Local visual adjustments and effects shall use constrained semantic values or presets that preserve theme coherence, readability, and predictable layout behavior.
- **Rationale:** The product should support the exceptional one percent of visual cases without returning to unrestricted slide formatting.
- **Verification criteria:** A local adjustment can improve a specific slide without causing style drift, inaccessible contrast, unexpected overlap, or unrelated changes elsewhere.

#### NFR-033 - Prefer component defaults over manual styling

- **Priority:** P0
- **Requirement:** Components shall define sensible defaults for shadows, transparency, borders, radii, emphasis, and related effects, and ordinary users shall not need to configure these properties.
- **Rationale:** Most users should receive a polished result without repeatedly choosing visual details.
- **Verification criteria:** New components look intentional and consistent before any local effect adjustment is made.

### 4.2 Determinism and repeatability

#### NFR-005 - Render repeatably

- **Priority:** P0
- **Requirement:** Given the same source, theme, inputs, and presentation state, Elef shall produce equivalent rendered content and layout across repeated renders.
- **Rationale:** Determinism is the foundation for trust, review, versioning, and AI guidance.
- **Verification criteria:** Repeated rendering of unchanged inputs produces no unexplained content, ordering, styling, or geometry changes.

#### NFR-006 - Make changes attributable

- **Priority:** P0
- **Requirement:** A visible presentation change shall be attributable to a user change, an intentional input change, a selected theme/state change, or an explicitly identified system update.
- **Rationale:** Users should not have to guess why a deck changed.
- **Verification criteria:** When displayed output changes, the user can identify the relevant source, input, or presentation-state cause.

#### NFR-007 - Keep presentation states stable

- **Priority:** P0
- **Requirement:** A presentation state selected for Present mode shall remain stable during presentation unless the presenter intentionally changes it.
- **Rationale:** Stability is essential for live delivery.
- **Verification criteria:** Background edits, recomputation, or unrelated navigation cannot silently alter the active presented state.

#### NFR-008 - Make canonical versions dependable

- **Priority:** P1
- **Requirement:** A pinned runnable output shall remain identifiable and reproducible as the rendered result the user selected, shall not change through automatic recomputation or execution, and shall retain provenance for its source, data, and assets, subject to clearly disclosed unavailable inputs.
- **Rationale:** Pinning protects the output shown to an audience and is separate from editing history or presentation lineage.
- **Verification criteria:** A user can later distinguish the pinned output from current editable work, present the intended result without unexpected execution, and inspect its provenance.

### 4.3 Responsiveness and interaction quality

#### NFR-009 - Keep ordinary authoring responsive

- **Priority:** P0
- **Requirement:** Ordinary typing, editing, navigation, selection, and preview updates shall feel immediate enough to preserve the user's train of thought.
- **Rationale:** The primary user writes and iterates quickly; visible lag directly defeats the core promise.
- **Verification criteria:** Typical Markdown edits update the relevant visual result without forcing the user to wait or stop typing.

#### NFR-010 - Avoid blocking authoring

- **Priority:** P0
- **Requirement:** Rendering, persistence, validation, asset handling, and other background work shall not unnecessarily block ordinary authoring or navigation.
- **Rationale:** The user should not trade the speed of typing for the safety of the system.
- **Verification criteria:** Long-running or failure-prone work communicates its state while the user can continue safe, recoverable editing where appropriate.

#### NFR-011 - Make interaction feedback clear

- **Priority:** P0
- **Requirement:** User actions shall produce timely, understandable feedback for success, pending work, failure, and recovery.
- **Rationale:** Silent operations and ambiguous state are especially damaging in an editor.
- **Verification criteria:** Users can tell whether a change was applied, saved, rendered, rejected, or is awaiting action.

### 4.4 Reliability and data safety

#### NFR-012 - Prevent silent loss of work

- **Priority:** P0
- **Requirement:** Elef shall not silently discard authored source, accepted changes, inserted media, or a selected canonical presentation version.
- **Rationale:** Reliability and no lost work are non-negotiable for a tool used to capture fast, unique thinking.
- **Verification criteria:** Failures leave the user's work recoverable and explain what action is needed.

#### NFR-013 - Make persistence recoverable

- **Priority:** P0
- **Requirement:** Persistence failures, unavailable inputs, and interrupted operations shall result in a recoverable state with clear user guidance.
- **Rationale:** A failure should not force users to choose between losing work and continuing blindly.
- **Verification criteria:** The user can continue, retry, save elsewhere, or recover the affected work through explicit actions.

#### NFR-014 - Isolate failures

- **Priority:** P0
- **Requirement:** A failure in one asset, component, computation, export, or presentation should not unnecessarily corrupt or hide unrelated content.
- **Rationale:** Complex presentations contain many independent sources of failure.
- **Verification criteria:** Unaffected slides and source remain available and understandable when one part fails.

#### NFR-015 - Preserve source and presentation alignment

- **Priority:** P0
- **Requirement:** Elef shall keep the editable source, rendered presentation, selected presentation state, and associated metadata aligned or clearly identify when they are not aligned.
- **Rationale:** The product's central promise depends on users being able to trust the relationship between what they edit and what they present.
- **Verification criteria:** The user can identify whether the visible deck represents the latest source, a pinned version, or a previous valid render.

### 4.5 Accessibility and readability

#### NFR-016 - Support presentation-distance readability

- **Priority:** P0
- **Requirement:** Default typography, contrast, spacing, and component sizing shall support reading and comprehension at a reasonable presentation distance.
- **Rationale:** A technically correct slide is not successful if an audience cannot read it.
- **Verification criteria:** Representative slides remain legible in Present mode under common display conditions.

#### NFR-017 - Provide accessible interaction paths

- **Priority:** P1
- **Requirement:** Core authoring, navigation, presenting, error recovery, and export workflows shall be usable through accessible interaction patterns and assistive technologies where applicable.
- **Rationale:** Accessibility expands who can use Elef and improves clarity for everyone.
- **Verification criteria:** Core workflows do not depend solely on color, pointer precision, or inaccessible controls.

#### NFR-018 - Communicate meaning beyond color

- **Priority:** P1
- **Requirement:** Status, errors, emphasis, and semantic relationships shall not be communicated through color alone.
- **Rationale:** Meaning must remain available to users with differing vision or display conditions.
- **Verification criteria:** Important state and relationships remain understandable in monochrome, reduced-contrast, or assistive presentation conditions.

### 4.6 Privacy and user control

#### NFR-019 - Make data ownership understandable

- **Priority:** P0
- **Requirement:** Elef shall make it understandable to the user where presentation source, assets, derived results, pinned versions, and shared copies reside and who can access them.
- **Rationale:** The long-term product may support both personal/local and cloud use, so control cannot be implicit.
- **Verification criteria:** A user can determine the ownership and access context of a presentation without reading technical documentation.

#### NFR-020 - Require meaningful consent for external processing

- **Priority:** P0
- **Requirement:** Elef shall not send presentation content, private data, or source material to external services without an understandable user choice or an explicitly configured product policy.
- **Rationale:** Optional AI and future cloud capabilities must not undermine privacy or user control.
- **Verification criteria:** Users can tell when content leaves their current environment and can use core functionality without undisclosed external processing.

#### NFR-021 - Make sharing boundaries explicit

- **Priority:** P1
- **Requirement:** Sharing and collaboration workflows shall clearly communicate what presentation state and supporting material are being shared and with whom.
- **Rationale:** A presentation may contain private analysis, data, or draft material that should not travel with the visible slides unintentionally.
- **Verification criteria:** A user can review the scope and audience of a share action before it takes effect.

### 4.7 Extensibility and consistency

#### NFR-022 - Preserve core conventions under extension

- **Priority:** P0
- **Requirement:** Custom components, themes, and advanced extensions shall preserve Elef's core concepts of semantic authoring, readable source, coherent styling, and predictable rendering.
- **Rationale:** Extensibility must not turn the product into an inconsistent collection of one-off behaviors.
- **Verification criteria:** An extension can participate in normal authoring and presenting workflows without bypassing core validation or theme conventions.

#### NFR-023 - Make extensions understandable

- **Priority:** P1
- **Requirement:** Users shall be able to understand the purpose, inputs, visual effect, and limitations of an extension without inspecting implementation details.
- **Rationale:** Advanced power is useful only when it remains approachable and maintainable.
- **Verification criteria:** An extension presents enough descriptive information for a user to choose and use it confidently.

#### NFR-024 - Prevent extension failures from destabilizing the product

- **Priority:** P1
- **Requirement:** A malformed or incompatible extension shall fail visibly and locally rather than silently corrupting unrelated presentations or the core authoring experience.
- **Rationale:** Extensibility increases the range of possible failure and needs guardrails.
- **Verification criteria:** The user receives an actionable failure and unaffected content remains usable.

### 4.8 Portability and interoperability

#### NFR-025 - Keep presentation source durable

- **Priority:** P1
- **Requirement:** Presentation source shall remain understandable and usable across supported personal and hosted environments without depending on a single opaque rendered artifact.
- **Rationale:** The product vision includes both personal/local and cloud use, and the source is the durable creative asset.
- **Verification criteria:** A user can move or reopen a presentation in another supported environment and retain its meaningful source and structure.

#### NFR-026 - Preserve export fidelity

- **Priority:** P1
- **Requirement:** PDF, PPTX, HTML, and image outputs shall preserve intended content, ordering, hierarchy, and visual identity as consistently as the target format allows.
- **Rationale:** Exported work represents the user and must not undermine confidence in the source presentation.
- **Verification criteria:** Export review finds no unexplained missing content, severe layout drift, or theme inconsistency.

#### NFR-027 - Make format limitations explicit

- **Priority:** P1
- **Requirement:** When a target format cannot preserve an interactive, semantic, animated, or otherwise richer presentation behavior, Elef shall communicate the limitation clearly.
- **Rationale:** Users need to know what will change when moving between presentation formats.
- **Verification criteria:** Export results do not imply unsupported behavior was preserved when it was not.

### 4.9 Diagnostics and user trust

#### NFR-028 - Explain system state in product language

- **Priority:** P0
- **Requirement:** Errors, warnings, validation findings, version state, and processing status shall be expressed in terms users can act on, not only internal failure terminology.
- **Rationale:** Clear explanations are necessary for a deterministic, trustworthy workflow.
- **Verification criteria:** A user can understand what happened, what is affected, and what action is available.

#### NFR-029 - Distinguish draft, current, and canonical states

- **Priority:** P0
- **Requirement:** Elef shall clearly distinguish editable draft content, the latest valid rendered content, and a pinned canonical presentation version.
- **Rationale:** These states have different safety implications before presenting or sharing.
- **Verification criteria:** Users can identify which state they are viewing, editing, presenting, or exporting.

#### NFR-030 - Avoid opaque automation

- **Priority:** P0
- **Requirement:** Automated layout, validation, recomputation, AI assistance, and synchronization shall not make unexplained changes that appear to be ordinary user-authored content.
- **Rationale:** Users must remain able to understand and control the presentation.
- **Verification criteria:** Automated changes are visible, attributable, reversible where appropriate, and distinguishable from direct authoring.

#### NFR-034 - Keep lineage relationships understandable

- **Priority:** P1
- **Requirement:** Presentation lineage shall clearly distinguish formal continuation, independent inspiration, detached presentations, and rebased relationships without implying that independent presentations share live content.
- **Rationale:** A lineage graph is useful only if its visual relationships communicate trustworthy meaning.
- **Verification criteria:** Users can explain what a solid or dotted edge means and can identify when a presentation no longer has an active parent.

#### NFR-035 - Preserve fork and copy isolation

- **Priority:** P0
- **Requirement:** Forked and copied presentation content shall remain isolated from later edits to the source unless an explicitly defined future reference capability is used.
- **Rationale:** Unexpected propagation would undermine trust in recurring presentations, reusable visuals, and canonical outputs.
- **Verification criteria:** Editing a source presentation does not alter a fork or copied visual that was created as independent content.

#### NFR-036 - Keep fast authoring interactions responsive

- **Priority:** P0
- **Requirement:** Common keyboard shortcuts, the `:` snippet palette, fuzzy search, snippet insertion, and Tab-stop navigation shall respond quickly enough to preserve continuous authoring flow.
- **Rationale:** Snippets and keybinds exist to remove pauses and syntax-recall friction, not introduce a new interaction delay.
- **Verification criteria:** A user can invoke, search, accept, and complete a typical snippet without losing their editing context or waiting through avoidable transitions.

#### NFR-037 - Keep copied semantic content portable

- **Priority:** P1
- **Requirement:** Editable content copied between presentations shall retain its semantic meaning and required dependencies without creating unexplained broken references or accidental source ownership.
- **Rationale:** Cross-presentation reuse must be dependable even when the original presentation is unavailable or later changes.
- **Verification criteria:** A copied visual renders coherently in the destination, identifies any unsupported dependency clearly, and remains independent of the source.

#### NFR-038 - Make export state trustworthy

- **Priority:** P0
- **Requirement:** Export workflows shall clearly identify whether they use the latest valid render or a pinned canonical result and shall not silently export a stale result without user awareness.
- **Rationale:** Users need to trust that a delivered file represents the state they intentionally selected.
- **Verification criteria:** A user can distinguish current, stale, and pinned export states before and after an export.

#### NFR-039 - Preserve export intent across formats

- **Priority:** P1
- **Requirement:** Export behavior shall preserve the presentation's intended content and supported state transitions consistently, while clearly identifying behavior that was flattened, approximated, or made non-editable by the target format.
- **Rationale:** Format differences should not become unexplained discrepancies between the authored presentation and delivered artifacts.
- **Verification criteria:** Reviewers can determine what was preserved, transformed, or omitted in PDF, HTML, PPTX, and image outputs.

#### NFR-040 - Keep preservation packages self-contained and understandable

- **Priority:** P1
- **Requirement:** A preservation-oriented presentation package shall retain the relationships among source, supporting inputs, derived results, pinned outputs, and provenance well enough for a user to understand and reopen the preserved work without relying on undocumented external context.
- **Rationale:** Long-term preservation requires more than retaining one rendered file.
- **Verification criteria:** A user can inspect a package, locate its meaningful source and supporting material, and identify unavailable or incomplete dependencies explicitly.

### 4.10 Deferred quality decisions

The following quality targets require later product decisions and should not be invented in this document:

- Exact performance thresholds for every document size and content type.
- Availability and recovery targets for future cloud services.
- Collaboration conflict-resolution guarantees.
- Support matrix for operating systems, browsers, display hardware, and assistive technologies.
- Formal compatibility guarantees for every export format.
