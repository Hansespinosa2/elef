// Shared presentation visual editor: slide/block toolbar operations, alignment
// directives, projection typing flush, and caret preservation. Ported from the
// Stimulus-era presentation_editor_controller.js without behavior change.
// Framework-free: hosts mount it on their editor form and inject the editor
// seam plus editing utilities (caret math, markdown mapping, live math, and
// projection editability live in the shared editor runtime and are used here
// only through the injected deps object so this module never imports host
// paths). Slide visibility/scaling/present-mode travel live in
// presentation.ts; renderer chrome markup stays byte-identical so the frozen
// fixtures keep matching.
//
// Host interop: the mount publishes itself as
// form.presentationEditorController (the CodeMirror editor host calls
// restoreCaret after mode changes) and clears it on destroy.
import {
  addSlide as addSlideToSource,
  blockOperationRange,
  blockOperationStart,
  deleteSlide as deleteSlideFromSource,
  directiveLineSpan,
  exciseRanges,
  insertAlignDirective,
  insertBlock as insertBlockInSource,
  moveBlock as moveBlockInSource,
  moveSlide as moveSlideInSource,
  parseAlignment,
  removeBlock as removeBlockFromSource
} from "@elef/work-model/document-transforms"
import { alignSourceOffset, alignVisibleOffset, touchesConcealedBoundary, translateProjectionInput, visibleBlockText } from "../../session/projection_input.js"
import { routeProjectionKeymapKey, routeProjectionVimKey } from "../../session/projection_keys.js"
import { updateVimNormalCaret } from "../../session/vim_caret.js"
import { applyVisualAssistInsert, type AssistInsertEdit } from "../../session/projection_assist.js"
import { activeDisplayMathForNodes, mathEndPlacement, mathMatchForSpan } from "../../session/projection_math.js"

export interface EditorSourceRange {
  start: number
  end: number
}

export interface PresentationEditorBlock {
  id: string
  range: EditorSourceRange
  source_range?: EditorSourceRange
  content_range?: EditorSourceRange
  delimiter_range?: EditorSourceRange
  position_directive_id?: string
  position?: { horizontal: string; vertical: string; vertical_explicit?: boolean }
  empty_placeholder?: boolean
}

export interface PresentationEditorDirective {
  id: string
  type: string
  range: EditorSourceRange
  source_range: EditorSourceRange
  content_range?: EditorSourceRange
  delimiter_range?: EditorSourceRange
}

export interface PresentationEditorRegion {
  id: string
  block_id?: string
  kind: string
  role?: string
  editable: boolean
  range?: EditorSourceRange
  source_range?: EditorSourceRange
  content_range: EditorSourceRange
  delimiter_range?: EditorSourceRange
}

export interface PresentationEditorSlide {
  range?: EditorSourceRange
  source_range?: EditorSourceRange
  content_range?: EditorSourceRange
  delimiter_range?: EditorSourceRange
  blocks?: Array<PresentationEditorBlock>
  directives?: Array<PresentationEditorDirective>
  editable_regions?: Array<PresentationEditorRegion>
}

export interface PresentationEditorMap {
  source_length?: number
  slides?: Array<PresentationEditorSlide>
  directives?: Array<PresentationEditorDirective>
  editable_regions?: Array<PresentationEditorRegion>
}

export interface PresentationEditorSeam {
  value: string
  selectionStart: number
  selectionEnd: number
  selectionHead: number
  selectionRangeCount: number
  vimEnabled: boolean
  insertMode: boolean
  editingMode: string
  focus(): void
  inputTarget?: unknown
  commitSource?(source: string): unknown
  replaceRange(replacement: string, from: number, to: number): void
  replaceRanges(changes: Array<{ from: number; to: number; insert: string }>): void
  setSelectionRange(anchor: number, head?: number): void
  handleVimKey(event: ProjectionKeyEvent): boolean
  runKeymap(event: ProjectionKeyEvent): boolean
}

export interface ProjectionEvent {
  readonly target: EventTarget | null | undefined
  readonly clientX?: number | undefined
  readonly clientY?: number | undefined
  preventDefault(): void
}

export interface ProjectionKeyEvent {
  readonly key: string
  readonly target: EventTarget | null | undefined
  readonly isComposing: boolean
  readonly altKey: boolean
  readonly ctrlKey: boolean
  readonly metaKey: boolean
  readonly shiftKey: boolean
  preventDefault(): void
}

export interface ProjectionBeforeinputEvent {
  readonly target: EventTarget | null | undefined
  readonly inputType: string
  readonly data?: string | null | undefined
  readonly dataTransfer?: {
    readonly types?: ArrayLike<string> | null | undefined
    getData(type: string): string
  } | null | undefined
}

export interface PresentationEditorDeps {
  syncActiveMath(element: Element | null, flush: () => void): void
  syncActiveInline(target: Element | null, getSource: (block: Element) => string | null, flush: () => void): void
  handleMathClick(event: ProjectionEvent, target: Element | null): boolean
  recordMathMousedown(event: ProjectionEvent, target: Element | null): void
  handleMathKeydown(event: ProjectionKeyEvent, canvas: Element | null, flush: () => void): boolean
  moveCaretBetweenBlocks(event: ProjectionKeyEvent, canvas: Element | null): boolean
  visibleOffsetAtPoint(block: Element, node: Node | null, offset: number): number | null
  sourceOffsetForVisibleOffset(source: string, offset: number): number
  visibleOffsetForSourceOffset(source: string, offset: number): number
  pointAtVisibleOffset(block: Element, offset: number): any
  markdownForVisibleText(source: string, text: string, kind: string, element: Element, options?: { documentMode?: boolean }): string
  renderInlineMath(element: Element): void
  setProjectionBlockEditable(block: Element, editable: boolean, label: string): void
  removeEmptyBlockSource(source: string, from: number, to: number): string
}

export interface PresentationEditorEnv {
  confirm(message: string): boolean
  scheduleFrame(callback: () => void): number | undefined
  cancelFrame(handle: number): void
  getSelection(): Selection | null
  activeElement(): Element | null
  Node: { ELEMENT_NODE: number }
}

export interface PresentationEditorHost extends HTMLFormElement {
  previewController?: { projectionFresh?: boolean } | null
  presentationEditorController?: PresentationEditor
}

export interface MountPresentationEditorOptions {
  deps?: PresentationEditorDeps
  env?: Partial<PresentationEditorEnv>
  canvasElement?: Element | null
  statusElement?: Element | null
  sourceElement?: Element | null
  getEditor?: () => PresentationEditorSeam | null
  isProjectionFresh?: () => boolean
  editorMap?: PresentationEditorMap | null
}

interface ProjectionEdit {
  id: string
  blockId: string
  from: number
  to: number
  source: string
  kind: string
  blockElement: Element
}

interface ShiftableRanges {
  id?: string | null
  block_id?: string | null
  range?: EditorSourceRange | undefined
  source_range?: EditorSourceRange | undefined
  content_range?: EditorSourceRange | undefined
  delimiter_range?: EditorSourceRange | undefined
}

interface EditorRuntimeView {
  confirm?(message: string): boolean
  requestAnimationFrame?(callback: () => void): number
  cancelAnimationFrame?(handle: number): void
  getSelection?(): Selection | null
  Node?: { ELEMENT_NODE: number }
}

function defaultEnv(form: PresentationEditorHost | null): PresentationEditorEnv {
  const doc = form?.ownerDocument ?? globalThis.document
  const view = (doc?.defaultView ?? globalThis) as unknown as EditorRuntimeView | null | undefined
  const docSelection = (doc as unknown as { getSelection?(): Selection | null }).getSelection
  return {
    confirm: (message) => globalThis.window?.confirm?.(message) ?? view?.confirm?.(message) ?? false,
    scheduleFrame: (callback) => (view?.requestAnimationFrame ?? globalThis.requestAnimationFrame)?.(callback),
    cancelFrame: (handle) => (view?.cancelAnimationFrame ?? globalThis.cancelAnimationFrame)?.(handle),
    getSelection: () => view?.getSelection?.() ?? docSelection?.() ?? null,
    activeElement: () => doc?.activeElement ?? null,
    Node: view?.Node ?? globalThis.Node,
  }
}

export class PresentationEditor {
  element: PresentationEditorHost
  deps: PresentationEditorDeps
  confirm: (message: string) => boolean
  scheduleFrame: (callback: () => void) => number | undefined
  cancelFrame: (handle: number) => void
  getSelection: () => Selection | null
  activeElement: () => Element | null
  Node: { ELEMENT_NODE: number }
  canvasElement: Element | null
  statusElement: Element | null
  sourceElement: Element | null
  getEditor: () => PresentationEditorSeam | null
  isProjectionFresh: () => boolean
  editorController: PresentationEditorSeam | null
  map: PresentationEditorMap | null
  disposers: Array<() => void>
  operationPending: boolean
  updatingSource: boolean
  pendingProjectionFrame: number | undefined
  pendingProjectionEdits: Map<string, ProjectionEdit> | undefined
  activeProjectionBlock: Element | null | undefined
  lastProjectionCaret: { blockId: string; visibleOffset: number } | undefined
  pendingCaretRestore: { sourceOffset: number; preferredBlockId: string | null; relativeOffset?: number } | null | undefined
  suppressProjectionInput = false

  constructor(form: PresentationEditorHost, options: MountPresentationEditorOptions = {}) {
    this.element = form
    this.deps = (options.deps ?? {}) as PresentationEditorDeps
    const env = { ...defaultEnv(form), ...(options.env ?? {}) }
    this.confirm = env.confirm
    this.scheduleFrame = env.scheduleFrame
    this.cancelFrame = env.cancelFrame
    this.getSelection = env.getSelection
    this.activeElement = env.activeElement
    this.Node = env.Node
    this.canvasElement = options.canvasElement ?? null
    this.statusElement = options.statusElement ?? null
    this.sourceElement = options.sourceElement ?? null
    this.getEditor = options.getEditor ?? (() => null)
    this.isProjectionFresh =
      options.isProjectionFresh ?? (() => form?.previewController?.projectionFresh !== false)
    this.editorController = null
    this.map = options.editorMap ?? this.readMap()
    this.disposers = []
    this.operationPending = false
    this.updatingSource = false

    const on = (
      target: {
        addEventListener?(type: string, listener: (event: any) => void, capture?: boolean): void
        removeEventListener?(type: string, listener: (event: any) => void, capture?: boolean): void
      } | null | undefined,
      type: string,
      handler: (event: any) => void,
      capture?: boolean
    ): void => {
      target?.addEventListener?.(type, handler, capture)
      this.disposers.push(() => target?.removeEventListener?.(type, handler, capture))
    }
    on(form, "elef:editor-ready", (event) => {
      this.editorController = event.detail.editor
      this.applyMode(form.getAttribute("data-editor-mode") || "visual")
    })
    // Capture phase: projection inputs must be read before form bubble-phase
    // actions (notably input->preview#schedule) mark the projection stale.
    // The retired Stimulus controller handled block input through the block's
    // own action (target phase, also before the form actions); capture is the
    // framework-free equivalent and keeps unfocused programmatic edits working.
    on(form, "input", (event) => {
      this.sourceInput(event)
      this.blockInput(event)
    }, true)
    on(form, "beforeinput", (event) => this.projectionBeforeinput(event), true)
    on(form, "elef:editor-mode-change", (event) => this.applyMode(event.detail.mode))
    on(form, "elef:preview-updated", (event) => this.previewUpdated(event.detail.payload))
    on(form, "elef:preview-stale", (event) => this.previewStale(event.detail))
    on(form, "click", (event) => this.handleAction(event))
    on(form, "click", (event) => this.projectionLinkClicked(event))
    on(form, "mousedown", (event) => this.deps.recordMathMousedown(event, this.canvas()))
    on(form, "change", (event) => {
      if (event.target?.closest?.("[data-presentation-editor-align]")) this.alignmentChanged(event)
    })
    on(form, "focusin", (event) => {
      if (event.target?.closest?.("[data-editor-block-id]")) this.blockFocus(event)
    })
    on(form, "focusout", (event) => {
      if (event.target?.closest?.("[data-editor-block-id]")) this.blockBlur(event)
    })
    on(form, "mouseover", (event) => this.placePillForEvent(event))
    on(form, "focusin", (event) => this.placePillForEvent(event))
    on(form, "keydown", (event) => this.blockKeydown(event), true)
    const doc = form?.ownerDocument
    on(doc, "selectionchange", () => {
      this.refreshVimNormalCaret()
      this.rememberProjectionCaret()
    })
    const view = doc?.defaultView ?? null
    on(view, "scroll", () => this.refreshVimNormalCaret(), true)
    on(view, "resize", () => {
      this.refreshVimNormalCaret()
      this.placeAlignmentPills()
    })

    this.editorController = this.getEditor()
    this.applyMode(form.getAttribute("data-editor-mode") || "visual")
    this.placeAlignmentPills()
  }

  destroy(): void {
    if (this.pendingProjectionFrame) this.cancelFrame(this.pendingProjectionFrame)
    this.flushPendingProjectionEdits()
    this.disposers.splice(0).forEach((dispose) => dispose())
  }

  canvas(): Element | null {
    return (
      this.canvasElement ??
      this.element.querySelector('[data-presentation-editor-target="canvas"]')
    )
  }

  status(): Element | null {
    return (
      this.statusElement ??
      this.element.querySelector('[data-presentation-editor-target="status"]')
    )
  }

  source(): Element | null {
    return (
      this.sourceElement ??
      this.element.querySelector('[data-presentation-editor-target="source"]')
    )
  }

  applyMode(mode: string): void {
    const visual = mode !== "source"
    this.element.dataset.editorMode = visual ? "visual" : "source"
    if (!visual) this.pendingCaretRestore = null
    this.source()?.classList.toggle("is-source-hidden", visual)
    this.syncProjectionEditability()
    this.refreshVimNormalCaret()
  }

  refreshVimNormalCaret(): void {
    if (!this.element) return
    updateVimNormalCaret(this.element, this.editorController, this.canvas(), this.element.dataset.editorMode !== "source")
  }

  blockFocus(event: ProjectionEvent): void {
    this.activeProjectionBlock = (event.target as Element).closest("[data-editor-block-id]")
    this.element.dataset.editorProjectionActive = "true"
    this.refreshVimNormalCaret()
  }

  blockBlur(_event: ProjectionEvent): void {
    this.refreshVimNormalCaret()
    this.deps.syncActiveMath(this.canvas(), () => this.flushPendingProjectionEdits())
    this.deps.syncActiveInline(this.canvas(), (block) => this.inlineRevealSource(block), () => this.flushPendingProjectionEdits())
    this.flushPendingProjectionEdits()
    this.activeProjectionBlock = null
    delete this.element.dataset.editorProjectionActive
    this.syncProjectionEditability()
  }

  projectionLinkClicked(event: ProjectionEvent): void {
    if (this.deps.handleMathClick(event, this.canvas())) return
    this.deps.syncActiveMath(this.canvas(), () => this.flushPendingProjectionEdits())
    this.deps.syncActiveInline(this.canvas(), (block) => this.inlineRevealSource(block), () => this.flushPendingProjectionEdits())
    const link = (event.target as Element).closest?.(".editor-projection [contenteditable='true'] a")
    if (!link) return

    event.preventDefault()
    ;(link.closest("[contenteditable='true']") as HTMLElement | null)?.focus()
  }

  // Precise-intent leg, shared with the document editor: caret-local
  // plain-text intents commit exact source transactions immediately, so
  // history and Vim observe real edits. The native mutation still proceeds
  // and the pending flush reconciles, which also covers any batch the
  // precise path declines.
  projectionBeforeinput(event: ProjectionBeforeinputEvent): void {
    // A set-but-unfired flag from a previous cycle is stale (its input was
    // cancelled); each cycle re-arms only when it commits precisely below.
    // beforeinput/input pairs never interleave, so clearing here cannot
    // steal a live suppression.
    this.suppressProjectionInput = false
    const editor = this.editorController
    if (!editor || this.updatingSource || this.pendingProjectionEdits?.size) return
    const block = (event.target as Element | null | undefined)?.closest?.("[data-editor-block-id]") as HTMLElement | null | undefined
    const canvas = this.canvas()
    if (!block || !canvas?.contains(block)) return
    if (block.contentEditable !== "true") return
    const region = this.regionForBlock(block.dataset.editorBlockId)
    if (!region) return
    const selection = this.getSelection()
    if (!selection?.anchorNode || !selection.focusNode) return
    const endpointBlock = (node: Node): Element | null => {
      const element = (node.nodeType === this.Node.ELEMENT_NODE ? node : (node as ChildNode).parentElement) as Element | null
      return element?.closest?.("[data-editor-block-id]") ?? null
    }
    if (endpointBlock(selection.anchorNode) !== block || endpointBlock(selection.focusNode) !== block) return
    const anchorVisible = this.deps.visibleOffsetAtPoint(block, selection.anchorNode, selection.anchorOffset)
    const focusVisible = this.deps.visibleOffsetAtPoint(block, selection.focusNode, selection.focusOffset)
    if (anchorVisible === null || focusVisible === null) return
    const transferTypes = Array.from(event.dataTransfer?.types ?? [])
    let transferText: string | null = null
    if (transferTypes.includes("text/plain")) {
      try {
        transferText = event.dataTransfer?.getData("text/plain") ?? null
      } catch {
        transferText = null
      }
    }
    // Edits fully inside an active display span commit by identity from
    // the verified match: the span shows literal (possibly multiline)
    // source, and the newline-blind map cannot express empty-line
    // carets. Raw in-span offsets count newlines, so the middle body
    // line maps exactly. Unpaired spans decline to legacy.
    const activeDisplay = activeDisplayMathForNodes(selection.anchorNode, selection.focusNode)
    if (activeDisplay) {
      const displaySlice = editor.value.slice(region.content_range.start, region.content_range.end)
      const displayMatch = mathMatchForSpan([block], displaySlice, activeDisplay)
      const anchorRaw = displayMatch ? this.deps.visibleOffsetAtPoint(activeDisplay, selection.anchorNode, selection.anchorOffset) : null
      const focusRaw = displayMatch ? this.deps.visibleOffsetAtPoint(activeDisplay, selection.focusNode, selection.focusOffset) : null
      if (!displayMatch || anchorRaw === null || focusRaw === null) return
      const displayEdit = translateProjectionInput({
        inputType: event.inputType,
        data: event.data ?? null,
        transferText,
        transferHasHtml: transferTypes.includes("text/html"),
        anchorVisible: anchorRaw,
        focusVisible: focusRaw,
        kind: region.kind ?? "paragraph"
      }, activeDisplay.textContent ?? "")
      const spanLength = (activeDisplay.textContent ?? "").length
      if (!displayEdit || displayEdit.fromVisible < 0 || displayEdit.toVisible > spanLength) return
      const displayFrom = region.content_range.start + displayMatch.start + displayEdit.fromVisible
      const displayTo = region.content_range.start + displayMatch.start + displayEdit.toVisible
      this.shiftMapAfterEdit(displayFrom, displayTo, displayEdit.insert.length, region.block_id)
      editor.replaceRange(displayEdit.insert, displayFrom, displayTo)
      this.suppressProjectionInput = true
      return
    }
    const visibleText = visibleBlockText(block)
    const edit = translateProjectionInput({
      inputType: event.inputType,
      data: event.data ?? null,
      transferText,
      transferHasHtml: transferTypes.includes("text/html"),
      anchorVisible,
      focusVisible,
      kind: region.kind ?? "paragraph"
    }, visibleText)
    if (!edit) return
    const slice = editor.value.slice(region.content_range.start, region.content_range.end)
    // The precise path is an optimization over a correct legacy: it runs
    // only when the DOM and the source model agree on the block's
    // visible text modulo whitespace the DOM never rendered (trimmed
    // trailing spaces, folded runs not yet reinstalled). The aligner
    // walks both texts, so it both verifies agreement and bridges lag;
    // revealed source, collapsed directives, and rendered math diverge
    // on non-whitespace and decline to the structure-aware legacy path.
    // A length gate cannot prove agreement (lag shifts equal-length
    // texts), so the aligner always maps, and the concealed check uses
    // the same mapping (the caret map would jump the lag and decline).
    const mapOffset = (visible: number): number | null => alignVisibleOffset(slice, visibleText, visible)
    const mappedFrom = mapOffset(edit.fromVisible)
    const mappedTo = mapOffset(edit.toVisible)
    if (mappedFrom === null || mappedTo === null) return
    if (touchesConcealedBoundary((_source, visible) => mapOffset(visible), slice, edit.fromVisible, edit.toVisible)) return
    const from = region.content_range.start + mappedFrom
    const to = region.content_range.start + mappedTo
    if (region.kind !== "code") this.deps.renderInlineMath(block)
    this.shiftMapAfterEdit(from, to, edit.insert.length, region.block_id)
    editor.replaceRange(edit.insert, from, to)
    // The commit above is complete and the map already shifted: the input
    // event that follows this beforeinput must not arm a redundant
    // pending entry, which would reconcile the (possibly whitespace-lagging)
    // block DOM back over the just-committed source.
    this.suppressProjectionInput = true
  }

  blockInput(event: ProjectionEvent): void {
    // Engine-routed keys dispatch input to refresh the preview while the
    // block DOM still shows the old text; reconciling it would write stale
    // content back over the engine. Consumed first so a suppressed event
    // never arms the flag for the next real input.
    if (this.suppressProjectionInput) {
      this.suppressProjectionInput = false
      // The precise commit already landed and the native mutation just
      // completed: render math this keystroke completed (the beforeinput
      // render saw pre-mutation text). Render-only, no pending arm:
      // reconciling the (possibly whitespace-lagging) DOM would write
      // stale content back over the just-committed source.
      const blockElement = (event.target as Element).closest?.("[data-editor-block-id]")
      const block = this.findBlock((blockElement as HTMLElement | null)?.dataset.editorBlockId)
      const region = this.map?.editable_regions?.find((candidate) => candidate.block_id === block?.id)
      if (blockElement && region && region.kind !== "code") this.deps.renderInlineMath(blockElement)
      return
    }
    if (!this.editorController || this.updatingSource) return
    const blockElement = (event.target as Element).closest?.("[data-editor-block-id]")
    if (!blockElement || !this.canEditBlock(blockElement)) return
    const block = this.findBlock((blockElement as HTMLElement).dataset.editorBlockId)
    const region = this.map?.editable_regions?.find((candidate) => candidate.block_id === block?.id)
    if (!block || !region) return

    const from = region.content_range.start
    const to = region.content_range.end
    this.pendingProjectionEdits ||= new Map()
    const pending = this.pendingProjectionEdits.get(region.id)
    const currentSource = pending?.source ?? this.editorController.value.slice(from, to)
    if (!this.operationPending) {
      this.operationPending = true
      this.setControlsDisabled(true)
      this.setStatus("Updating visual structure… finish editing to refresh the controls.")
    }
    this.pendingProjectionEdits.set(region.id, { id: region.id, blockId: block.id, from, to, source: currentSource, kind: region.kind, blockElement })
    this.scheduleProjectionFlush()
  }

  captureCaret(): { blockId: string; sourceOffset: number } | null {
    const selection = this.getSelection()
    const focusNode = selection?.focusNode ?? null
    const container = focusNode
      ? (focusNode.nodeType === this.Node.ELEMENT_NODE ? focusNode : focusNode.parentElement) as Element | null
      : null
    const block = container?.closest?.("[data-editor-block-id]") as HTMLElement | null | undefined
    const canvas = this.canvas()
    const current: { blockId: string | undefined; visibleOffset: number | null | undefined } | undefined = block && canvas?.contains(block)
      ? { blockId: block.dataset.editorBlockId, visibleOffset: this.deps.visibleOffsetAtPoint(block, focusNode, selection?.focusOffset ?? 0) }
      : this.lastProjectionCaret
    if (!current || current.visibleOffset == null) return null

    const region = this.regionForBlock(current.blockId)
    if (!region) return null
    const editor = this.editorController
    if (!editor) return null
    const source = editor.value.slice(region.content_range.start, region.content_range.end)
    // Active math shows literal source, but the map models math as
    // zero-width: without this branch every in-span caret reads as the
    // match end, corrupting the engine caret on every selection sync.
    // Verified pairing refuses stale spans (falls through below).
    const activeMath = container?.closest?.(".editor-math-active")
    if (focusNode && activeMath && block) {
      const match = mathMatchForSpan([block], source, activeMath)
      if (match) {
        const offset = this.deps.visibleOffsetAtPoint(activeMath, focusNode, selection?.focusOffset ?? 0)
        if (offset !== null) {
          return { blockId: current.blockId ?? "", sourceOffset: region.content_range.start + match.start + offset }
        }
      }
    }
    // DOM-grounded read first (same rationale as the document editor):
    // uncommitted whitespace the map cannot see would clamp the engine
    // caret to the wrong boundary and corrupt the next keystroke.
    const aligned = block && canvas?.contains(block)
      ? alignVisibleOffset(source, visibleBlockText(block), current.visibleOffset)
      : null
    return {
      blockId: current.blockId ?? "",
      sourceOffset: region.content_range.start + (aligned ?? this.deps.sourceOffsetForVisibleOffset(source, current.visibleOffset))
    }
  }

  // Pure source-to-DOM point mapping shared by collapsed and ranged
  // restores; unmappable offsets return null so callers degrade to the
  // collapsed head. No focus, selection, or pending side effects.
  selectionPointForSourceOffset(sourceOffset: number, preferredBlockId: string | null = null): { element: HTMLElement; node: Node; offset: number; visibleOffset: number; blockId: string } | null {
    const canvas = this.canvas()
    if (!canvas || !this.editorController) return null
    const regions = this.allRegions().filter((region) => region.editable)
    const region = regions.find((candidate) => candidate.block_id === preferredBlockId) ||
      regions.find((candidate) => sourceOffset >= candidate.content_range.start && sourceOffset <= candidate.content_range.end) ||
      regions.reduce((closest, candidate) => {
        if (!closest) return candidate
        const distance = Math.min(Math.abs(sourceOffset - candidate.content_range.start), Math.abs(sourceOffset - candidate.content_range.end))
        const closestDistance = Math.min(Math.abs(sourceOffset - closest.content_range.start), Math.abs(sourceOffset - closest.content_range.end))
        return distance < closestDistance ? candidate : closest
      }, null as PresentationEditorRegion | null)
    if (!region) return null

    const block = [...canvas.querySelectorAll("[data-editor-block-id]")]
      .find((candidate) => (candidate as HTMLElement).dataset.editorBlockId === region.block_id)
    if (!block) return null
    const source = this.editorController.value.slice(region.content_range.start, region.content_range.end)
    // Math END boundaries bypass the map: it models math as zero-width,
    // so at block end (or inside an active span, which shows source) the
    // mapped point lands before the atom instead of after it. Verified
    // pairing refuses stale spans and falls through to the map below.
    const mathPoint = mathEndPlacement([block], source, sourceOffset - region.content_range.start)
    if (mathPoint) {
      const visibleOffset = this.deps.visibleOffsetAtPoint(block, mathPoint.node, mathPoint.offset)
        ?? this.deps.visibleOffsetForSourceOffset(source, sourceOffset - region.content_range.start)
      return { element: block as HTMLElement, node: mathPoint.node, offset: mathPoint.offset, visibleOffset, blockId: region.block_id ?? "" }
    }
    // DOM-grounded placement first: the block DOM can lead the engine by
    // whitespace the source trimmed (a just-typed edge space), which the
    // canonical map cannot see. The aligner declines concealed syntax
    // and missing text, which fall back to the map.
    const relative = sourceOffset - region.content_range.start
    const visibleOffset = alignSourceOffset(source, visibleBlockText(block), relative)
      ?? this.deps.visibleOffsetForSourceOffset(source, relative)
    const point = this.deps.pointAtVisibleOffset(block, visibleOffset)
    return { element: block as HTMLElement, node: point[0], offset: point[1], visibleOffset, blockId: region.block_id ?? "" }
  }

  restoreCaret(sourceOffset: number, preferredBlockId: string | null = null): boolean {
    const canvas = this.canvas()
    if (!canvas || !this.editorController) return false
    const point = this.selectionPointForSourceOffset(sourceOffset, preferredBlockId)
    if (!point) return false
    if (point.element.contentEditable !== "true") {
      if (this.isProjectionFresh() === false) this.pendingCaretRestore = { sourceOffset, preferredBlockId }
      return false
    }
    point.element.focus({ preventScroll: true })
    this.getSelection()?.setPosition(point.node, point.offset)
    this.lastProjectionCaret = { blockId: point.blockId, visibleOffset: point.visibleOffset }
    return true
  }

  // Paints a ranged engine selection (Vim visual) on the rendered slide
  // text; either end unmappable or uneditable aborts (the collapsed head
  // placed first still shows).
  restoreSelection(anchorSourceOffset: number, headSourceOffset: number, preferredBlockId: string | null = null): boolean {
    const canvas = this.canvas()
    if (!canvas || !this.editorController) return false
    const anchor = this.selectionPointForSourceOffset(anchorSourceOffset, preferredBlockId)
    const head = this.selectionPointForSourceOffset(headSourceOffset, preferredBlockId)
    if (!anchor || !head) return false
    if (anchor.element.contentEditable !== "true" || head.element.contentEditable !== "true") return false
    head.element.focus({ preventScroll: true })
    this.getSelection()?.setBaseAndExtent(anchor.node, anchor.offset, head.node, head.offset)
    this.lastProjectionCaret = { blockId: head.blockId, visibleOffset: head.visibleOffset }
    this.deps.syncActiveMath(canvas, () => this.flushPendingProjectionEdits())
    this.deps.syncActiveInline(canvas, (block) => this.inlineRevealSource(block), () => this.flushPendingProjectionEdits())
    return true
  }

  // Visual assist pipeline (session/projection_assist): shared with the
  // document editor; the canvas is this projection's root.
  applyVisualAssistInsert(edit: AssistInsertEdit, selection: Selection | null = this.getSelection()): boolean {
    return applyVisualAssistInsert({
      projectionTarget: this.canvas(),
      allRegions: () => this.allRegions(),
      shiftMapAfterEdit: (from, to, length, blockId) => this.shiftMapAfterEdit(from, to, length, blockId),
      stageCaretRestore: (restore) => { this.pendingCaretRestore = restore }
    }, edit, selection)
  }

  syncActiveMathAfterCaretMove(): void {
    this.deps.syncActiveMath(this.canvas(), () => {})
  }

  flushPendingProjectionEdits(): void {
    if (this.pendingProjectionFrame) this.cancelFrame(this.pendingProjectionFrame)
    this.pendingProjectionFrame = undefined
    if (!this.pendingProjectionEdits?.size || !this.editorController) return

    const pending = [...this.pendingProjectionEdits.values()]
    const current = this.editorController.value
    const edits = pending.map((edit) => {
      const region = this.regionForBlock(edit.blockId)
      return {
        ...edit,
        from: region?.content_range.start ?? edit.from,
        to: region?.content_range.end ?? edit.to,
        replacement: this.deps.markdownForVisibleText(edit.source, this.editableText(edit.blockElement), edit.kind, edit.blockElement)
      }
    }).filter((edit) => {
      const region = this.regionForBlock(edit.blockId)
      if (!region) return false
      // A newer source transaction (assist accept, undo, reload) committed
      // after this entry was recorded: reconciling would write stale block
      // content back over newer input, so discard it. Ranges always resolve
      // against the current map, never the recorded offsets.
      if (current.slice(region.content_range.start, region.content_range.end) !== edit.source) return false
      return edit.replacement !== edit.source
    })
    this.pendingProjectionEdits.clear()
    if (edits.length === 0) {
      // Precise translator commits reconcile here: the engine already
      // matches, but post-mutation math still needs its live render
      // (the beforeinput render saw pre-mutation text).
      pending.forEach((edit) => {
        if (edit.kind !== "code") this.deps.renderInlineMath(edit.blockElement)
      })
      if (this.operationPending && this.isProjectionFresh() !== false) {
        this.operationPending = false
        this.setControlsDisabled(false)
        this.setStatus("")
      }
      this.syncEngineSelectionFromCaret()
      return
    }

    edits.forEach((edit) => {
      if (edit.kind !== "code") this.deps.renderInlineMath(edit.blockElement)
    })
    const changes = edits.map((edit) => ({ from: edit.from, to: edit.to, insert: edit.replacement }))
      .sort((left, right) => left.from - right.from)
    edits.sort((left, right) => right.from - left.from).forEach((edit) => {
      this.shiftMapAfterEdit(edit.from, edit.to, edit.replacement.length, edit.blockId)
    })
    this.editorController.replaceRanges(changes)
    this.syncEngineSelectionFromCaret()
  }

  scheduleProjectionFlush(): void {
    if (this.pendingProjectionFrame) return
    this.pendingProjectionFrame = this.scheduleFrame(() => {
      this.pendingProjectionFrame = undefined
      this.flushPendingProjectionEdits()
    })
  }

  rememberProjectionCaret(): void {
    this.deps.syncActiveMath(this.canvas(), () => this.flushPendingProjectionEdits())
    this.deps.syncActiveInline(this.canvas(), (block) => this.inlineRevealSource(block), () => this.flushPendingProjectionEdits())
    const selection = this.getSelection()
    if (!selection?.focusNode) return
    const focusNode = selection.focusNode
    const node = (focusNode.nodeType === this.Node.ELEMENT_NODE ? focusNode : focusNode.parentElement) as Element | null
    const block = node?.closest?.("[data-editor-block-id]")
    const canvas = this.canvas()
    if (!block || !canvas?.contains(block)) return
    const visibleOffset = this.deps.visibleOffsetAtPoint(block, selection.focusNode, selection.focusOffset)
    if (visibleOffset === null) return
    this.lastProjectionCaret = { blockId: (block as HTMLElement).dataset.editorBlockId ?? "", visibleOffset }
    if ((block as HTMLElement).contentEditable === "true") this.syncEngineSelectionFromCaret()
  }

  // Input-bridge selection leg, shared with the document editor: while an
  // editable block carries the native caret, the engine selection tracks it,
  // so Vim state, history context, and completion anchors follow visual
  // editing instead of going stale. Typing paths skip here (their source is
  // mid-edit) and sync after the flush commits; ranged drag selections stay
  // projection-side until the drag-translation increment lands.
  syncEngineSelectionFromCaret(): void {
    const editor = this.editorController
    if (!editor || this.pendingProjectionEdits?.size) return
    // A Vim visual range lives on the engine; the projection only ever shows
    // its head, so syncing a collapsed native caret back must not clobber it.
    if (editor.vimEnabled && !editor.insertMode && editor.selectionStart !== editor.selectionEnd) return
    const selection = this.getSelection()
    if (!selection?.isCollapsed || !selection.focusNode) return
    const focusNode = selection.focusNode
    const node = (focusNode.nodeType === this.Node.ELEMENT_NODE ? focusNode : focusNode.parentElement) as Element | null
    const block = node?.closest?.("[data-editor-block-id]")
    const canvas = this.canvas()
    if (!block || !canvas?.contains(block)) return
    if ((block as HTMLElement).contentEditable !== "true") return
    const caret = this.captureCaret()
    if (!caret) return
    if (editor.selectionStart === caret.sourceOffset && editor.selectionEnd === caret.sourceOffset) return
    editor.setSelectionRange(caret.sourceOffset, caret.sourceOffset)
  }

  // Routes visual-mode keys through the live Vim machinery when Vim is
  // Shared visual key routing (session/projection_keys); documents and
  // presentations execute identical behavior through these delegates.
  routeVimKey(event: ProjectionKeyEvent, blockElement: Element): boolean {
    return routeProjectionVimKey(this, event, blockElement)
  }

  routeKeymapKey(event: ProjectionKeyEvent, blockElement: Element): boolean {
    return routeProjectionKeymapKey(this, event, blockElement)
  }

  blockKeydown(event: ProjectionKeyEvent): void {
    if (this.pendingProjectionFrame || this.pendingProjectionEdits?.size) {
      this.flushPendingProjectionEdits()
    }
    const keyBlock = (event.target as Element | null | undefined)?.closest?.("[data-editor-block-id]")
    const keyCanvas = this.canvas()
    if (keyBlock && keyCanvas?.contains(keyBlock) && this.routeVimKey(event, keyBlock)) return
    if (this.deps.handleMathKeydown(event, this.canvas(), () => this.flushPendingProjectionEdits())) return
    if (this.deps.moveCaretBetweenBlocks(event, this.canvas())) return
    if (keyBlock && keyCanvas?.contains(keyBlock) && this.moveBlockWithKeyboard(event)) return
    if (keyBlock && keyCanvas?.contains(keyBlock) && this.routeKeymapKey(event, keyBlock)) return
    if (event.key === "Enter" && !event.shiftKey) {
      this.enterAtBlockEnd(event)
      return
    }
    if (!["Backspace", "Delete"].includes(event.key)) return

    const selection = this.getSelection()
    if (!selection?.isCollapsed) return
    const focusNode = selection.focusNode
    const node = focusNode
      ? (focusNode.nodeType === this.Node.ELEMENT_NODE ? focusNode : focusNode.parentElement) as Element | null
      : null
    const blockElement = node?.closest?.("[data-editor-block-id][contenteditable='true']")
    const canvas = this.canvas()
    if (!blockElement || !canvas?.contains(blockElement) || this.editableText(blockElement).trim() !== "") return
    if (blockElement.querySelector("img, video, iframe, [data-editor-math-source]")) return

    const located = this.locateBlock((blockElement as HTMLElement).dataset.editorBlockId)
    const slide = located && this.map?.slides?.[located.slideIndex]
    const block = located?.block
    if (!slide || !block) return

    event.preventDefault()
    this.flushPendingProjectionEdits()
    const source = this.sourceValue()
    // Shared span math (F6); the slide and block are guaranteed present here.
    const span = blockOperationRange(block, slide) ?? { from: block.range.start, to: block.range.end }
    const from = span.from
    const to = span.to
    const updated = this.deps.removeEmptyBlockSource(source, from, to)
    if (updated !== source) this.replaceSource(updated)
  }

  // Enter at the end of a plain paragraph or heading opens a new
  // empty block below (mid-block Enter already splits through the
  // native path, and lists/quotes/code keep their own flows). Without
  // this the trailing empty paragraph trims away and Enter looks dead.
  enterAtBlockEnd(event: ProjectionKeyEvent): void {
    const selection = this.getSelection()
    if (!selection?.isCollapsed) return
    const focusNode = selection.focusNode
    const node = focusNode
      ? (focusNode.nodeType === this.Node.ELEMENT_NODE ? focusNode : focusNode.parentElement) as Element | null
      : null
    const blockElement = node?.closest?.("[data-editor-block-id][contenteditable='true']")
    const canvas = this.canvas()
    if (!blockElement || !canvas?.contains(blockElement) || !this.editorController) return
    const blockId = (blockElement as HTMLElement).dataset.editorBlockId
    const region = this.regionForBlock(blockId)
    if (!region || !["paragraph", "heading"].includes(region.kind ?? "")) return
    const caret = this.deps.visibleOffsetAtPoint(blockElement, selection.focusNode, selection.focusOffset) ?? 0
    if (caret < visibleBlockText(blockElement).length) return

    event.preventDefault()
    this.flushPendingProjectionEdits()
    const source = this.sourceValue()
    const contentStart = region.content_range.start
    const contentEnd = region.content_range.end
    const before = source.slice(contentStart, contentEnd).replace(/[ \t]+$/, "")
    const updated = source.slice(0, contentStart) + before + "\n\n" + source.slice(contentEnd)
    if (updated === source) return
    this.pendingCaretRestore = { sourceOffset: contentStart + before.length + 2, preferredBlockId: null }
    this.replaceSource(updated)
    // Preview installs hold while an editable has focus; yield it so the
    // new block installs and the pending restore lands the caret there.
    ;(blockElement as HTMLElement).blur()
  }

  alignmentChanged(event: ProjectionEvent): void {
    if (this.element.dataset.editorMode === "source") return
    const select = (event.target as Element).closest("[data-presentation-editor-align]") as HTMLSelectElement
    if (!this.editorController || !this.map) return

    this.deps.syncActiveMath(this.canvas(), () => this.flushPendingProjectionEdits())
    this.deps.syncActiveInline(this.canvas(), (block) => this.inlineRevealSource(block), () => this.flushPendingProjectionEdits())
    this.flushPendingProjectionEdits()

    const source = this.sourceValue()
    const slideIndex = Number(select.dataset.slideIndex)
    const blockIndex = Number(select.dataset.blockIndex)
    const blockId = select.dataset.presentationEditorBlockId || select.dataset.editorBlockId
    const block = (blockId && this.findBlock(blockId)) || this.map?.slides?.[slideIndex]?.blocks?.[blockIndex]
    if (!block) return

    const slides = this.map.slides ?? []
    const slide = slides.find((candidate) => candidate.blocks?.some((item) => item.id === block.id)) || slides[slideIndex]
    if (!slide) return

    const directive = slide.directives?.find((candidate) => candidate.id === block.position_directive_id)
    const alignment = select.value
    let updated: string

    const { horizontal, vertical, verticalExplicit } = parseAlignment(alignment)

    const caret = this.captureCaret()
    const region = this.regionForBlock(block.id)
    const sourceOffset = caret?.blockId === block.id
      ? caret.sourceOffset
      : (region?.content_range.start ?? block.range.start)

    let from: number
    let to: number
    let replacement = ""

    if (directive) {
      from = directive.range.start
      to = directive.range.end
      if (alignment) {
        const span = directiveLineSpan(source, from, to)
        to = span.to
        replacement = `:::align{${alignment}}${span.lineEnding}`
        updated = `${source.slice(0, from)}${replacement}${source.slice(to)}`
        const delta = replacement.length - (to - from)
        this.shiftMapAfterEdit(from, to, replacement.length)
        directive.range.end = from + replacement.length
        directive.source_range.end = directive.range.end
        block.position = { horizontal, vertical, vertical_explicit: verticalExplicit }
        this.pendingCaretRestore = {
          sourceOffset: sourceOffset >= to ? sourceOffset + delta : sourceOffset,
          preferredBlockId: block.id
        }
      } else {
        // Alignment removal strips the directive line. Position directives
        // apply to their single following block; the grammar has no
        // scoped groups or closers.
        const ranges = [directive]
        ranges.sort((left, right) => right.range.start - left.range.start).forEach((candidate) => {
          let rangeEnd = candidate.range.end
          const lineEnding = source.slice(candidate.range.start, rangeEnd).match(/(?:\r\n|\r|\n)$/)?.[0]
          if (!lineEnding) {
            const restMatch = source.slice(rangeEnd).match(/^(?:\r\n|\r|\n)/)?.[0]
            if (restMatch) rangeEnd += restMatch.length
          }
          this.shiftMapAfterEdit(candidate.range.start, rangeEnd, 0)
        })
        delete block.position_directive_id
        delete block.position
        slide.directives = (slide.directives ?? []).filter((candidate) => !ranges.includes(candidate))
        updated = exciseRanges(source, ranges.map((candidate) => candidate.range))
      }
    } else if (alignment) {
      from = block.range.start
      to = from
      const inserted = insertAlignDirective(source, from, `:::align{${alignment}}`)
      const lineEnding = inserted.lineEnding
      replacement = inserted.replacement
      updated = inserted.updated
      this.shiftMapAfterEdit(from, to, replacement.length)
      const affected = [block, region].filter((item): item is PresentationEditorBlock | PresentationEditorRegion => Boolean(item))
      affected.forEach((object) => {
        (["range", "source_range", "content_range", "delimiter_range"] as const).forEach((name) => {
          const range = object[name]
          if (range?.start === from) range.start += replacement.length
        })
      })
      const directiveId = `directive-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`
      const directiveLength = `:::align{${alignment}}${lineEnding}`.length
      const newDirective: PresentationEditorDirective = {
        id: directiveId,
        type: "position",
        range: { start: from, end: from + directiveLength },
        source_range: { start: from, end: from + directiveLength }
      }
      slide.directives ||= []
      slide.directives.push(newDirective)
      this.map.directives ||= []
      this.map.directives.push(newDirective)
      block.position_directive_id = directiveId
      block.position = { horizontal, vertical, vertical_explicit: verticalExplicit }
      const delta = replacement.length
      this.pendingCaretRestore = {
        sourceOffset: sourceOffset >= to ? sourceOffset + delta : sourceOffset,
        preferredBlockId: block.id
      }
    } else {
      return
    }

    // Immediately update visual block in presentation DOM
    const blockElement = this.canvas()?.querySelector(`[data-editor-block-id="${block.id}"]`)
    if (blockElement) {
      blockElement.classList.remove(
        "position-left", "position-center", "position-right",
        "position-top", "position-middle", "position-bottom"
      )
      blockElement.classList.add(`position-${horizontal}`, `position-${vertical}`)
    }

    this.updatingSource = true
    const committed = this.editorController.commitSource
      ? this.editorController.commitSource(updated)
      : (this.editorController.replaceRange(updated, 0, this.editorController.value.length), Promise.resolve(true))
    void Promise.resolve(committed).then(() => {
      this.updatingSource = false
      this.operationPending = false
      this.setControlsDisabled(false)
      this.setStatus("Updating visual preview…")
    })
  }

  handleAction(event: ProjectionEvent): void {
    if (!this.canOperateOnProjection()) return
    const control = (event.target as Element).closest?.("[data-presentation-editor-action]") as HTMLButtonElement | null | undefined
    if (!control || control.disabled) return
    event.preventDefault()
    const action = control.dataset.presentationEditorAction
    const slideIndex = Number(control.dataset.slideIndex)

    if (action === "delete-slide" && !this.confirm("Delete this slide?")) return

    // Slide actions only: per-block buttons are gone (keyboard + the
    // Edit-actions menu own block structure), so block actions below run
    // through applyVisualBlockAction/moveCaretBlock instead of clicks.
    switch (action) {
      case "add-slide-after":
        this.addSlide(slideIndex + 1)
        break
      case "delete-slide":
        this.deleteSlide(slideIndex)
        break
      case "move-slide-up":
        this.moveSlide(slideIndex, slideIndex - 1)
        break
      case "move-slide-down":
        this.moveSlide(slideIndex, slideIndex + 1)
        break
      default:
        break
    }
  }

  // Shared Edit-actions menu entry point: runs a block structure action
  // against the caret's block. Creation and deletion restore the caret to
  // the action site on the fresh preview; moves share the caret-following
  // Alt+Arrow path so repeated moves keep working from the menu.
  applyVisualBlockAction(action: "add-block-after" | "delete-block" | "move-block-up" | "move-block-down"): boolean {
    if (action === "move-block-up" || action === "move-block-down") {
      return this.moveCaretBlock(action === "move-block-up" ? -1 : 1)
    }
    if (this.element.dataset.editorMode === "source" || !this.canOperateOnProjection()) return false
    const caret = this.captureCaret()
    const located = caret && this.locateBlock(caret.blockId)
    const slide = located && this.map?.slides?.[located.slideIndex]
    const block = located?.block
    if (!slide || !block) return false
    const blocks = slide.blocks ?? []
    const blockIndex = blocks.indexOf(block)
    if (blockIndex === -1) return false
    // The menu runs on a prevented mousedown (no blur), so flush
    // in-flight keystrokes first: replaceSource commits the engine value
    // and would otherwise drop them.
    this.flushPendingProjectionEdits()
    const source = this.sourceValue()

    if (action === "add-block-after") {
      const target = blocks[blockIndex + 1]
      // Mirror insertBlock's insertion point so the caret lands at the
      // start of the inserted "New block" text on the fresh preview.
      const slideRange = slide.range
      if (!slideRange) return false
      const insertion = target ? blockOperationStart(slide, target) : slideRange.end
      const updated = insertBlockInSource(source, slide, blockIndex + 1)
      if (updated === null) return false
      let caretOffset = insertion
      if (!target) {
        const before = source.slice(0, insertion)
        caretOffset = insertion + (before.trim() === "" ? 0 : before.endsWith("\n") ? 1 : 2)
      }
      this.pendingCaretRestore = { sourceOffset: caretOffset, preferredBlockId: null }
      this.replaceSource(updated)
      return true
    }
    if (action === "delete-block") {
      if (!this.confirm("Delete this block?")) return false
      const span = blockOperationRange(block, slide)
      const updated = removeBlockFromSource(source, slide, block)
      if (updated === null) return false
      // Post-delete the offset is a gap boundary; nearest-region
      // resolution lands the caret at the end of the previous block.
      if (span) this.pendingCaretRestore = { sourceOffset: span.from, preferredBlockId: null }
      this.replaceSource(updated)
      return true
    }
    return false
  }

  moveBlockWithKeyboard(event: ProjectionKeyEvent): boolean {
    if (!event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) return false
    if (event.key !== "ArrowUp" && event.key !== "ArrowDown") return false
    const caret = this.captureCaret()
    const located = caret && this.locateBlock(caret.blockId)
    // Placeless keys stay with the engine; inside a block Alt always means
    // the block move, so busy/boundary presses swallow instead of flipping
    // to linewise mid-gesture (a stale-map linewise move would corrupt).
    if (!located || !located.block) return false
    event.preventDefault()
    this.moveCaretBlock(event.key === "ArrowUp" ? -1 : 1)
    return true
  }

  // Blockwise Alt+ArrowUp/Down (and the menu move rows): swaps the caret's
  // block with its neighbor through the shared move op. Visual
  // presentations move whole blocks where source mode moves lines — each
  // mode's Alt matches its editing unit, like Enter splits blocks here and
  // inserts newlines there. Refusals (stale map, empty placeholders,
  // boundaries) return false; the keyboard path swallows those inside a
  // block and the menu surfaces them as a no-op.
  moveCaretBlock(delta: -1 | 1): boolean {
    if (this.element.dataset.editorMode === "source" || !this.canOperateOnProjection()) return false
    const caret = this.captureCaret()
    if (!caret) return false
    const located = this.locateBlock(caret.blockId)
    const slide = located && this.map?.slides?.[located.slideIndex]
    const block = located?.block
    if (!slide || !block || block.empty_placeholder) return false
    const blocks = slide.blocks ?? []
    const blockIndex = blocks.indexOf(block)
    const neighbor = blocks[blockIndex + delta]
    if (blockIndex === -1 || !neighbor || neighbor.empty_placeholder) return false
    this.flushPendingProjectionEdits()
    const region = this.regionForBlock(block.id)
    const relative = region ? caret.sourceOffset - region.content_range.start : 0
    const updated = moveBlockInSource(this.sourceValue(), slide, blockIndex, blockIndex + delta)
    if (updated === null) return false
    // Numbered block ids are dense among non-empty blocks, so an adjacent
    // swap hands the moved block its neighbor's id; the pending restore
    // resolves the preserved relative caret against the fresh map.
    this.pendingCaretRestore = { sourceOffset: 0, preferredBlockId: neighbor.id, relativeOffset: Math.max(0, relative) }
    this.replaceSource(updated)
    // Release the focus-held preview so the reorder installs (Enter splits
    // do the same); the staged restore returns focus to the moved block.
    const active = this.element.ownerDocument?.activeElement as HTMLElement | null
    if (active && typeof active.blur === "function" && this.canvas()?.contains(active)) active.blur()
    return true
  }

  addSlide(index: number): void {
    this.replaceSource(addSlideToSource(this.sourceValue(), this.map?.slides || [], index))
  }

  deleteSlide(index: number): void {
    const updated = deleteSlideFromSource(this.sourceValue(), this.map?.slides || [], index)
    if (updated === null) return
    this.replaceSource(updated)
  }

  moveSlide(index: number, target: number): void {
    const updated = moveSlideInSource(this.sourceValue(), this.map, index, target)
    if (updated === null) return
    this.replaceSource(updated)
  }

  addBlock(slideIndex: number, index: number): void {
    const updated = insertBlockInSource(this.sourceValue(), this.map?.slides?.[slideIndex], index)
    if (updated === null) return
    this.replaceSource(updated)
  }

  deleteBlock(slideIndex: number, blockIndex: number): void {
    const slide = this.map?.slides?.[slideIndex]
    const block = slide?.blocks?.[blockIndex]
    if (!slide || !block) return
    const updated = removeBlockFromSource(this.sourceValue(), slide, block)
    if (updated === null) return
    this.replaceSource(updated)
  }

  moveBlock(slideIndex: number, index: number, target: number): void {
    const updated = moveBlockInSource(this.sourceValue(), this.map?.slides?.[slideIndex], index, target)
    if (updated === null) return
    this.replaceSource(updated)
  }

  previewUpdated(payload: { editor_map?: PresentationEditorMap } | null | undefined): void {
    if (!payload?.editor_map) {
      if (this.operationPending) this.setStatus("Visual controls are paused until the preview recovers.")
      this.syncProjectionEditability({ preserveActive: Boolean(this.activeProjectionBlock && this.element.dataset.editorProjectionActive === "true") })
      return
    }
    const wasPending = this.operationPending
    this.map = payload.editor_map
    this.operationPending = false
    if (wasPending) this.setControlsDisabled(false)
    this.placeAlignmentPills()
    this.syncProjectionEditability()
    this.setStatus("")
    this.restorePendingCaret()
  }

  previewStale(detail: { preserveActive?: boolean } = {}): void {
    if (!this.isMapSynchronized()) {
      this.operationPending = true
      this.setControlsDisabled(true)
    }
    // T1 fast path (mirrors DocumentEditor.previewStale): while a
    // source-editable projection block holds DOM focus, only that block's
    // editability is observable — the blur reinstall re-syncs the rest.
    const active = this.activeElement()?.closest?.("[data-editor-block-id]") as HTMLElement | null | undefined
    if (this.element.dataset.editorMode !== "source" && active && this.canvas()?.contains(active) &&
        active.dataset.editorSourceEditable !== "false") {
      const label = active.classList.contains("slide-title") ? "Editable slide title" : "Editable slide block"
      this.deps.setProjectionBlockEditable(active, true, label)
      return
    }
    this.syncProjectionEditability({ preserveActive: detail.preserveActive })
  }

  isMapSynchronized(): boolean {
    return Boolean(
      this.map &&
      this.editorController &&
      Number(this.map.source_length || 0) === this.editorController.value.length
    )
  }

  canOperateOnProjection(): boolean {
    if (this.element.dataset.editorMode === "source") return false
    if (this.operationPending) return false
    return this.isMapSynchronized() || this.isProjectionFresh() !== false
  }

  canEditBlock(blockElement: Element): boolean {
    if (this.element.dataset.editorMode === "source" || (blockElement as HTMLElement).dataset.editorSourceEditable === "false") return false
    if (this.isProjectionFresh() !== false) return true

    return this.activeProjectionBlock === blockElement &&
      this.activeElement()?.closest?.("[contenteditable='true']") === blockElement
  }

  syncProjectionEditability({ preserveActive = false }: { preserveActive?: boolean | undefined } = {}): void {
    const visual = this.element.dataset.editorMode !== "source"
    const fresh = this.isProjectionFresh() !== false
    const active = preserveActive ? this.activeElement()?.closest?.("[data-editor-block-id]") : null
    this.element.querySelectorAll("[data-editor-block-id][data-editor-source-editable]").forEach((block) => {
      const sourceEditable = (block as HTMLElement).dataset.editorSourceEditable !== "false"
      const editable = sourceEditable && visual && (fresh || (preserveActive && block === active))
      const label = block.classList.contains("slide-title") ? "Editable slide title" : "Editable slide block"
      this.deps.setProjectionBlockEditable(block, editable, label)
    })
    this.element.querySelectorAll("[data-presentation-editor-align]").forEach((control) => {
      const target = control as HTMLSelectElement
      const disabled = !visual || !this.map
      if (target.disabled !== disabled) target.disabled = disabled
    })
  }

  sourceInput(event: ProjectionEvent): void {
    if (this.updatingSource || !this.editorController) return
    if (event.target !== this.editorController.inputTarget) return
    if (this.activeElement()?.closest?.(".editor-projection")) return

    this.operationPending = true
    this.setControlsDisabled(true)
  }

  shiftMapAfterEdit(from: number, to: number, replacementLength: number, editedBlockId: string | null = null): void {
    if (!this.map) return

    const delta = replacementLength - (to - from)
    const shiftRange = (range: EditorSourceRange | null | undefined, editedBlock: boolean): void => {
      if (!range) return
      const shiftStart = (position: number): number => {
        if (position === from && editedBlock) return position
        if (position <= from) return position
        if (position >= to) return position + delta
        return from
      }
      const shiftEnd = (position: number): number => {
        if (from === to && position === from) return editedBlock ? from + replacementLength : position
        if (position <= from) return position
        if (position >= to) return position + delta
        return editedBlock ? from + replacementLength : from
      }
      range.start = shiftStart(range.start)
      range.end = Math.max(range.start, shiftEnd(range.end))
    }
    const shifted = new Set<object>()
    const shiftObject = (object: ShiftableRanges | null | undefined): void => {
      if (!object || shifted.has(object)) return
      shifted.add(object)
      const editedBlock = object.id === editedBlockId || object.block_id === editedBlockId
      shiftRange(object.range, editedBlock)
      shiftRange(object.source_range, editedBlock)
      shiftRange(object.content_range, editedBlock)
      shiftRange(object.delimiter_range, editedBlock)
    }

    this.map.source_length = Number(this.map.source_length || 0) + delta
    this.map.slides?.forEach((slide) => {
      shiftObject(slide)
      slide.blocks?.forEach(shiftObject)
      slide.directives?.forEach(shiftObject)
      slide.editable_regions?.forEach(shiftObject)
    })
    this.map.directives?.forEach(shiftObject)
    this.map.editable_regions?.forEach(shiftObject)
  }

  replaceSource(source: string): void {
    if (!this.editorController) return
    this.operationPending = true
    this.setControlsDisabled(true)
    this.updatingSource = true
    const committed = this.editorController.commitSource
      ? this.editorController.commitSource(source)
      : (this.editorController.replaceRange(source, 0, this.editorController.value.length), Promise.resolve(true))
    // The session commit applies asynchronously; hold the guard until it
    // settles so projection input cannot interleave with the replacement.
    void Promise.resolve(committed).then(() => {
      this.updatingSource = false
      this.setStatus("Updating visual preview…")
    })
  }

  sourceValue(): string {
    return this.editorController?.value || this.source()?.querySelector("textarea")?.value || ""
  }

  findBlock(id: string | undefined): PresentationEditorBlock | undefined {
    return this.map?.slides?.flatMap((slide) => slide.blocks || []).find((block) => block.id === id)
  }

  locateBlock(id: string | undefined): { slideIndex: number; block: PresentationEditorBlock } | null {
    for (const [slideIndex, slide] of (this.map?.slides || []).entries()) {
      const block = slide.blocks?.find((candidate) => candidate.id === id)
      if (block) return { slideIndex, block }
    }
    return null
  }

  allRegions(): Array<PresentationEditorRegion> {
    return this.map?.editable_regions || this.map?.slides?.flatMap((slide) => slide.editable_regions || []) || []
  }

  regionForBlock(blockId: string | undefined): PresentationEditorRegion | null {
    return this.allRegions().find((region) => region.block_id === blockId) || null
  }

  inlineRevealSource(block: Element): string | null {
    const blockId = (block as HTMLElement).dataset.editorBlockId
    const region = this.regionForBlock(blockId)
    const editor = this.editorController
    if (!region?.content_range || !editor) return null
    // Table and image blocks route to dedicated differs without
    // inline-reveal projection. Fenced code keeps its source: inline
    // pairing safe-refuses inside pre (elements excluded), while the
    // structural pass needs the source for fence delimiters.
    if (["table", "image"].includes(region.kind ?? "")) return null
    // Heading regions exclude the marker prefix; extend to the block
    // start so structural markers resolve (leading # never tokenizes,
    // so inline pairing is unaffected).
    if (region.kind === "heading") {
      const start = this.findBlock(blockId)?.range.start
      if (typeof start === "number" && start < region.content_range.start) {
        return editor.value.slice(start, region.content_range.end)
      }
    }
    return editor.value.slice(region.content_range.start, region.content_range.end)
  }

  restorePendingCaret(): void {
    const pending = this.pendingCaretRestore
    if (!pending || this.element.dataset.editorMode !== "visual") return
    this.pendingCaretRestore = null
    let sourceOffset = pending.sourceOffset
    const preferredBlockId = pending.preferredBlockId
    // Block moves resolve against the fresh map: the moved block inherits
    // its neighbor's id, and the preserved relative caret clamps into its
    // new content range. An unresolvable id abandons the restore rather
    // than landing the caret at an unrelated offset.
    if (pending.relativeOffset !== undefined && preferredBlockId) {
      const region = this.regionForBlock(preferredBlockId)
      if (!region) return
      const length = region.content_range.end - region.content_range.start
      sourceOffset = region.content_range.start + Math.max(0, Math.min(pending.relativeOffset, length))
    }
    this.scheduleFrame(() => this.restoreCaret(sourceOffset, preferredBlockId))
  }

  editableText(element: Element): string {
    // NBSP preserved as just-typed width evidence for the differ (same
    // contract as the document editor); canonicalized at diff time.
    return ((element as HTMLElement).innerText || element.textContent || "").replace(/\n+$/, "")
  }

  readMap(): PresentationEditorMap | null {
    const source = this.element.querySelector("[data-editor-map-json]")?.textContent
    if (!source) return null
    try {
      return JSON.parse(source)
    } catch (_error) {
      return null
    }
  }

  // Alignment-pill placement: the pill floats beside its shell (never
  // over block text, so it cannot swallow clicks), flipping to the left
  // side or an inside overlay when the slide edge leaves no room. Measured
  // eagerly after every install and refreshed on hover/focus (typing grows
  // shrink-wrapped shells), so the DOM state is always final.
  placeAlignmentPills(): void {
    const canvas = this.canvas()
    if (!canvas) return
    canvas.querySelectorAll(".slide-block-shell").forEach((shell) => this.placeAlignmentPill(shell))
  }

  placePillForEvent(event: ProjectionEvent): void {
    const shell = (event.target as Element | null)?.closest?.(".slide-block-shell")
    if (shell && this.canvas()?.contains(shell)) this.placeAlignmentPill(shell)
  }

  placeAlignmentPill(shell: Element): void {
    // Shells own exactly one pill by construction (chrome + ERB partials).
    const controls = shell.querySelector(".presentation-editor-block-controls") as HTMLElement | null
    if (!controls) return
    const slide = shell.closest(".slide") ?? this.canvas()
    if (!slide || typeof shell.getBoundingClientRect !== "function") return
    const shellRect = shell.getBoundingClientRect()
    const slideRect = slide.getBoundingClientRect()
    if (shellRect.width === 0 && shellRect.height === 0) return
    // Transparent pills still lay out, so the width measures exactly.
    const pillWidth = controls.offsetWidth || 190
    const gap = 6
    const pad = 4
    const roomRight = slideRect.right - pad - (shellRect.right + gap)
    const roomLeft = shellRect.left - gap - (slideRect.left + pad)
    const placement = roomRight >= pillWidth ? "" : roomLeft >= pillWidth ? "pill-left" : "pill-inside"
    const current = controls.classList.contains("pill-left")
      ? "pill-left"
      : controls.classList.contains("pill-inside") ? "pill-inside" : ""
    if (current === placement) return
    controls.classList.remove("pill-left", "pill-inside")
    if (placement) controls.classList.add(placement)
  }

  setStatus(text: string): void {
    const status = this.status()
    if (status) status.textContent = text
  }

  setControlsDisabled(disabled: boolean): void {
    ;([...this.element.querySelectorAll("[data-presentation-editor-action]")] as Array<HTMLButtonElement>).forEach((control) => {
      if (disabled) {
        if (control.dataset.editorOperationPending !== "true") {
          control.dataset.editorOriginalDisabled = String(control.disabled)
        }
        control.dataset.editorOperationPending = "true"
        control.disabled = true
      } else if (control.dataset.editorOperationPending === "true") {
        control.disabled = control.dataset.editorOriginalDisabled === "true"
        delete control.dataset.editorOperationPending
        delete control.dataset.editorOriginalDisabled
      }
    })
  }
}

// Mounts the shared presentation editor on a host editor form. Hosts pass
// their editor seam (getEditor), freshness probe, environment overrides, and
// the editing utility deps. The mount publishes itself as
// form.presentationEditorController for the CodeMirror editor host (caret
// restore after mode changes) and clears it on destroy.
export function mountPresentationEditor(form: PresentationEditorHost, options: MountPresentationEditorOptions = {}) {
  const editor = new PresentationEditor(form, options)
  const previous = form.presentationEditorController
  form.presentationEditorController = editor
  return {
    editor,
    destroy() {
      editor.destroy()
      if (form.presentationEditorController === editor) {
        if (previous) form.presentationEditorController = previous
        else delete form.presentationEditorController
      }
    },
  }
}
