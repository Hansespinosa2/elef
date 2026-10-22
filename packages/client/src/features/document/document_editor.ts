// Document visual editor feature: contenteditable document projection editing,
// caret preservation, structured-block continuation, alignment directives, and
// overflow-adjacent map bookkeeping. Framework-free: the host constructs it
// with DOM roots, document kind, editor lookup plus preview-toggle seams, and
// the shared editing-utilities deps object, then delegates lifecycle and
// actions. The web Stimulus controller is the thin adapter.
import { blockOperationRange, directiveLineSpan, exciseRange, insertAlignDirective } from "@elef/work-model/document-transforms"
import { alignSourceOffset, alignVisibleOffset, touchesConcealedBoundary, translateProjectionInput, visibleBlockText } from "../../session/projection_input.js"
import { routeProjectionKeymapKey, routeProjectionVimKey } from "../../session/projection_keys.js"
import { updateVimNormalCaret } from "../../session/vim_caret.js"
import { applyVisualAssistInsert, type AssistInsertEdit } from "../../session/projection_assist.js"
import { activeDisplayMathForNodes, mathEndPlacement, mathMatchForSpan } from "../../session/projection_math.js"
import { markStage } from "../../session/stage_marks.js"
import { projectionRangeEdit } from "../../session/projection_range.js"
import { paintProjectionSelections } from "../../session/projection_selections.js"

export interface DocumentEditorRange {
  start: number
  end: number
}

export interface DocumentEditorBlock {
  id: string
  range: DocumentEditorRange
  source_range?: DocumentEditorRange
  content_range?: DocumentEditorRange
  delimiter_range?: DocumentEditorRange
  kind?: string
  empty_placeholder?: boolean
  position_directive_id?: string
  position?: { horizontal: string; vertical?: string; vertical_explicit?: boolean }
}

export interface DocumentEditorDirective {
  id: string
  type: string
  range: DocumentEditorRange
  source_range: DocumentEditorRange
  content_range?: DocumentEditorRange
  delimiter_range?: DocumentEditorRange
}

export interface DocumentEditorRegion {
  id: string
  block_id?: string
  kind: string
  role?: string
  editable: boolean
  range?: DocumentEditorRange
  source_range?: DocumentEditorRange
  content_range: DocumentEditorRange
  delimiter_range?: DocumentEditorRange
}

export interface DocumentEditorSlide {
  range?: DocumentEditorRange
  source_range?: DocumentEditorRange
  content_range?: DocumentEditorRange
  delimiter_range?: DocumentEditorRange
  blocks?: Array<DocumentEditorBlock>
  directives?: Array<DocumentEditorDirective>
  editable_regions?: Array<DocumentEditorRegion>
}

export interface DocumentEditorMap {
  source_length?: number
  slides?: Array<DocumentEditorSlide>
  directives?: Array<DocumentEditorDirective>
  editable_regions?: Array<DocumentEditorRegion>
}

export interface DocumentEditorSeam {
  value: string
  selectionStart: number
  selectionEnd: number
  selectionHead: number
  selectionRangeCount: number
  selectionRanges?: Array<{ anchor: number; head: number }>
  vimEnabled: boolean
  insertMode: boolean
  editingMode: string
  focus(): void
  commitSource(source: string): unknown
  replaceRange(replacement: string, from: number, to: number): void
  replaceRanges(changes: Array<{ from: number; to: number; insert: string }>): void
  setSelectionRange(anchor: number, head?: number): void
  handleVimKey(event: DocumentProjectionKeyEvent): boolean
  runKeymap(event: DocumentProjectionKeyEvent): boolean
}

export interface DocumentProjectionEvent {
  readonly target: EventTarget | null | undefined
  readonly clientX?: number | undefined
  readonly clientY?: number | undefined
  preventDefault(): void
}

export interface DocumentProjectionBeforeinputEvent {
  readonly cancelable?: boolean
  preventDefault?(): void
  readonly target: EventTarget | null | undefined
  readonly inputType: string
  readonly data?: string | null | undefined
  readonly dataTransfer?: {
    readonly types?: ArrayLike<string> | null | undefined
    getData(type: string): string
  } | null | undefined
}

export interface DocumentProjectionKeyEvent {
  readonly key: string
  readonly target: EventTarget | null | undefined
  readonly defaultPrevented: boolean
  readonly isComposing: boolean
  readonly altKey: boolean
  readonly ctrlKey: boolean
  readonly metaKey: boolean
  readonly shiftKey: boolean
  preventDefault(): void
}

export interface DocumentEditorDeps {
  syncActiveMath(target: Element | null, flush: () => void): void
  inlinePointForSourceOffset(fragments: Element[], source: string, offset: number): [Node, number] | null
  syncActiveInline(target: Element | null, getSource: (block: Element) => string | null, flush: () => void): void
  handleMathClick(event: DocumentProjectionEvent, target: Element | null): boolean
  recordMathMousedown(event: DocumentProjectionEvent, target: Element | null): void
  handleMathKeydown(event: DocumentProjectionKeyEvent, target: Element | null, flush: () => void): boolean
  moveCaretBetweenBlocks(event: DocumentProjectionKeyEvent, target: Element | null): boolean
  finishMathBeforeEnter(event: DocumentProjectionKeyEvent, target: Element | null, flush: () => void): void
  visibleOffsetAtPoint(block: Element, node: Node | null, offset: number): number | null
  sourceOffsetForVisibleOffset(source: string, offset: number): number
  visibleOffsetForSourceOffset(source: string, offset: number): number
  sourceOffsetForVisiblePosition(markdown: string, element: Element, position: number): number | null
  pointAtVisibleOffset(block: Element, offset: number): any
  markdownForVisibleText(source: string, text: string, kind: string, element: Element, options?: { documentMode?: boolean }): string
  renderInlineMath(element: Element): void
  setProjectionBlockEditable(block: Element, editable: boolean, label: string): void
  removeEmptyBlockSource(source: string, from: number, to: number): string
  createActiveMathSpan(replacement: string, spec: { source: string; open: string; close: string; display: boolean }): Element
  deRenderMath(element: Element, options: { caret: string }): boolean
}

export interface DocumentEditorHost extends HTMLElement {
  previewController?: { projectionFresh?: boolean; refreshNow?: () => void } | null
}

export interface DocumentEditorOptions {
  element?: Element | null
  projection?: Element | null
  kind?: string
  focusTitle?: boolean
  lookupEditor?: ((element: Element | null) => DocumentEditorSeam | null) | null
  afterPreview?: ((element: Element, detail: any) => void) | null
  restorePreviewToggle?: ((element: Element) => void) | null
  deps?: DocumentEditorDeps
}

interface DocumentProjectionEdit {
  from: number
  to: number
  source: string
  kind: string
  blockId: string
  blockElement: Element
}

interface DocumentShiftable {
  id?: string
  block_id?: string
  range?: DocumentEditorRange | undefined
  source_range?: DocumentEditorRange | undefined
  content_range?: DocumentEditorRange | undefined
  delimiter_range?: DocumentEditorRange | undefined
}

export class DocumentEditor {
  element: DocumentEditorHost
  projection: Element | null
  kind: string | undefined
  focusTitle: boolean
  lookupEditor: ((element: Element | null) => DocumentEditorSeam | null) | null
  afterPreview: ((element: Element, detail: any) => void) | null
  restorePreviewToggle: ((element: Element) => void) | null
  deps: DocumentEditorDeps
  cachedEditor: DocumentEditorSeam | null
  readyEditor: DocumentEditorSeam | null
  map: DocumentEditorMap | null | undefined
  editorReady: ((event: any) => void) | undefined
  modeChangedHandler: ((event: any) => void) | undefined
  previewHandler: ((event: any) => void) | undefined
  previewStaleHandler: ((event: any) => void) | undefined
  documentPaginatedHandler: (() => void) | undefined
  projectionLinkHandler: ((event: any) => void) | undefined
  mathPressHandler: ((event: any) => void) | undefined
  positionControlOutsidePointerDown: ((event: any) => void) | undefined
  blockKeydownHandler: ((event: any) => void) | undefined
  beforeinputHandler: ((event: any) => void) | undefined
  selectionChangeHandler: (() => void) | undefined
  vimCaretRefreshHandler: (() => void) | undefined
  hasPresentationProjection: boolean | undefined
  pendingProjectionFrame: number | undefined
  pendingProjectionEdits: Map<string, DocumentProjectionEdit> | undefined
  pendingCaretRestore: { sourceOffset: number; preferredBlockId: string | null } | null | undefined
  suppressProjectionInput = false
  // A pending caret is scoped to the transaction that armed it: sourceLength
  // records the post-edit document length, so a later restore can tell a
  // still-pending reinstall (same length) from a superseded entry a newer
  // edit already invalidated (different length). Without the scope, a
  // failed restore stays armed and yanks the caret on the next unrelated
  // preview update.
  pendingCaret: { sourceOffset: number; location: string; sourceLength: number } | null | undefined
  // Throttle key for the reveal syncs below: the last block id and active
  // span element a sync ran for. Both syncs are block- and span-scoped, so
  // caret motion inside the same block and span repaints nothing and can
  // skip the projection-wide scans (holding j/arrows otherwise pays
  // O(blocks) plus KaTeX re-renders per step). Any block or span change,
  // flush, or reinstall resets the key and re-syncs fully.
  lastRevealSyncBlockId: string | null | undefined
  lastRevealSyncSpan: Element | null | undefined
  lastProjectionCaret: { blockId: string; visibleOffset: number } | undefined
  updatingProjection: boolean | undefined
  initialTitleFocusSettled: boolean | undefined
  initialTitleFocused: boolean | undefined

  constructor({ element, projection = null, kind = undefined, focusTitle = false, lookupEditor = null, afterPreview = null, restorePreviewToggle = null, deps = {} as DocumentEditorDeps } = {} as DocumentEditorOptions) {
    this.element = element as DocumentEditorHost
    this.projection = projection
    this.kind = kind
    this.focusTitle = focusTitle
    this.lookupEditor = lookupEditor
    this.afterPreview = afterPreview
    this.restorePreviewToggle = restorePreviewToggle
    this.deps = deps
    this.cachedEditor = null
    this.readyEditor = null
  }

  get editorController(): DocumentEditorSeam {
    // DOM methods require a bound editor; a null flows through and throws
    // downstream exactly like the JavaScript (pure helpers never touch it).
    return (this.readyEditor ?? this.cachedEditor) as DocumentEditorSeam
  }

  // Work kind can change under a live editor (desktop switches works without
  // remounting); the host adapter syncs it through this setter.
  setKind(kind: string | undefined): void {
    this.kind = kind
  }

  get hasProjectionTarget(): boolean {
    return Boolean(this.projection)
  }

  get projectionTarget(): Element | null {
    return this.projection
  }

  connect(): void {
    this.map = this.readMap()
    this.cachedEditor = this.lookupEditor?.(this.element?.querySelector("[data-controller~='editor']")) ?? null
    this.editorReady = (event) => {
      this.readyEditor = event.detail.editor
      this.applyMode(this.element.getAttribute("data-editor-mode") || "visual")
      this.focusNewDocumentTitle()
    }
    this.element.addEventListener("elef:editor-ready", this.editorReady)
    this.modeChangedHandler = (event) => this.applyMode(event.detail.mode)
    this.element.addEventListener("elef:editor-mode-change", this.modeChangedHandler)
    this.previewHandler = (event) => {
      this.previewUpdated(event.detail.payload)
      this.afterPreview?.(this.element, event.detail)
    }
    this.element.addEventListener("elef:preview-updated", this.previewHandler)
    this.previewStaleHandler = (event) => this.previewStale(event.detail)
    this.element.addEventListener("elef:preview-stale", this.previewStaleHandler)
    this.documentPaginatedHandler = () => {
      if (!this.focusTitle) return
      if (this.initialTitleFocusSettled) return
      // Pagination captures and restores the caret in descended (text, offset)
      // form, so a title focus from editor-ready does not survive it. Refocus
      // after the first pagination (one-shot via settled below): at this point
      // the page just loaded, so there is no user caret to steal.
      this.initialTitleFocused = false
      this.focusNewDocumentTitle()
      if (this.projectionTarget?.querySelector(".document-editor-block h1")) this.initialTitleFocusSettled = true
    }
    this.element.addEventListener("elef:document-paginated", this.documentPaginatedHandler)
    this.projectionLinkHandler = (event) => this.projectionLinkClicked(event)
    this.element.addEventListener("click", this.projectionLinkHandler)
    this.mathPressHandler = (event) => this.deps.recordMathMousedown(event, this.projectionTarget)
    this.element.addEventListener("mousedown", this.mathPressHandler)
    // The host can connect this feature after the first preview event when
    // a desktop work is opened. Restore the toggle from the installed preview
    // state so that a successful render cannot leave Visual permanently disabled.
    this.restorePreviewToggle?.(this.element)
    this.positionControlOutsidePointerDown = (event) => {
      const targetControl = event.target.closest?.(".document-block-position-control")
      this.projectionTarget?.querySelectorAll(".document-block-position-control.is-open")?.forEach((control) => {
        if (control !== targetControl) control.classList.remove("is-open")
      })
    }
    document.addEventListener("pointerdown", this.positionControlOutsidePointerDown, true)
    this.hasPresentationProjection = Boolean(this.element.querySelector(".presentation-editor-projection"))
    if (!this.hasPresentationProjection) {
      this.blockKeydownHandler = (event) => this.blockKeydown(event)
      this.element.addEventListener("keydown", this.blockKeydownHandler, true)
      this.beforeinputHandler = (event) => this.projectionBeforeinput(event)
      this.element.addEventListener("beforeinput", this.beforeinputHandler, true)
      this.selectionChangeHandler = () => {
        this.refreshVimNormalCaret()
        this.rememberProjectionCaret()
      }
      document.addEventListener("selectionchange", this.selectionChangeHandler)
      // The normal-mode block and the multi-selection overlay track
      // viewport geometry: refresh on any scroll or resize as well as
      // selection changes.
      this.vimCaretRefreshHandler = () => {
        this.refreshVimNormalCaret()
        this.restoreSelections()
      }
      window.addEventListener("scroll", this.vimCaretRefreshHandler, true)
      window.addEventListener("resize", this.vimCaretRefreshHandler)
    }
    this.applyMode(this.element.getAttribute("data-editor-mode") || "visual")
    this.focusNewDocumentTitle()
  }

  disconnect(): void {
    this.element.removeEventListener("elef:editor-ready", this.editorReady as EventListener)
    this.element.removeEventListener("elef:editor-mode-change", this.modeChangedHandler as EventListener)
    this.element.removeEventListener("elef:preview-updated", this.previewHandler as EventListener)
    this.element.removeEventListener("elef:preview-stale", this.previewStaleHandler as EventListener)
    this.element.removeEventListener("elef:document-paginated", this.documentPaginatedHandler as EventListener)
    this.element.removeEventListener("click", this.projectionLinkHandler as EventListener)
    this.element.removeEventListener("mousedown", this.mathPressHandler as EventListener)
    document.removeEventListener("pointerdown", this.positionControlOutsidePointerDown as EventListener, true)
    this.element.removeEventListener("keydown", this.blockKeydownHandler as EventListener, true)
    this.element.removeEventListener("beforeinput", this.beforeinputHandler as EventListener, true)
    document.removeEventListener("selectionchange", this.selectionChangeHandler as EventListener)
    window.removeEventListener("scroll", this.vimCaretRefreshHandler as EventListener, true)
    window.removeEventListener("resize", this.vimCaretRefreshHandler as EventListener)
    if (this.pendingProjectionFrame) cancelAnimationFrame(this.pendingProjectionFrame)
    this.flushPendingProjectionEdits()
  }

  applyMode(mode: string): void {
    const visual = mode !== "source"
    this.element.dataset.editorMode = visual ? "visual" : "source"
    if (!visual) {
      this.projectionTarget?.querySelectorAll(".document-block-position-control.is-open")?.forEach((control) => {
        control.classList.remove("is-open")
      })
    }
    if (!visual) this.pendingCaretRestore = null
    this.projectionTarget?.setAttribute("aria-label", visual ? "Visual editing surface" : "Rendered preview")
    this.syncProjectionEditability()
    this.refreshVimNormalCaret()
    this.restoreSelections()
  }

  refreshVimNormalCaret(): void {
    if (!this.element) return
    updateVimNormalCaret(this.element, this.editorController, this.projectionTarget, this.element.dataset.editorMode !== "source")
  }

  blockFocus(): void {
    this.element.dataset.editorProjectionActive = "true"
    this.refreshVimNormalCaret()
  }

  blockBlur(): void {
    this.refreshVimNormalCaret()
    this.deps.syncActiveMath(this.projectionTarget, () => this.flushPendingProjectionEdits())
    this.deps.syncActiveInline(this.projectionTarget, (block) => this.inlineRevealSource(block), () => this.flushPendingProjectionEdits())
    this.flushPendingProjectionEdits()
    delete this.element.dataset.editorProjectionActive
    this.syncProjectionEditability()
  }

  projectionLinkClicked(event: DocumentProjectionEvent): void {
    if (this.deps.handleMathClick(event, this.projectionTarget)) return
    const link = (event.target as Element).closest?.(".editor-projection [contenteditable='true'] a")
    const editable = link?.closest("[contenteditable='true']") as HTMLElement | null
    this.deps.syncActiveMath(this.projectionTarget, () => this.flushPendingProjectionEdits())
    this.deps.syncActiveInline(this.projectionTarget, (block) => this.inlineRevealSource(block), () => this.flushPendingProjectionEdits())
    if (!link) return

    event.preventDefault()
    editable?.focus({ preventScroll: true })
  }

  // Precise-intent leg: caret-local plain-text intents commit exact source
  // transactions immediately, so history and Vim observe real edits. The
  // native mutation still proceeds and the pending flush reconciles, which
  // also covers any batch the precise path declines.
  projectionBeforeinput(event: DocumentProjectionBeforeinputEvent): void {
    // A set-but-unfired flag from a previous cycle is stale (its input was
    // cancelled); each cycle re-arms only when it commits precisely below.
    // beforeinput/input pairs never interleave, so clearing here cannot
    // steal a live suppression.
    this.suppressProjectionInput = false
    const editor = this.editorController
    if (!editor || this.updatingProjection) return
    const block = (event.target as Element | null | undefined)?.closest?.("[data-editor-block-id]") as HTMLElement | null | undefined
    if (!block || !this.projectionTarget?.contains(block)) return
    if (block.contentEditable !== "true") return
    const blockId = block.dataset.editorBlockId
    const region = this.regionForBlock(blockId)
    if (!region) return
    const selection = window.getSelection()
    if (!selection?.anchorNode || !selection.focusNode) return
    const ranged = projectionRangeEdit(event, this.projectionTarget, selection, (endpoint, node, offset) => {
      if (this.pendingProjectionEdits?.size) this.flushPendingProjectionEdits()
      const endpointRegion = this.regionForBlock(endpoint.dataset.editorBlockId)
      if (!endpointRegion) return null
      const visible = this.visibleOffsetInBlockGroup(endpoint, node, offset)
      if (visible === null) return null
      const slice = editor.value.slice(endpointRegion.content_range.start, endpointRegion.content_range.end)
      const content = this.combinedBlockForId(endpoint.dataset.editorBlockId) || endpoint
      const relative = alignVisibleOffset(slice, visibleBlockText(content), visible)
        ?? this.deps.sourceOffsetForVisibleOffset(slice, visible)
      return endpointRegion.content_range.start + relative
    })
    if (ranged) {
      event.preventDefault?.()
      this.pendingCaretRestore = { sourceOffset: ranged.from + ranged.insert.length, preferredBlockId: null }
      editor.replaceRange(ranged.insert, ranged.from, ranged.to)
      ;(document.activeElement as HTMLElement | null)?.blur()
      return
    }
    if (this.pendingProjectionEdits?.size) return
    const endpointBlock = (node: Node): Element | null => {
      const element = (node.nodeType === Node.ELEMENT_NODE ? node : (node as ChildNode).parentElement) as Element | null
      return element?.closest?.("[data-editor-block-id]") ?? null
    }
    if (endpointBlock(selection.anchorNode) !== block || endpointBlock(selection.focusNode) !== block) return
    markStage("key-visibleoffsets-start")
    const anchorVisible = this.visibleOffsetInBlockGroup(block, selection.anchorNode, selection.anchorOffset)
    const focusVisible = this.visibleOffsetInBlockGroup(block, selection.focusNode, selection.focusOffset)
    markStage("key-visibleoffsets-end")
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
      const displayMatch = mathMatchForSpan(this.blockFragments(blockId), displaySlice, activeDisplay)
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
      this.shiftMapAfterEdit(displayFrom, displayTo, displayEdit.insert.length, blockId)
      editor.replaceRange(displayEdit.insert, displayFrom, displayTo)
      this.suppressProjectionInput = true
      return
    }
    markStage("key-visibletext-start")
    const visibleText = visibleBlockText(block)
    markStage("key-visibletext-end")
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
    markStage("key-align-start")
    const mapOffset = (visible: number): number | null => alignVisibleOffset(slice, visibleText, visible)
    const mappedFrom = mapOffset(edit.fromVisible)
    const mappedTo = mapOffset(edit.toVisible)
    if (mappedFrom === null || mappedTo === null) { markStage("key-align-end"); return }
    if (touchesConcealedBoundary((_source, visible) => mapOffset(visible), slice, edit.fromVisible, edit.toVisible)) { markStage("key-align-end"); return }
    markStage("key-align-end")
    const from = region.content_range.start + mappedFrom
    const to = region.content_range.start + mappedTo
    markStage("key-renderinline-start")
    if (region.kind !== "code") this.blockFragments(blockId).forEach((fragment) => this.deps.renderInlineMath(fragment))
    markStage("key-renderinline-end")
    markStage("key-enginecommit-start")
    this.shiftMapAfterEdit(from, to, edit.insert.length, blockId)
    editor.replaceRange(edit.insert, from, to)
    markStage("key-enginecommit-end")
    // The commit above is complete and the map already shifted: the input
    // event that follows this beforeinput must not arm a redundant
    // pending entry, which would reconcile the (possibly whitespace-lagging)
    // block DOM back over the just-committed source.
    this.suppressProjectionInput = true
  }

  projectionInput(event: DocumentProjectionEvent): void {
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
      markStage("key-input-start")
      const blockId = ((event.target as Element).closest?.("[data-editor-block-id]") as HTMLElement | null | undefined)?.dataset.editorBlockId
      const region = this.regionForBlock(blockId)
      if (region && region.kind !== "code") {
        this.blockFragments(blockId).forEach((fragment) => this.deps.renderInlineMath(fragment))
      }
      markStage("key-input-end")
      return
    }
    if (!this.editorController || this.updatingProjection) return

    const blockElement = (event.target as Element).closest?.("[data-editor-block-id]")
    if (!blockElement || !this.canEditBlock(blockElement)) return
    const block = this.map?.slides?.flatMap((slide) => slide.blocks || []).find((candidate) => candidate.id === (blockElement as HTMLElement).dataset.editorBlockId)
    const region = this.map?.editable_regions?.find((candidate) => candidate.block_id === block?.id)
    if (!block || !region) return

    const from = region.content_range.start
    const to = region.content_range.end
    this.pendingProjectionEdits ||= new Map()
    const pending = this.pendingProjectionEdits.get(region.id)
    const currentSource = pending?.source ?? this.editorController.value.slice(from, to)
    this.pendingProjectionEdits.set(region.id, {
      from,
      to,
      source: currentSource,
      kind: region.kind,
      blockId: block.id,
      blockElement
    })
    this.scheduleProjectionFlush()
  }

  captureCaret(): { blockId: string; sourceOffset: number } | null {
    const selection = window.getSelection()
    const focusNode = selection?.focusNode ?? null
    const container = focusNode
      ? (focusNode.nodeType === Node.ELEMENT_NODE ? focusNode : focusNode.parentElement) as Element | null
      : null
    const block = container?.closest?.("[data-editor-block-id]") as HTMLElement | null | undefined
    const current: { blockId: string | undefined; visibleOffset: number | null | undefined } | undefined = block && this.projectionTarget?.contains(block)
      ? { blockId: block.dataset.editorBlockId, visibleOffset: this.visibleOffsetInBlockGroup(block, focusNode, selection?.focusOffset ?? 0) }
      : this.lastProjectionCaret
    if (!current || current.visibleOffset == null) return null

    const region = this.regionForBlock(current.blockId)
    if (!region) return null
    const editor = this.editorController
    if (!editor) return null
    const source = editor.value.slice(region.content_range.start, region.content_range.end)
    const activeDisplayMath = container?.closest?.(".editor-math-active.editor-live-math-display")
    if (focusNode && activeDisplayMath && source === activeDisplayMath.textContent) {
      const offset = this.deps.visibleOffsetAtPoint(activeDisplayMath, focusNode, selection?.focusOffset ?? 0)
      if (offset !== null) {
        return { blockId: current.blockId ?? "", sourceOffset: region.content_range.start + offset }
      }
    }
    // Active math shows literal source, but the map models math as
    // zero-width: without this branch every in-span caret reads as
    // the match end, corrupting the engine caret on every selection
    // sync. Verified pairing refuses stale spans (falls through below).
    // Display spans pair here too: the whole-slice branch above only
    // covers blocks that are a single equation.
    const activeInlineMath = container?.closest?.(".editor-math-active")
    if (focusNode && activeInlineMath) {
      const match = mathMatchForSpan(this.blockFragments(current.blockId), source, activeInlineMath)
      if (match) {
        const offset = this.deps.visibleOffsetAtPoint(activeInlineMath, focusNode, selection?.focusOffset ?? 0)
        if (offset !== null) {
          return { blockId: current.blockId ?? "", sourceOffset: region.content_range.start + match.start + offset }
        }
      }
    }

    // DOM-grounded read first: the block DOM can lead the engine by
    // whitespace the source trimmed or folded, which the canonical map
    // cannot see and clamps to the wrong boundary (a mis-synced engine
    // caret then corrupts the next shorthand decision). The aligner
    // declines genuinely divergent text, which falls back to the map.
    const fragments = this.blockFragments(current.blockId)
    const aligned = fragments.length > 0
      ? alignVisibleOffset(source, fragments.map((fragment) => visibleBlockText(fragment)).join(""), current.visibleOffset)
      : null
    return {
      blockId: current.blockId ?? "",
      sourceOffset: region.content_range.start + (aligned ?? this.deps.sourceOffsetForVisibleOffset(source, current.visibleOffset))
    }
  }

  // Pure source-to-DOM point mapping shared by collapsed and ranged
  // restores: region resolution, DOM-grounded placement with map
  // fallback, and the math-END bypass. No focus, selection, or pending
  // side effects; unmappable offsets (concealed syntax, missing text)
  // return null so callers degrade to the collapsed head.
  selectionPointForSourceOffset(sourceOffset: number, preferredBlockId: string | null = null): { element: HTMLElement; node: Node; offset: number; visibleOffset: number; blockId: string } | null {
    if (!this.hasProjectionTarget || !this.editorController) return null
    const regions = this.allRegions().filter((region) => region.editable)
    const region = regions.find((candidate) => candidate.block_id === preferredBlockId) ||
      regions.find((candidate) => sourceOffset >= candidate.content_range.start && sourceOffset <= candidate.content_range.end) ||
      regions.reduce((closest, candidate) => {
        if (!closest) return candidate
        const distance = Math.min(Math.abs(sourceOffset - candidate.content_range.start), Math.abs(sourceOffset - candidate.content_range.end))
        const closestDistance = Math.min(Math.abs(sourceOffset - closest.content_range.start), Math.abs(sourceOffset - closest.content_range.end))
        return distance < closestDistance ? candidate : closest
      }, null as DocumentEditorRegion | null)
    if (!region) return null

    const source = this.editorController.value.slice(region.content_range.start, region.content_range.end)
    const blocks = this.blockFragments(region.block_id)
    const relative = sourceOffset - region.content_range.start
    // DOM-grounded placement first: the block DOM can lead the engine by
    // whitespace the source trimmed (a just-typed edge space), which the
    // canonical map cannot see. The aligner declines concealed syntax
    // and missing text, which fall back to the map below.
    const fragmentTexts = blocks.map((fragment) => visibleBlockText(fragment))
    const aligned = alignSourceOffset(source, fragmentTexts.join(""), relative)
    let visibleOffset: number
    let block: Element | undefined
    if (aligned !== null) {
      let remaining = aligned
      block = blocks.at(-1)
      for (let index = 0; index < blocks.length; index += 1) {
        const length = fragmentTexts[index]?.length ?? 0
        const candidate = blocks[index]
        if (!candidate) continue
        if (remaining <= length) {
          block = candidate
          break
        }
        remaining -= length
      }
      visibleOffset = remaining
    } else {
      visibleOffset = this.deps.visibleOffsetForSourceOffset(source, relative)
      block = blocks.at(-1)
      for (const candidate of blocks) {
        const length = this.visibleTextLength(candidate)
        if (visibleOffset <= length) {
          block = candidate
          break
        }
        visibleOffset -= length
      }
    }
    if (!block) return null
    // Math END boundaries bypass the map: it models math as zero-width,
    // so at block end (or inside an active span, which shows source) the
    // mapped point lands before the atom instead of after it. Verified
    // pairing refuses stale spans and falls through to the map below.
    const mathPoint = mathEndPlacement(blocks, source, sourceOffset - region.content_range.start)
    if (mathPoint) {
      const fragment = mathPoint.fragment as HTMLElement
      let preceding = 0
      for (const candidate of blocks) {
        if (candidate === mathPoint.fragment) break
        preceding += this.visibleTextLength(candidate)
      }
      const local = this.deps.visibleOffsetAtPoint(fragment, mathPoint.node, mathPoint.offset) ?? visibleOffset
      return { element: fragment, node: mathPoint.node, offset: mathPoint.offset, visibleOffset: preceding + local, blockId: region.block_id ?? "" }
    }
    const point = this.deps.pointAtVisibleOffset(block, visibleOffset)
    return { element: block as HTMLElement, node: point[0], offset: point[1], visibleOffset, blockId: region.block_id ?? "" }
  }

  restoreCaret(sourceOffset: number, preferredBlockId: string | null = null): boolean {
    if (!this.hasProjectionTarget || !this.editorController) return false
    const point = this.selectionPointForSourceOffset(sourceOffset, preferredBlockId)
    if (!point) return false
    if (point.element.contentEditable !== "true") {
      if (this.element.previewController?.projectionFresh === false) this.pendingCaretRestore = { sourceOffset, preferredBlockId }
      return false
    }
    const region = this.allRegions().find((candidate) => candidate.block_id === point.blockId)
    const inlinePoint = region ? this.deps.inlinePointForSourceOffset(
      this.blockFragments(point.blockId),
      this.editorController.value.slice(region.content_range.start, region.content_range.end),
      sourceOffset - region.content_range.start,
    ) : null
    point.element.focus({ preventScroll: true })
    window.getSelection()?.setPosition(inlinePoint?.[0] ?? point.node, inlinePoint?.[1] ?? point.offset)
    this.lastProjectionCaret = { blockId: point.blockId, visibleOffset: point.visibleOffset }
    return true
  }

  // Paints a ranged engine selection (Vim visual) on the rendered text:
  // both ends map through the same point machinery as the caret, so a
  // range across blocks or pages lands natively and the reveal sync
  // below exposes the syntax it touches. Either end unmappable or
  // uneditable aborts (the collapsed head placed first still shows).
  restoreSelection(anchorSourceOffset: number, headSourceOffset: number, preferredBlockId: string | null = null): boolean {
    if (!this.hasProjectionTarget || !this.editorController) return false
    const anchor = this.selectionPointForSourceOffset(anchorSourceOffset, preferredBlockId)
    const head = this.selectionPointForSourceOffset(headSourceOffset, preferredBlockId)
    if (!anchor || !head) return false
    if (anchor.element.contentEditable !== "true" || head.element.contentEditable !== "true") return false
    head.element.focus({ preventScroll: true })
    window.getSelection()?.setBaseAndExtent(anchor.node, anchor.offset, head.node, head.offset)
    this.lastProjectionCaret = { blockId: head.blockId, visibleOffset: head.visibleOffset }
    this.deps.syncActiveMath(this.projectionTarget, () => this.flushPendingProjectionEdits())
    this.deps.syncActiveInline(this.projectionTarget, (block) => this.inlineRevealSource(block), () => this.flushPendingProjectionEdits())
    return true
  }

  // Repaints every engine selection range on the rendered text: the native
  // selection owns the primary range, and the overlay paints the rest (plus
  // a same-highlight duplicate of the primary, which is invisible). A
  // single range clears the layer. Ends map through the same point
  // machinery as the caret, so unmappable ends skip individually.
  restoreSelections(): void {
    const root = this.projectionTarget
    const editor = this.editorController
    if (!this.element || !root || !editor) return
    if (this.element.dataset.editorMode === "source") {
      paintProjectionSelections(root, [], () => null)
      return
    }
    paintProjectionSelections(root, editor.selectionRanges ?? [], (sourceOffset) => {
      const point = this.selectionPointForSourceOffset(sourceOffset)
      return point ? { node: point.node, offset: point.offset } : null
    })
  }

  flushPendingProjectionEdits(): void {
    if (this.pendingProjectionFrame) cancelAnimationFrame(this.pendingProjectionFrame)
    this.pendingProjectionFrame = undefined
    if (!this.pendingProjectionEdits?.size || !this.editorController) return

    markStage("key-flush-start")
    const pending = [...this.pendingProjectionEdits.values()]
    const current = this.editorController.value
    const edits = pending.map((edit) => {
      const region = this.regionForBlock(edit.blockId)
      const blockElement = this.combinedBlockForId(edit.blockId) || edit.blockElement
      return {
        ...edit,
        from: region?.content_range.start ?? edit.from,
        to: region?.content_range.end ?? edit.to,
        blockElement,
        replacement: this.deps.markdownForVisibleText(
          edit.source,
          this.editableText(blockElement, edit.kind, edit.source),
          edit.kind,
          blockElement,
          { documentMode: this.kind === "document" }
        )
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
        if (edit.kind === "code") return
        const blockElement = this.combinedBlockForId(edit.blockId) || edit.blockElement
        if (blockElement) this.blockFragments(edit.blockId).forEach((fragment) => this.deps.renderInlineMath(fragment))
      })
      this.syncEngineSelectionFromCaret()
      this.lastRevealSyncBlockId = null
      this.lastRevealSyncSpan = null
      markStage("key-flush-end")
      return
    }

    edits.forEach((edit) => {
      if (edit.kind === "code") return
      this.blockFragments(edit.blockId).forEach((fragment) => this.deps.renderInlineMath(fragment))
    })
    const changes = edits.map((edit) => ({ from: edit.from, to: edit.to, insert: edit.replacement }))
      .sort((left, right) => left.from - right.from)
    edits.sort((left, right) => right.from - left.from).forEach((edit) => {
      this.shiftMapAfterEdit(edit.from, edit.to, edit.replacement.length, edit.blockId)
    })
    this.editorController.replaceRanges(changes)
    this.syncEngineSelectionFromCaret()
    // The commit may have revealed, concealed, or moved spans: reset the
    // reveal-sync throttle key so the next caret observation re-syncs once.
    this.lastRevealSyncBlockId = null
    this.lastRevealSyncSpan = null
    markStage("key-flush-end")
  }

  scheduleProjectionFlush(): void {
    if (this.pendingProjectionFrame) return
    this.pendingProjectionFrame = requestAnimationFrame(() => {
      this.pendingProjectionFrame = undefined
      this.flushPendingProjectionEdits()
    })
  }

  rememberProjectionCaret(): void {
    const selection = window.getSelection()
    if (!selection?.focusNode) {
      // No caret to track, but spans may still need deactivating.
      this.deps.syncActiveMath(this.projectionTarget, () => this.flushPendingProjectionEdits())
      this.deps.syncActiveInline(this.projectionTarget, (block) => this.inlineRevealSource(block), () => this.flushPendingProjectionEdits())
      this.lastRevealSyncBlockId = null
      this.lastRevealSyncSpan = null
      return
    }
    const focusNode = selection.focusNode
    const node = (focusNode.nodeType === Node.ELEMENT_NODE ? focusNode : focusNode.parentElement) as Element | null
    const block = node?.closest?.("[data-editor-block-id]")
    if (!block || !this.projectionTarget?.contains(block)) {
      // No projection caret: still give spans a chance to deactivate, then
      // reset the key so re-entering re-syncs.
      this.deps.syncActiveMath(this.projectionTarget, () => this.flushPendingProjectionEdits())
      this.deps.syncActiveInline(this.projectionTarget, (block) => this.inlineRevealSource(block), () => this.flushPendingProjectionEdits())
      this.lastRevealSyncBlockId = null
      this.lastRevealSyncSpan = null
      return
    }
    const blockId = (block as HTMLElement).dataset.editorBlockId ?? ""
    const activeSpan = node?.closest?.(".editor-math-active, .editor-inline-active") ?? null
    if (blockId !== this.lastRevealSyncBlockId || activeSpan !== this.lastRevealSyncSpan) {
      this.deps.syncActiveMath(this.projectionTarget, () => this.flushPendingProjectionEdits())
      this.deps.syncActiveInline(this.projectionTarget, (block) => this.inlineRevealSource(block), () => this.flushPendingProjectionEdits())
      this.lastRevealSyncBlockId = blockId
      this.lastRevealSyncSpan = activeSpan
    }
    const visibleOffset = this.visibleOffsetInBlockGroup(block, selection.focusNode, selection.focusOffset)
    if (visibleOffset === null) return
    this.lastProjectionCaret = { blockId: (block as HTMLElement).dataset.editorBlockId ?? "", visibleOffset }
    if ((block as HTMLElement).contentEditable === "true") this.syncEngineSelectionFromCaret()
  }

  // Input-bridge selection leg: while an editable block carries the native
  // caret, the engine selection tracks it, so Vim state, history context,
  // and completion anchors follow visual editing instead of going stale.
  // Typing paths skip here (their source is mid-edit) and sync after the
  // flush commits; ranged drag selections stay projection-side until the
  // drag-translation increment lands.
  syncEngineSelectionFromCaret(): void {
    const editor = this.editorController
    if (!editor || this.pendingProjectionEdits?.size) return
    // A Vim visual range lives on the engine; the projection only ever shows
    // its head, so syncing a collapsed native caret back must not clobber it.
    if (editor.vimEnabled && !editor.insertMode && editor.selectionStart !== editor.selectionEnd) return
    const selection = window.getSelection()
    if (!selection?.isCollapsed || !selection.focusNode) return
    const focusNode = selection.focusNode
    const node = (focusNode.nodeType === Node.ELEMENT_NODE ? focusNode : focusNode.parentElement) as Element | null
    const block = node?.closest?.("[data-editor-block-id]")
    if (!block || !this.projectionTarget?.contains(block)) return
    if ((block as HTMLElement).contentEditable !== "true") return
    const caret = this.captureCaret()
    if (!caret) return
    if (editor.selectionStart === caret.sourceOffset && editor.selectionEnd === caret.sourceOffset) return
    editor.setSelectionRange(caret.sourceOffset, caret.sourceOffset)
  }

  blockMarkdown(blockElement: Element, region: DocumentEditorRegion, block: DocumentEditorBlock, source: string): { markdown: string; kind: string; start: number; end: number } {
    const { start, end } = region.content_range
    const sourceMarkdown = source.slice(start, end)
    const visibleMarkdown = block.empty_placeholder ? this.editableText(blockElement, region.kind, sourceMarkdown) : ""
    const markdown = block.empty_placeholder && sourceMarkdown === "" ? visibleMarkdown : sourceMarkdown
    const kind = this.currentBlockKind(markdown, this.currentBlockKind(visibleMarkdown, region.kind))
    return { markdown, kind, start, end }
  }

  blockKeydown(event: DocumentProjectionKeyEvent): void {
    if (event.defaultPrevented) return
    if (this.pendingProjectionFrame || this.pendingProjectionEdits?.size) {
      this.flushPendingProjectionEdits()
    }
    if (this.deps.handleMathKeydown(event, this.projectionTarget, () => this.flushPendingProjectionEdits())) return
    if (this.deps.moveCaretBetweenBlocks(event, this.projectionTarget)) return
    if (!["Backspace", "Delete"].includes(event.key)) return

    const selection = window.getSelection()
    if (!selection?.isCollapsed) return
    const focusNode = selection.focusNode
    const node = focusNode
      ? (focusNode.nodeType === Node.ELEMENT_NODE ? focusNode : focusNode.parentElement) as Element | null
      : null
    const blockElement = node?.closest?.("[data-editor-block-id][contenteditable='true']")
    if (!blockElement || !this.projectionTarget?.contains(blockElement) || this.editableText(blockElement).trim() !== "") return

    const block = this.map?.slides?.flatMap((slide) => slide.blocks || [])
      .find((candidate) => candidate.id === (blockElement as HTMLElement).dataset.editorBlockId)
    const region = this.regionForBlock((blockElement as HTMLElement).dataset.editorBlockId)
    if (!block || !region || region.role === "title" || ["list", "quote"].includes(region.kind)) return
    if (blockElement.querySelector("img, video, iframe, [data-editor-math-source]")) return

    event.preventDefault()
    this.flushPendingProjectionEdits()
    const editor = this.editorController
    const source = editor.value
    const { markdown, kind } = this.blockMarkdown(blockElement, region, block, source)

    if (this.removeEmptyBlock(blockElement, block, region, kind, markdown, source)) {
      return
    }

    const { from, to } = this.blockSourceRange(block)
    const updated = this.deps.removeEmptyBlockSource(source, from, to)
    if (updated === source) return
    this.pendingCaret = { sourceOffset: Math.min(from, updated.length), location: "block_end", sourceLength: updated.length }
    void editor.commitSource(updated)
  }

  allRegions(): Array<DocumentEditorRegion> {
    return this.map?.editable_regions || this.map?.slides?.flatMap((slide) => slide.editable_regions || []) || []
  }

  regionForBlock(blockId: string | undefined): DocumentEditorRegion | null {
    return this.allRegions().find((region) => region.block_id === blockId) || null
  }

  inlineRevealSource(block: Element): string | null {
    const blockId = (block as HTMLElement).dataset.editorBlockId
    const region = this.regionForBlock(blockId)
    if (!region || !this.editorController) return null
    // Table and image blocks route to dedicated differs without
    // inline-reveal projection. Fenced code keeps its source: inline
    // pairing safe-refuses inside pre (elements excluded), while the
    // structural pass needs the source for fence delimiters.
    if (["table", "image"].includes(region.kind ?? "")) return null
    const value = this.editorController.value
    // Heading regions exclude the marker prefix; extend to the block
    // start so structural markers resolve (leading # never tokenizes,
    // so inline pairing is unaffected).
    if (region.kind === "heading") {
      const start = this.map?.slides?.flatMap((slide) => slide.blocks || []).find((candidate) => candidate.id === blockId)?.range.start
      if (typeof start === "number" && start < region.content_range.start) {
        return value.slice(start, region.content_range.end)
      }
    }
    return value.slice(region.content_range.start, region.content_range.end)
  }

  blockSourceRange(block: DocumentEditorBlock): { from: number; to: number } {
    const slide = this.map?.slides?.find((candidate) => candidate.blocks?.some((item) => item.id === block.id))
    // Shared span math (F6); fall back to the block range when the block is
    // not on any slide, exactly as the previous hand-rolled version did.
    return blockOperationRange(block, slide) ?? { from: block.range.start, to: block.range.end }
  }

  restoreProjectionCaret(): void {
    const pending = this.pendingCaretRestore
    if (!pending || this.element.dataset.editorMode !== "visual") return
    this.pendingCaretRestore = null
    requestAnimationFrame(() => {
      this.restoreCaret(pending.sourceOffset, pending.preferredBlockId)
      this.restoreSelections()
    })
  }

  // Visual assist pipeline (session/projection_assist): a suggestion accept
  // committed [from, to) -> insert to the engine while this projection holds
  // focus. Shift the map, patch the caret text in place, and stage caret
  // restoration for the deferred reinstall. Returns whether the DOM patch landed.
  applyVisualAssistInsert(edit: AssistInsertEdit, selection?: Selection | null): boolean {
    return applyVisualAssistInsert({
      projectionTarget: this.projectionTarget ?? null,
      allRegions: () => this.allRegions(),
      shiftMapAfterEdit: (from, to, length, blockId) => this.shiftMapAfterEdit(from, to, length, blockId),
      stageCaretRestore: (restore) => { this.pendingCaretRestore = restore }
    }, edit, selection)
  }

  syncActiveMathAfterCaretMove(): void {
    this.deps.syncActiveMath(this.projectionTarget ?? null, () => {})
  }

  // Shared visual key routing (session/projection_keys); documents and
  // presentations execute identical behavior through these delegates.
  routeVimKey(event: DocumentProjectionKeyEvent, blockElement: Element): boolean {
    return routeProjectionVimKey(this, event, blockElement)
  }

  routeKeymapKey(event: DocumentProjectionKeyEvent, blockElement: Element): boolean {
    return routeProjectionKeymapKey(this, event, blockElement)
  }

  projectionKeydown(event: DocumentProjectionKeyEvent): void {
    if (event.defaultPrevented) return
    if (this.kind !== "document" || event.isComposing) return

    const blockElement = (event.target as Element).closest?.(".document-editor-block[data-editor-block-id]")
    if (!blockElement) return
    // Engine-routed keys act on engine state and defer caret restoration
    // while stale, so they run even when the projection is refreshing;
    // dropping them would swallow Vim motions, Tab, and undo after every
    // edit. Structural handlers below stay behind the freshness gate.
    if (this.routeVimKey(event, blockElement)) return
    if (this.routeKeymapKey(event, blockElement)) return
    if (!this.canEditBlock(blockElement)) return
    if (event.altKey || event.ctrlKey || event.metaKey) return
    this.deps.finishMathBeforeEnter(event, this.projectionTarget, () => this.flushPendingProjectionEdits())

    const block = this.map?.slides?.flatMap((slide) => slide.blocks || [])
      .find((candidate) => candidate.id === (blockElement as HTMLElement).dataset.editorBlockId)
    const region = this.map?.editable_regions?.find((candidate) => candidate.block_id === block?.id)
    if (!block || !region) return

    const source = this.editorController.value
    const { markdown, kind, start, end } = this.blockMarkdown(blockElement, region, block, source)
    const emptyListItem = kind === "list" && this.hasEmptyTrailingMarker(markdown, "list")
    const emptyQuoteLine = kind === "quote" && this.hasEmptyTrailingMarker(markdown, "quote")

    if (["Backspace", "Delete"].includes(event.key)) {
      if (region.role === "title" && markdown.trim() === "") {
        event.preventDefault()
        return
      }
      if ((emptyListItem || emptyQuoteLine) && !this.selectionIsInEmptyStructuredLine(blockElement, kind)) return
      if (this.removeEmptyBlock(blockElement, block, region, kind, markdown, source)) event.preventDefault()
      return
    }
    if (event.key !== "Enter" || event.shiftKey) return

    const openingCodeFence = kind === "code"
      ? markdown.match(/^([ \t]*)(`{3,}|~{3,})([^\r\n]*)$/)
      : null
    const openingMathFence = kind === "paragraph"
      ? markdown.match(/^([ \t]{0,3})(\$\$|\\\[)[ \t]*$/)
      : null
    // An empty display pair with the caret between the fences (the
    // shorthand's promote leaves it here): split into opener, blank
    // body, closer like an opener, reusing the explicit active span
    // (offset mapping cannot express the empty middle line).
    const emptyDisplayPair = kind === "paragraph"
      ? markdown.match(/^([ \t]{0,3})\$\$[ \t]*\$\$[ \t]*$/)
      : null
    if (emptyDisplayPair) {
      const pairIndentation = emptyDisplayPair[1] ?? ""
      const caret = this.sourceOffsetForSelection(blockElement, markdown)
      if (caret === pairIndentation.length + 2) {
        event.preventDefault()
        const pairLineEnding = source.match(/\r\n|\r|\n/)?.[0] || "\n"
        const pairReplacement = pairIndentation + "$$" + pairLineEnding + pairLineEnding + pairIndentation + "$$"
        this.replaceAndEnterDisplayMath(blockElement, start, end, pairReplacement, pairIndentation, "$$", "$$", pairLineEnding)
        return
      }
    }
    if (openingCodeFence || openingMathFence) {
      if (!this.selectionIsAtEnd(blockElement)) return

      event.preventDefault()
      const [, indentation = "", marker = ""] = (openingCodeFence || openingMathFence) ?? []
      const closingMarker = openingCodeFence
        ? marker
        : marker === "$$" ? "$$" : "\\]"
      const lineEnding = source.match(/\r\n|\r|\n/)?.[0] || "\n"
      const replacement = markdown + lineEnding + lineEnding + indentation + closingMarker
      if (openingMathFence) {
        const [, indentation = ""] = openingMathFence
        const open = openingMathFence[2] ?? ""
        const close = open === "$$" ? "$$" : "\\]"
        this.replaceAndEnterDisplayMath(blockElement, start, end, replacement, indentation, open, close, lineEnding)
      } else {
        this.replaceAndFocus(blockElement, start, end, replacement, { sourceOffset: start + markdown.length + lineEnding.length, location: "block_end" })
      }
      return
    }

    const atEnd = this.selectionIsAtEnd(blockElement)
    const rawStructuredBlock = (kind === "list" && !blockElement.querySelector("ul, ol")) ||
      (kind === "quote" && !blockElement.querySelector("blockquote"))
    const rawStructuredCaret = rawStructuredBlock && this.selectionIsInsideBlock(blockElement)
    if (emptyListItem || emptyQuoteLine) {
      if (!this.selectionIsInEmptyStructuredLine(blockElement, kind) && !atEnd && !rawStructuredCaret) return
    }

    event.preventDefault()
    if (kind === "list" || kind === "quote") {
      this.continueStructuredBlock(blockElement, region, kind, markdown, source, emptyListItem || emptyQuoteLine)
    } else {
      // At a logical block end, fragment/visible-text offset reconstruction
      // can lose the contribution from earlier page fragments. The source
      // boundary is exact in this case and avoids splitting in the wrong page.
      const localOffset = atEnd ? markdown.length : this.sourceOffsetForSelection(blockElement, markdown)
      const splitOffset = localOffset === null ? markdown.length : Math.min(localOffset, markdown.length)
      const before = markdown.slice(0, splitOffset).replace(/[ \t]+$/, "")
      const after = markdown.slice(splitOffset).replace(/^[ \t]+/, "")
      const replacement = `${before}\n\n${after}`
      this.replaceAndFocus(blockElement, start, end, replacement, {
        sourceOffset: start + before.length + 2,
        location: "empty_block"
      })
    }
  }

  alignmentChanged(event: DocumentProjectionEvent): void {
    const control = (event.target as Element).closest?.("[data-visual-editor-block-id]") as HTMLSelectElement | null | undefined
    if (!control) return
    control.closest(".document-block-position-control")?.classList.remove("is-open")
    if (!this.editorController || this.element.dataset.editorMode !== "visual" || !this.map) return

    this.flushPendingProjectionEdits()
    const map = this.map
    if (!map) return
    const blockId = control.dataset.visualEditorBlockId
    const block = map.slides?.flatMap((slide) => slide.blocks || []).find((candidate) => candidate.id === blockId)
    if (!block || !["", "left", "center", "right"].includes(control.value)) return

    const source = this.editorController.value
    const slide = map.slides?.find((candidate) => candidate.blocks?.some((item) => item.id === block.id))
    if (!slide) return
    const directive = slide?.directives?.find((candidate) => candidate.id === block.position_directive_id)

    const horizontal = control.value
    if (!horizontal) {
      if (!directive) return

      const ranges = [directive.range]

      const caret = this.captureCaret()
      const region = this.regionForBlock(block.id)
      let sourceOffset = caret?.blockId === block.id
        ? caret.sourceOffset
        : (region?.content_range.start ?? block.range.start)
      let updated = source
      ranges.sort((left, right) => right.start - left.start).forEach((range) => {
        const excised = exciseRange(updated, range)
        const next = excised.updated
        if (range.start < sourceOffset) sourceOffset += next.length - updated.length
        this.shiftMapAfterEdit(range.start, excised.to, 0)
        updated = next
      })

      delete block.position_directive_id
      delete block.position
      slide.directives = (slide.directives ?? []).filter((candidate) => !ranges.includes(candidate.range))

      if (updated === source) return
      this.pendingCaretRestore = { sourceOffset, preferredBlockId: block.id }
      void this.editorController.commitSource(updated)
      return
    }

    if (!["left", "center", "right"].includes(horizontal)) return
    if (directive && (block.position?.horizontal || "left") === horizontal) return

    const caret = this.captureCaret()
    const region = this.regionForBlock(block.id)
    const sourceOffset = caret?.blockId === block.id
      ? caret.sourceOffset
      : (region?.content_range.start ?? block.range.start)
    let from: number
    let to: number
    let replacement: string
    if (directive) {
      from = directive.range.start
      to = directive.range.end
      const span = directiveLineSpan(source, from, to)
      to = span.to
      const lineEnding = span.lineEnding
      const vertical = block.position?.vertical_explicit ? block.position.vertical : null
      replacement = `:::align{${vertical ? `${vertical} ` : ""}${horizontal}}${lineEnding}`
    } else {
      from = block.range.start
      to = from
      const inserted = insertAlignDirective(source, from, `:::align{${horizontal}}`)
      replacement = inserted.replacement
    }

    const delta = replacement.length - (to - from)
    this.pendingCaretRestore = {
      sourceOffset: sourceOffset >= to ? sourceOffset + delta : sourceOffset,
      preferredBlockId: block.id
    }
    this.shiftMapAfterEdit(from, to, replacement.length, directive ? null : block.id)
    if (!directive) {
      const region = this.regionForBlock(block.id)
      const affected = [block, region].filter((item): item is DocumentEditorBlock | DocumentEditorRegion => Boolean(item))
      affected.forEach((object) => {
        (["range", "source_range", "content_range", "delimiter_range"] as const).forEach((name) => {
          const range = object[name]
          if (range?.start === from) range.start += replacement.length
        })
      })
      const lineEnding = source.match(/\r\n|\r|\n/)?.[0] || "\n"
      const directiveLength = `:::align{${horizontal}}${lineEnding}`.length
      const directiveId = `directive-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`
      const newDirective: DocumentEditorDirective = {
        id: directiveId,
        type: "position",
        range: { start: from, end: from + directiveLength },
        source_range: { start: from, end: from + directiveLength }
      }
      slide.directives ||= []
      slide.directives.push(newDirective)
      map.directives ||= []
      map.directives.push(newDirective)
      block.position_directive_id = directiveId
      block.position = { horizontal, vertical: "top", vertical_explicit: false }
    } else {
      directive.range.end = from + replacement.length
      directive.source_range.end = directive.range.end
      block.position = {
        ...(block.position || {}),
        horizontal
      }
    }

    const updated = `${source.slice(0, from)}${replacement}${source.slice(to)}`
    void this.editorController.commitSource(updated)
  }

  positionControlOpened(event: DocumentProjectionEvent): void {
    // Pin the hover-only trigger even if the native select temporarily loses focus.
    ;(event.target as Element).closest?.(".document-block-position-control")?.classList.add("is-open")
  }

  positionControlKeydown(event: DocumentProjectionKeyEvent): void {
    if (!["Escape", "Tab"].includes(event.key)) return

    ;(event.target as Element).closest?.(".document-block-position-control")?.classList.remove("is-open")
  }

  previewUpdated(payload: { editor_map?: DocumentEditorMap } | null | undefined): void {
    if (payload?.editor_map) this.map = payload.editor_map
    // The reinstall replaced the DOM under the cached key: reset it so the
    // next caret observation re-syncs against the fresh tree.
    this.lastRevealSyncBlockId = null
    this.lastRevealSyncSpan = null
    this.syncProjectionEditability({ preserveActive: Boolean(this.focusedProjectionBlock()) })
    this.restorePendingCaret()
    this.restoreProjectionCaret()
    this.focusNewDocumentTitle()
  }

  previewStale(detail: { preserveActive?: boolean } = {}): void {
    // T1 fast path: while a projection block holds DOM focus, only that
    // block's editability is observable — every other block keeps its
    // last-synced state until blur reinstalls and re-syncs fully. This
    // keeps the first keystroke after focusing a block off the O(blocks)
    // sweep (measured 400-850ms inside replaceRange on 100-page fixtures).
    const active = this.focusedProjectionBlock()
    if (this.element.dataset.editorMode !== "source" && active) {
      this.deps.setProjectionBlockEditable(active, true, "Editable Markdown block")
      return
    }
    this.syncProjectionEditability({ preserveActive: detail.preserveActive || Boolean(active) })
  }

  canEditBlock(blockElement: Element): boolean {
    if (this.element.dataset.editorMode !== "visual") return false
    if (this.element.previewController?.projectionFresh !== false) return true

    return this.focusedProjectionBlock() === blockElement
  }

  focusedProjectionBlock(): Element | null {
    const block = document.activeElement?.closest?.(".document-editor-block[data-editor-block-id]")
    return block && this.hasProjectionTarget && this.projectionTarget?.contains(block) ? block : null
  }

  syncProjectionEditability({ preserveActive = false }: { preserveActive?: boolean | undefined } = {}): void {
    const projection = this.projectionTarget
    if (!projection) return

    markStage("editability-sync-start")
    const visual = this.element.dataset.editorMode !== "source"
    const fresh = this.element.previewController?.projectionFresh !== false
    const active = preserveActive ? document.activeElement?.closest?.("[data-editor-block-id]") : null
    projection.querySelectorAll(".document-editor-block[data-editor-block-id]").forEach((block) => {
      const editable = visual && (fresh || (preserveActive && block === active))
      this.deps.setProjectionBlockEditable(block, editable, "Editable Markdown block")
    })
    projection.querySelectorAll("[data-visual-editor-block-id]").forEach((control) => {
      const target = control as HTMLSelectElement
      const disabled = !visual || !this.map
      if (target.disabled !== disabled) target.disabled = disabled
    })
    markStage("editability-sync-end")
  }

  shiftMapAfterEdit(from: number, to: number, replacementLength: number, editedBlockId: string | null = null): void {
    if (!this.map) return

    const delta = replacementLength - (to - from)
    const shiftRange = (range: DocumentEditorRange | null | undefined, editedBlock: boolean): void => {
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
    const shiftObject = (object: DocumentShiftable | null | undefined): void => {
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

  readMap(): DocumentEditorMap | null {
    const source = this.element.querySelector("[data-editor-map-json]")?.textContent
    if (!source) return null
    try {
      return JSON.parse(source)
    } catch (_error) {
      return null
    }
  }

  editableText(element: Element, kind?: string, source = ""): string {
    // NBSP is preserved (not canonicalized): the browser mints NBSP for a
    // typed space beside another space, and the differ reads NBSP runs as
    // just-typed width evidence. Canonicalization happens at diff time.
    element = this.combinedBlockElement(element)
    let value: string | undefined
    let structuredLines: Array<Element> | null | undefined
    if (kind === "list" && !element.querySelector("li li")) {
      structuredLines = [...element.querySelectorAll("li")]
      if (structuredLines.length) value = structuredLines.map((item) => ((item as HTMLElement).innerText || item.textContent || "").replace(/\n+$/, "")).join("\n")
    }

    if (value === undefined && kind === "quote") {
      const quote = element.querySelector("blockquote")
      structuredLines = quote && [...quote.children].filter((child) => /^(P|DIV)$/.test(child.tagName))
      if (structuredLines?.length) value = structuredLines.map((line) => ((line as HTMLElement).innerText || line.textContent || "").replace(/\n+$/, "")).join("\n")
    }

    if (value === undefined) {
      const blockChildren = [...element.children].filter((child) => /^(P|DIV|H[1-6])$/.test(child.tagName))
      value = blockChildren.length > 1
        ? blockChildren.map((child) => ((child as HTMLElement).innerText || child.textContent || "").replace(/\n+$/, "")).join("\n\n")
        : ((element as HTMLElement).innerText || element.textContent || "")
    }

    const lastLine = source.replace(/\r\n?/g, "\n").split("\n").at(-1) || ""
    const lastStructuredLine = structuredLines?.at(-1)
    const emptyStructuredLine = source.includes("\n") && lastStructuredLine &&
      ((lastStructuredLine as HTMLElement).innerText || lastStructuredLine.textContent || "").trim() === "" &&
      ((kind === "list" && /^[ \t]*(?:[-*+]|\d+[.)])[ \t]*$/.test(lastLine)) ||
        (kind === "quote" && /^[ \t]*>[ \t]*$/.test(lastLine)))
    if (emptyStructuredLine && !value.endsWith("\n")) value += "\n"
    return value
  }

  focusNewDocumentTitle(): void {
    const projection = this.projectionTarget
    if (!this.focusTitle || !projection || this.initialTitleFocusSettled) return

    if (this.initialTitleFocused) {
      const activeProjection = document.activeElement?.closest?.(".document-editor-block[data-editor-block-id]")
      if (activeProjection || (document.activeElement !== document.body && document.activeElement !== document.documentElement)) return
    }

    const heading = projection.querySelector(".document-editor-block h1")
    const block = heading?.closest(".document-editor-block[contenteditable='true']")
    if (!heading || !block) return

    this.initialTitleFocused = true
    this.focusAtEnd(block, heading)
  }

  currentBlockKind(markdown: string, fallback: string | null): string {
    const source = markdown.replace(/\r\n?/g, "\n")
    if (/^\s{0,3}#{1,6}(?:[ \t]+|[ \t]*$)/.test(source)) return "heading"
    if (/^\s*(?:[-*+] |\d+[.)] )/.test(source)) return "list"
    if (/^\s*>/.test(source)) return "quote"
    if (/^\s*(?:`{3,}|~{3,})/.test(source)) return "code"
    return fallback || "paragraph"
  }

  selectionIsAtEnd(element: Element): boolean {
    if (this.blockFragments((element as HTMLElement).dataset.editorBlockId).at(-1) !== element) return false
    const selection = window.getSelection()
    if (!selection?.isCollapsed || !selection.anchorNode || !element.contains(selection.anchorNode)) return false

    const remaining = document.createRange()
    remaining.selectNodeContents(element)
    remaining.setStart(selection.anchorNode, selection.anchorOffset)
    const fragment = remaining.cloneContents()
    return (fragment.textContent || "").replace(/[\u200b\ufeff\n]/g, "") === "" &&
      !fragment.querySelector("[data-editor-math-source], [data-editor-image-source], img")
  }

  selectionIsInEmptyStructuredLine(element: Element, kind: string): boolean {
    const lines = kind === "list"
      ? [...element.querySelectorAll("li")]
      : [...element.querySelectorAll("blockquote p, blockquote div")]
    const line = lines.at(-1)
    const selection = window.getSelection()
    if (!line || !selection?.isCollapsed || !element.contains(selection.anchorNode)) return false

    const text = (line as HTMLElement).innerText || line.textContent || ""
    return text.trim() === "" && (line === selection.anchorNode || line.contains(selection.anchorNode))
  }

  selectionIsInsideBlock(element: Element): boolean {
    const selection = window.getSelection()
    return Boolean(selection?.isCollapsed && selection.anchorNode && element.contains(selection.anchorNode))
  }

  sourceOffsetForSelection(element: Element, markdown: string): number | null {
    const selection = window.getSelection()
    if (!selection?.isCollapsed || !selection.anchorNode || !element.contains(selection.anchorNode)) return null

    const beforeCaret = document.createRange()
    beforeCaret.selectNodeContents(element)
    beforeCaret.setEnd(selection.anchorNode, selection.anchorOffset)
    const prefix = document.createElement("div")
    prefix.append(beforeCaret.cloneContents())
    const protectedElements = [...prefix.querySelectorAll("[data-editor-math-source], [data-editor-image-source]")]
    protectedElements.forEach((protectedElement, index) => {
      protectedElement.replaceWith(document.createTextNode(`\uE000${index.toString(36)}\uE001`))
    })
    prefix.setAttribute("aria-hidden", "true")
    prefix.contentEditable = "false"
    prefix.style.cssText = "position:fixed;left:-100000px;top:0;pointer-events:none;z-index:-1"
    const parent = element.parentElement || document.body
    parent.append(prefix)
    let visiblePosition: number
    try {
      visiblePosition = (prefix.innerText || prefix.textContent || "")
        .replace(/\u00a0/g, " ")
        .replace(/\n+$/, "")
        .replace(/[	\n\f\r ]+/g, " ").length
    } finally {
      prefix.remove()
    }

    const previousLength = this.blockFragments((element as HTMLElement).dataset.editorBlockId)
      .slice(0, this.blockFragments((element as HTMLElement).dataset.editorBlockId).indexOf(element))
      .reduce((sum, fragment) => sum + this.visibleTextLength(fragment), 0)
    return this.deps.sourceOffsetForVisiblePosition(markdown, this.combinedBlockElement(element), previousLength + visiblePosition)
  }

  replaceAndFocus(blockElement: Element, from: number, to: number, replacement: string, caret: { sourceOffset: number; location: string }): void {
    this.pendingCaret = { ...caret, sourceLength: this.editorController.value.length - (to - from) + replacement.length }
    this.shiftMapAfterEdit(from, to, replacement.length, (blockElement as HTMLElement).dataset.editorBlockId)
    this.editorController.replaceRange(replacement, from, to)
    ;(blockElement as HTMLElement).blur()
    // Structural edits reinstall immediately instead of waiting out the
    // typing debounce (which each subsequent keystroke resets). The blur
    // above lets the install proceed; the scoped pendingCaret lands the
    // caret when it arrives, and D2's guard drops it if newer input
    // superseded this transaction first. The host may be absent in tests.
    this.element?.previewController?.refreshNow?.()
  }

  replaceAndEnterDisplayMath(blockElement: Element, from: number, to: number, replacement: string, indentation: string, open: string, close: string, lineEnding: string): void {
    this.pendingCaret = null
    this.shiftMapAfterEdit(from, to, replacement.length, (blockElement as HTMLElement).dataset.editorBlockId)

    const content = blockElement.matches("[data-document-page-flow-content]")
      ? blockElement
      : blockElement.querySelector("[data-document-page-flow-content]") || blockElement
    let paragraph = content.querySelector(":scope > p")
    if (!paragraph) {
      paragraph = document.createElement("p")
      content.replaceChildren(paragraph)
    }

    const openingLength = indentation.length + open.length
    const source = replacement.slice(openingLength, replacement.length - indentation.length - close.length)
    const activeMath = this.deps.createActiveMathSpan(replacement, { source, open, close, display: true })
    paragraph.replaceChildren(activeMath)
    ;(blockElement as HTMLElement).focus({ preventScroll: true })
    const textNode = activeMath.firstChild
    if (!textNode || textNode.textContent === null) return
    const offset = Math.min(openingLength + lineEnding.length, textNode.textContent.length)
    window.getSelection()?.setBaseAndExtent(textNode, offset, textNode, offset)
    this.lastProjectionCaret = { blockId: (blockElement as HTMLElement).dataset.editorBlockId ?? "", visibleOffset: offset }

    // Install the source after the active DOM and selection are ready. The
    // preview's stale-projection handler then preserves this focused block,
    // while the shifted map lets the first typed character round-trip safely.
    this.editorController.replaceRange(replacement, from, to)
    this.editorController.setSelectionRange(from + offset)
  }

  continueStructuredBlock(blockElement: Element, region: DocumentEditorRegion, kind: string, markdown: string, source: string, emptyMarker: boolean): void {
    const marker = kind === "list"
      ? (markdown.match(/(?:^|\n)([ \t]*(?:[-*+]|\d+[.)])[ \t]+)[^\n]*$/)?.[1] || "- ")
      : (markdown.match(/(?:^|\n)([ \t]*>[ \t]?)[^\n]*$/)?.[1] || "> ")

    if (emptyMarker) {
      const lines = markdown.split("\n")
      const previousLines = lines.slice(0, -1)
      const from = region.content_range.start
      const to = region.content_range.end
      const eol = source.match(/\r\n|\r|\n/)?.[0] || "\n"
      const separator = `${eol}${eol}`
      const previousMarkdown = previousLines.join("\n")
      const replacement = previousLines.length ? `${previousMarkdown}${separator}` : ""
      const sourceOffset = from + previousMarkdown.length + (previousLines.length ? separator.length : 0)
      this.replaceAndFocus(blockElement, from, to, replacement, {
        sourceOffset,
        location: "empty_block"
      })
      return
    }

    const from = region.content_range.start
    const to = region.content_range.end
    const nextMarkdown = `${markdown}\n${marker}`
    const targetOffset = from + nextMarkdown.length
    this.replaceAndFocus(blockElement, from, to, nextMarkdown, {
      sourceOffset: targetOffset,
      location: kind === "list" ? "list_item_end" : "quote_line_end"
    })
  }

  hasEmptyTrailingMarker(markdown: string, kind: string): boolean {
    const lastLine = markdown.split("\n").at(-1) || ""
    return kind === "list"
      ? /^[ \t]*(?:[-*+]|\d+[.)])[ \t]*$/.test(lastLine)
      : /^[ \t]*>[ \t]*$/.test(lastLine)
  }

  removeEmptyBlock(blockElement: Element, block: DocumentEditorBlock, region: DocumentEditorRegion, kind: string, markdown: string, source: string): boolean {
    if (region.role === "title") return false

    const emptyListItem = kind === "list" && this.hasEmptyTrailingMarker(markdown, "list")
    const emptyQuoteLine = kind === "quote" && this.hasEmptyTrailingMarker(markdown, "quote")
    const emptyPlaceholder = block.empty_placeholder && markdown.trim() === ""
    if (!emptyListItem && !emptyQuoteLine && !emptyPlaceholder) return false

    const from = region.content_range.start
    const to = region.content_range.end
    let replacement = ""
    let sourceOffset = from
    let location = "block_end"
    if (emptyPlaceholder) {
      const prefix = source.slice(0, block.range.start)
      const endings = [...prefix.matchAll(/\r\n|\r|\n/g)]
      if (endings.length < 2) return false

      const deleteFromMarker = endings.at(-2)
      if (!deleteFromMarker || deleteFromMarker.index === undefined) return false
      const deleteFrom = deleteFromMarker.index
      const deleteTo = block.range.start
      this.pendingCaret = { sourceOffset: deleteFrom, location: "block_end", sourceLength: source.length - (deleteTo - deleteFrom) }
      this.shiftMapAfterEdit(deleteFrom, deleteTo, 0, block.id)
      this.editorController.replaceRange("", deleteFrom, deleteTo)
      ;(blockElement as HTMLElement).blur()
      return true
    }

    if (emptyListItem || emptyQuoteLine) {
      const previousLines = markdown.split("\n").slice(0, -1)
      replacement = previousLines.join("\n")
      sourceOffset = from + replacement.length
      location = "block_end"
    }

    this.replaceAndFocus(blockElement, from, to, replacement, { sourceOffset, location })
    return true
  }

  restorePendingCaret(): void {
    const pending = this.pendingCaret
    const editor = this.editorController
    if (!pending || !editor) return
    // A newer transaction rewrote the source after this entry armed: the
    // recorded offset belongs to a superseded document, so drop it instead
    // of teleporting the caret on this unrelated update. An unchanged
    // length keeps the entry armed for its own reinstall (deferral).
    if (editor.value.length !== pending.sourceLength) {
      this.pendingCaret = null
      return
    }
    if (!this.map) return

    const blocks = this.map.slides?.flatMap((slide) => slide.blocks || []) || []
    const containsCaret = (block: DocumentEditorBlock): boolean => block.range.start <= pending.sourceOffset && block.range.end >= pending.sourceOffset
    const candidate = blocks.find((block) => block.empty_placeholder && containsCaret(block)) ||
      blocks.find((block) => !block.empty_placeholder && block.range.start <= pending.sourceOffset && block.range.end > pending.sourceOffset) ||
      blocks.find((block) => !block.empty_placeholder && block.range.end === pending.sourceOffset)
    const elements = candidate ? this.blockFragments(candidate.id) : []
    let visibleOffset = candidate ? this.deps.visibleOffsetForSourceOffset(
      this.editorController.value.slice(candidate.range.start, candidate.range.end),
      pending.sourceOffset - candidate.range.start
    ) : 0
    let element = elements.at(-1)
    for (const fragment of elements) {
      const length = this.visibleTextLength(fragment)
      if (visibleOffset <= length) {
        element = fragment
        break
      }
      visibleOffset -= length
    }
    if (!candidate || !element) return

    this.pendingCaret = null
    if (pending.location === "math_expression_start") {
      const mathElement = element.querySelector("[data-editor-math-source]:not([data-editor-math-active])")
      if (mathElement) {
        ;(element as HTMLElement).focus({ preventScroll: true })
        if (this.deps.deRenderMath(mathElement, { caret: "start" })) {
          this.lastProjectionCaret = { blockId: candidate.id, visibleOffset }
          return
        }
      }
    }

    const target = pending.location === "list_item_end"
      ? element.querySelector("li:last-child") || element
      : pending.location === "quote_line_end"
        ? [...element.querySelectorAll("blockquote p, blockquote div")].at(-1) || element
        : candidate.kind === "heading"
          ? element.querySelector("h1, h2, h3, h4, h5, h6") || element
          : candidate.kind === "list"
            ? element.querySelector("li:last-child") || element
            : candidate.kind === "quote"
              ? [...element.querySelectorAll("blockquote p, blockquote div")].at(-1) || element
              : candidate.kind === "paragraph"
                ? element.querySelector("p") || element
              : element
    this.focusAtEnd(element, target)
  }

  blockFragments(blockId: string | undefined): Array<Element> {
    const projection = this.projectionTarget
    if (!blockId || !projection) return []
    return [...projection.querySelectorAll(`[data-editor-block-id="${CSS.escape(blockId)}"]`)]
  }

  combinedBlockForId(blockId: string | undefined): Element | null {
    const fragments = this.blockFragments(blockId)
    const first = fragments[0]
    return fragments.length && first ? this.combinedBlockElement(first, fragments) : null
  }

  combinedBlockElement(element: Element, fragments: Array<Element> | null = null): Element {
    if (!(element as HTMLElement).dataset?.editorBlockId) return element
    const group = fragments || this.blockFragments((element as HTMLElement).dataset.editorBlockId)
    if (group.length < 2) return element

    const first = group[0]
    if (!first) return element
    const combined = first.cloneNode(true) as Element
    const combinedTarget = combined.matches("[data-document-page-flow-content]")
      ? combined
      : combined.querySelector("[data-document-page-flow-content]")
    if (!combinedTarget) return element

    group.slice(1).forEach((fragment) => {
      const target = fragment.matches("[data-document-page-flow-content]")
        ? fragment
        : fragment.querySelector("[data-document-page-flow-content]")
      if (!target || target.tagName !== combinedTarget.tagName) return
      ;[...target.childNodes].forEach((child) => combinedTarget.append(child.cloneNode(true)))
    })
    combinedTarget.removeAttribute("data-document-page-flow-content")
    this.mergeAdjacentInlineElements(combinedTarget)
    return combined
  }

  mergeAdjacentInlineElements(root: Element): void {
    const inlineTags = new Set(["A", "B", "CODE", "DEL", "EM", "I", "MARK", "S", "SMALL", "SPAN", "STRONG", "SUB", "SUP", "U"])
    const sameAttributes = (left: Element, right: Element): boolean => left.tagName === right.tagName &&
      // Spread preserves the host's own NamedNodeMap iteration behavior
      // exactly (whatever it yields or throws); only the type is asserted.
      [...(left.attributes as unknown as Iterable<Attr>)].map((attribute) => [attribute.name, attribute.value]).join("\u0000") ===
      [...(right.attributes as unknown as Iterable<Attr>)].map((attribute) => [attribute.name, attribute.value]).join("\u0000")

    root.querySelectorAll("*").forEach((parent) => {
      let previous: Element | null = null
      ;[...parent.children].forEach((child) => {
        this.mergeAdjacentInlineElements(child)
        if (previous && inlineTags.has(child.tagName) && sameAttributes(previous, child)) {
          while (child.firstChild) previous.append(child.firstChild)
          child.remove()
        } else {
          previous = child
        }
      })
    })
  }

  visibleOffsetInBlockGroup(block: Element, node: Node | null, offset: number): number | null {
    const localOffset = this.deps.visibleOffsetAtPoint(block, node, offset)
    if (localOffset === null) return null
    const fragments = this.blockFragments((block as HTMLElement).dataset.editorBlockId)
    const index = fragments.indexOf(block)
    return fragments.slice(0, Math.max(0, index)).reduce((sum, fragment) => sum + this.visibleTextLength(fragment), 0) + localOffset
  }

  visibleTextLength(element: Element): number {
    if (!element) return 0
    const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT)
    let length = 0
    while (walker.nextNode()) {
      const node = walker.currentNode
      if (node.parentElement?.closest(".katex, .katex-mathml, [aria-hidden='true']")) continue
      // Mirror: editor_caret.ts and visibleBlockText skip the same
      // newlines; the source map never models newlines as visible.
      const content = node.textContent ?? ""
      if (content.trim() === "" && /[\r\n]/.test(content)) continue
      length += content.replace(/[\r\n]/g, "").length
    }
    return length
  }

  focusAtEnd(block: Element, target: Element = block): void {
    ;(block as HTMLElement).focus({ preventScroll: true })
    const range = document.createRange()
    range.selectNodeContents(target)
    range.collapse(false)
    const selection = window.getSelection()
    if (!selection) return
    selection.removeAllRanges()
    selection.addRange(range)
  }
}
