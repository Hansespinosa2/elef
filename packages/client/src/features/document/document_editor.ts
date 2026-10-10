// Document visual editor feature: contenteditable document projection editing,
// caret preservation, structured-block continuation, alignment directives, and
// overflow-adjacent map bookkeeping. Framework-free: the host constructs it
// with DOM roots, document kind, editor lookup plus preview-toggle seams, and
// the shared editing-utilities deps object, then delegates lifecycle and
// actions. The web Stimulus controller is the thin adapter.
import { blockOperationRange, directiveLineSpan, exciseRange, findPositionCloseAfter, insertAlignDirective } from "@elef/work-model/document-transforms"

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
  position_scope?: string
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
  commitSource(source: string): unknown
  replaceRange(replacement: string, from: number, to: number): void
  replaceRanges(changes: Array<{ from: number; to: number; insert: string }>): void
}

export interface DocumentProjectionEvent {
  readonly target: EventTarget | null | undefined
  preventDefault(): void
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
  handleMathClick(event: DocumentProjectionEvent, target: Element | null): boolean
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
  previewController?: { projectionFresh?: boolean } | null
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
  positionControlOutsidePointerDown: ((event: any) => void) | undefined
  blockKeydownHandler: ((event: any) => void) | undefined
  selectionChangeHandler: (() => void) | undefined
  hasPresentationProjection: boolean | undefined
  pendingProjectionFrame: number | undefined
  pendingProjectionEdits: Map<string, DocumentProjectionEdit> | undefined
  pendingCaretRestore: { sourceOffset: number; preferredBlockId: string | null } | null | undefined
  pendingCaret: { sourceOffset: number; location: string } | null | undefined
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
    // The host can connect this feature after the first preview event when
    // a desktop deck is opened. Restore the toggle from the installed preview
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
      this.selectionChangeHandler = () => this.rememberProjectionCaret()
      document.addEventListener("selectionchange", this.selectionChangeHandler)
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
    document.removeEventListener("pointerdown", this.positionControlOutsidePointerDown as EventListener, true)
    this.element.removeEventListener("keydown", this.blockKeydownHandler as EventListener, true)
    document.removeEventListener("selectionchange", this.selectionChangeHandler as EventListener)
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
  }

  blockFocus(): void {
    this.element.dataset.editorProjectionActive = "true"
  }

  blockBlur(): void {
    this.deps.syncActiveMath(this.projectionTarget, () => this.flushPendingProjectionEdits())
    this.flushPendingProjectionEdits()
    delete this.element.dataset.editorProjectionActive
    this.syncProjectionEditability()
  }

  projectionLinkClicked(event: DocumentProjectionEvent): void {
    if (this.deps.handleMathClick(event, this.projectionTarget)) return
    this.deps.syncActiveMath(this.projectionTarget, () => this.flushPendingProjectionEdits())
    const link = (event.target as Element).closest?.(".editor-projection [contenteditable='true'] a")
    if (!link) return

    event.preventDefault()
    ;(link.closest("[contenteditable='true']") as HTMLElement | null)?.focus()
  }

  projectionInput(event: DocumentProjectionEvent): void {
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
    return {
      blockId: current.blockId ?? "",
      sourceOffset: region.content_range.start + this.deps.sourceOffsetForVisibleOffset(source, current.visibleOffset)
    }
  }

  restoreCaret(sourceOffset: number, preferredBlockId: string | null = null): boolean {
    if (!this.hasProjectionTarget || !this.editorController) return false
    const regions = this.allRegions().filter((region) => region.editable)
    const region = regions.find((candidate) => candidate.block_id === preferredBlockId) ||
      regions.find((candidate) => sourceOffset >= candidate.content_range.start && sourceOffset <= candidate.content_range.end) ||
      regions.reduce((closest, candidate) => {
        if (!closest) return candidate
        const distance = Math.min(Math.abs(sourceOffset - candidate.content_range.start), Math.abs(sourceOffset - candidate.content_range.end))
        const closestDistance = Math.min(Math.abs(sourceOffset - closest.content_range.start), Math.abs(sourceOffset - closest.content_range.end))
        return distance < closestDistance ? candidate : closest
      }, null as DocumentEditorRegion | null)
    if (!region) return false

    const source = this.editorController.value.slice(region.content_range.start, region.content_range.end)
    const blocks = this.blockFragments(region.block_id)
    let visibleOffset = this.deps.visibleOffsetForSourceOffset(source, sourceOffset - region.content_range.start)
    let block = blocks.at(-1)
    for (const candidate of blocks) {
      const length = this.visibleTextLength(candidate)
      if (visibleOffset <= length) {
        block = candidate
        break
      }
      visibleOffset -= length
    }
    if (!block) return false
    if ((block as HTMLElement).contentEditable !== "true") {
      if (this.element.previewController?.projectionFresh === false) this.pendingCaretRestore = { sourceOffset, preferredBlockId }
      return false
    }
    const point = this.deps.pointAtVisibleOffset(block, visibleOffset)
    ;(block as HTMLElement).focus({ preventScroll: true })
    window.getSelection()?.setPosition(point[0], point[1])
    this.lastProjectionCaret = { blockId: region.block_id ?? "", visibleOffset }
    return true
  }

  flushPendingProjectionEdits(): void {
    if (this.pendingProjectionFrame) cancelAnimationFrame(this.pendingProjectionFrame)
    this.pendingProjectionFrame = undefined
    if (!this.pendingProjectionEdits?.size || !this.editorController) return

    const edits = [...this.pendingProjectionEdits.values()].map((edit) => {
      const blockElement = this.combinedBlockForId(edit.blockId) || edit.blockElement
      return {
        ...edit,
        blockElement,
        replacement: this.deps.markdownForVisibleText(
          edit.source,
          this.editableText(blockElement, edit.kind, edit.source),
          edit.kind,
          blockElement,
          { documentMode: this.kind === "document" }
        )
      }
    }).filter((edit) => edit.replacement !== edit.source)
    this.pendingProjectionEdits.clear()
    if (edits.length === 0) return

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
  }

  scheduleProjectionFlush(): void {
    if (this.pendingProjectionFrame) return
    this.pendingProjectionFrame = requestAnimationFrame(() => {
      this.pendingProjectionFrame = undefined
      this.flushPendingProjectionEdits()
    })
  }

  rememberProjectionCaret(): void {
    this.deps.syncActiveMath(this.projectionTarget, () => this.flushPendingProjectionEdits())
    const selection = window.getSelection()
    if (!selection?.focusNode) return
    const focusNode = selection.focusNode
    const node = (focusNode.nodeType === Node.ELEMENT_NODE ? focusNode : focusNode.parentElement) as Element | null
    const block = node?.closest?.("[data-editor-block-id]")
    if (!block || !this.projectionTarget?.contains(block)) return
    const visibleOffset = this.visibleOffsetInBlockGroup(block, selection.focusNode, selection.focusOffset)
    if (visibleOffset !== null) this.lastProjectionCaret = { blockId: (block as HTMLElement).dataset.editorBlockId ?? "", visibleOffset }
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
    this.pendingCaret = { sourceOffset: Math.min(from, updated.length), location: "block_end" }
    void editor.commitSource(updated)
  }

  allRegions(): Array<DocumentEditorRegion> {
    return this.map?.editable_regions || this.map?.slides?.flatMap((slide) => slide.editable_regions || []) || []
  }

  regionForBlock(blockId: string | undefined): DocumentEditorRegion | null {
    return this.allRegions().find((region) => region.block_id === blockId) || null
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
    requestAnimationFrame(() => this.restoreCaret(pending.sourceOffset, pending.preferredBlockId))
  }

  projectionKeydown(event: DocumentProjectionKeyEvent): void {
    if (event.defaultPrevented) return
    if (this.kind !== "document" || event.isComposing || event.altKey || event.ctrlKey || event.metaKey) return

    const blockElement = (event.target as Element).closest?.(".document-editor-block[data-editor-block-id]")
    if (!blockElement || !this.canEditBlock(blockElement)) return
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

      const directives = slide.directives ?? []
      const directiveIndex = directives.findIndex((candidate) => candidate.id === directive.id)
      const ranges = [directive.range]
      if (block.position_scope === "group") {
        const closing = findPositionCloseAfter(directives, directiveIndex)
        if (closing?.range) ranges.push(closing.range)
      }

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
      const verticalAlignment = vertical === "middle" ? "center" : vertical
      replacement = `:::align{${verticalAlignment ? `${verticalAlignment} ` : ""}${horizontal}}${lineEnding}`
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
    this.syncProjectionEditability({ preserveActive: Boolean(this.focusedProjectionBlock()) })
    this.restorePendingCaret()
    this.restoreProjectionCaret()
    this.focusNewDocumentTitle()
  }

  previewStale(detail: { preserveActive?: boolean } = {}): void {
    this.syncProjectionEditability({ preserveActive: detail.preserveActive || Boolean(this.focusedProjectionBlock()) })
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
    element = this.combinedBlockElement(element)
    let value: string | undefined
    let structuredLines: Array<Element> | null | undefined
    if (kind === "list" && !element.querySelector("li li")) {
      structuredLines = [...element.querySelectorAll("li")]
      if (structuredLines.length) value = structuredLines.map((item) => ((item as HTMLElement).innerText || item.textContent || "").replace(/\u00a0/g, " ").replace(/\n+$/, "")).join("\n")
    }

    if (value === undefined && kind === "quote") {
      const quote = element.querySelector("blockquote")
      structuredLines = quote && [...quote.children].filter((child) => /^(P|DIV)$/.test(child.tagName))
      if (structuredLines?.length) value = structuredLines.map((line) => ((line as HTMLElement).innerText || line.textContent || "").replace(/\u00a0/g, " ").replace(/\n+$/, "")).join("\n")
    }

    if (value === undefined) {
      const blockChildren = [...element.children].filter((child) => /^(P|DIV|H[1-6])$/.test(child.tagName))
      value = blockChildren.length > 1
        ? blockChildren.map((child) => ((child as HTMLElement).innerText || child.textContent || "").replace(/\u00a0/g, " ").replace(/\n+$/, "")).join("\n\n")
        : ((element as HTMLElement).innerText || element.textContent || "").replace(/\u00a0/g, " ")
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
    this.pendingCaret = caret
    this.shiftMapAfterEdit(from, to, replacement.length, (blockElement as HTMLElement).dataset.editorBlockId)
    this.editorController.replaceRange(replacement, from, to)
    ;(blockElement as HTMLElement).blur()
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
    this.lastProjectionCaret = { blockId: (blockElement as HTMLElement).dataset.editorBlockId ?? "", visibleOffset: 0 }

    // Install the source after the active DOM and selection are ready. The
    // preview's stale-projection handler then preserves this focused block,
    // while the shifted map lets the first typed character round-trip safely.
    this.editorController.replaceRange(replacement, from, to)
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
      this.pendingCaret = { sourceOffset: deleteFrom, location: "block_end" }
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
    if (!pending || !this.map) return

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
      if (node.parentElement?.closest(".katex-mathml, [aria-hidden='true']")) continue
      length += (node.textContent ?? "").length
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
