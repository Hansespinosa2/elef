// Shared presentation visual editor: slide/block toolbar operations, alignment
// directives, projection typing flush, and caret preservation. Ported from the
// Stimulus-era presentation_editor_controller.js without behavior change.
// Framework-free: hosts mount it on their editor form and inject the editor
// seam plus editing utilities (caret math, markdown mapping, live math,
// projection editability stay host-owned until Phase 09; they are used here
// only through the injected deps object so this module never imports host
// paths). Slide visibility/scaling/present-mode travel live in
// presentation.js; renderer chrome markup stays byte-identical so the frozen
// fixtures keep matching.
//
// Host interop: the mount publishes itself as
// form.presentationEditorController (the CodeMirror editor host calls
// restoreCaret after mode changes) and clears it on destroy.
import {
  addSlide as addSlideToSource,
  blockOperationRange,
  deleteSlide as deleteSlideFromSource,
  directiveLineSpan,
  exciseRanges,
  insertAlignDirective,
  insertBlock as insertBlockInSource,
  moveBlock as moveBlockInSource,
  moveSlide as moveSlideInSource,
  parseAlignment,
  removeBlock as removeBlockFromSource
// @ts-ignore: work-model is still untyped JS (S3 converts it); the ignore goes dormant once its types land.
} from "@elef/work-model/document-transforms"

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
  position_scope?: string
  position_directive_id?: string
  position?: { horizontal: string; vertical: string; vertical_explicit?: boolean }
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
  inputTarget?: unknown
  commitSource?(source: string): unknown
  replaceRange(replacement: string, from: number, to: number): void
  replaceRanges(changes: Array<{ from: number; to: number; insert: string }>): void
}

export interface ProjectionEvent {
  readonly target: EventTarget | null | undefined
  preventDefault(): void
}

export interface ProjectionKeyEvent {
  readonly key: string
  readonly target: EventTarget | null | undefined
  preventDefault(): void
}

export interface PresentationEditorDeps {
  syncActiveMath(element: Element | null, flush: () => void): void
  handleMathClick(event: ProjectionEvent, target: Element | null): boolean
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
  pendingCaretRestore: { sourceOffset: number; preferredBlockId: string | null } | null | undefined

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
    on(form, "elef:editor-mode-change", (event) => this.applyMode(event.detail.mode))
    on(form, "elef:preview-updated", (event) => this.previewUpdated(event.detail.payload))
    on(form, "elef:preview-stale", (event) => this.previewStale(event.detail))
    on(form, "click", (event) => this.handleAction(event))
    on(form, "click", (event) => this.projectionLinkClicked(event))
    on(form, "change", (event) => {
      if (event.target?.closest?.("[data-presentation-editor-align]")) this.alignmentChanged(event)
    })
    on(form, "focusin", (event) => {
      if (event.target?.closest?.("[data-editor-block-id]")) this.blockFocus(event)
    })
    on(form, "focusout", (event) => {
      if (event.target?.closest?.("[data-editor-block-id]")) this.blockBlur(event)
    })
    on(form, "keydown", (event) => this.blockKeydown(event), true)
    const doc = form?.ownerDocument
    on(doc, "selectionchange", () => this.rememberProjectionCaret())

    this.editorController = this.getEditor()
    this.applyMode(form.getAttribute("data-editor-mode") || "visual")
    this.updateBlockBoundaries()
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
  }

  blockFocus(event: ProjectionEvent): void {
    this.activeProjectionBlock = (event.target as Element).closest("[data-editor-block-id]")
    this.element.dataset.editorProjectionActive = "true"
  }

  blockBlur(_event: ProjectionEvent): void {
    this.deps.syncActiveMath(this.canvas(), () => this.flushPendingProjectionEdits())
    this.flushPendingProjectionEdits()
    this.activeProjectionBlock = null
    delete this.element.dataset.editorProjectionActive
    this.syncProjectionEditability()
  }

  projectionLinkClicked(event: ProjectionEvent): void {
    if (this.deps.handleMathClick(event, this.canvas())) return
    this.deps.syncActiveMath(this.canvas(), () => this.flushPendingProjectionEdits())
    const link = (event.target as Element).closest?.(".editor-projection [contenteditable='true'] a")
    if (!link) return

    event.preventDefault()
    ;(link.closest("[contenteditable='true']") as HTMLElement | null)?.focus()
  }

  blockInput(event: ProjectionEvent): void {
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
    return {
      blockId: current.blockId ?? "",
      sourceOffset: region.content_range.start + this.deps.sourceOffsetForVisibleOffset(source, current.visibleOffset)
    }
  }

  restoreCaret(sourceOffset: number, preferredBlockId: string | null = null): boolean {
    const canvas = this.canvas()
    if (!canvas || !this.editorController) return false
    const regions = this.allRegions().filter((region) => region.editable)
    const region = regions.find((candidate) => candidate.block_id === preferredBlockId) ||
      regions.find((candidate) => sourceOffset >= candidate.content_range.start && sourceOffset <= candidate.content_range.end) ||
      regions.reduce((closest, candidate) => {
        if (!closest) return candidate
        const distance = Math.min(Math.abs(sourceOffset - candidate.content_range.start), Math.abs(sourceOffset - candidate.content_range.end))
        const closestDistance = Math.min(Math.abs(sourceOffset - closest.content_range.start), Math.abs(sourceOffset - closest.content_range.end))
        return distance < closestDistance ? candidate : closest
      }, null as PresentationEditorRegion | null)
    if (!region) return false

    const block = [...canvas.querySelectorAll("[data-editor-block-id]")]
      .find((candidate) => (candidate as HTMLElement).dataset.editorBlockId === region.block_id)
    if (!block) return false
    if ((block as HTMLElement).contentEditable !== "true") {
      if (this.isProjectionFresh() === false) this.pendingCaretRestore = { sourceOffset, preferredBlockId }
      return false
    }
    const source = this.editorController.value.slice(region.content_range.start, region.content_range.end)
    const visibleOffset = this.deps.visibleOffsetForSourceOffset(source, sourceOffset - region.content_range.start)
    const point = this.deps.pointAtVisibleOffset(block, visibleOffset)
    ;(block as HTMLElement).focus({ preventScroll: true })
    this.getSelection()?.setPosition(point[0], point[1])
    this.lastProjectionCaret = { blockId: region.block_id ?? "", visibleOffset }
    return true
  }

  flushPendingProjectionEdits(): void {
    if (this.pendingProjectionFrame) this.cancelFrame(this.pendingProjectionFrame)
    this.pendingProjectionFrame = undefined
    if (!this.pendingProjectionEdits?.size || !this.editorController) return

    const edits = [...this.pendingProjectionEdits.values()].map((edit) => ({
      ...edit,
      replacement: this.deps.markdownForVisibleText(edit.source, this.editableText(edit.blockElement), edit.kind, edit.blockElement)
    })).filter((edit) => edit.replacement !== edit.source)
    this.pendingProjectionEdits.clear()
    if (edits.length === 0) {
      if (this.operationPending && this.isProjectionFresh() !== false) {
        this.operationPending = false
        this.setControlsDisabled(false)
        this.setStatus("")
      }
      return
    }

    edits.forEach((edit) => {
      if (edit.kind !== "code") this.deps.renderInlineMath(edit.blockElement)
    })
    const changes = edits.map((edit) => ({ from: edit.from, to: edit.to, insert: edit.replacement }))
      .sort((left, right) => left.from - right.from)
    edits.sort((left, right) => right.from - left.from).forEach((edit) => {
      this.shiftMapAfterEdit(edit.from, edit.to, edit.replacement.length)
    })
    this.editorController.replaceRanges(changes)
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
    const selection = this.getSelection()
    if (!selection?.focusNode) return
    const focusNode = selection.focusNode
    const node = (focusNode.nodeType === this.Node.ELEMENT_NODE ? focusNode : focusNode.parentElement) as Element | null
    const block = node?.closest?.("[data-editor-block-id]")
    const canvas = this.canvas()
    if (!block || !canvas?.contains(block)) return
    const visibleOffset = this.deps.visibleOffsetAtPoint(block, selection.focusNode, selection.focusOffset)
    if (visibleOffset !== null) this.lastProjectionCaret = { blockId: (block as HTMLElement).dataset.editorBlockId ?? "", visibleOffset }
  }

  blockKeydown(event: ProjectionKeyEvent): void {
    if (this.pendingProjectionFrame || this.pendingProjectionEdits?.size) {
      this.flushPendingProjectionEdits()
    }
    if (this.deps.handleMathKeydown(event, this.canvas(), () => this.flushPendingProjectionEdits())) return
    if (this.deps.moveCaretBetweenBlocks(event, this.canvas())) return
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

  alignmentChanged(event: ProjectionEvent): void {
    if (this.element.dataset.editorMode === "source") return
    const select = (event.target as Element).closest("[data-presentation-editor-align]") as HTMLSelectElement
    if (!this.editorController || !this.map) return

    this.deps.syncActiveMath(this.canvas(), () => this.flushPendingProjectionEdits())
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
        const directives = slide.directives ?? []
        const directiveIndex = directives.findIndex((candidate) => candidate.id === directive.id)
        // Immediate-next rule (NOT the shared find-after rule): alignment
        // removal strips the opener plus an ADJACENT closer only. Unifying
        // with findPositionCloseAfter would change behavior on non-adjacent
        // closers, so this hand-rolled lookup stays deliberately.
        const closing = directives[directiveIndex + 1]
        const ranges = [directive]
        if (closing?.type === "position_close") ranges.push(closing)
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
    const blockIndex = Number(control.dataset.blockIndex)

    if (action === "delete-slide" && !this.confirm("Delete this slide?")) return
    if (action === "delete-block" && !this.confirm("Delete this block?")) return

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
      case "add-block-after":
        this.addBlock(slideIndex, blockIndex + 1)
        break
      case "delete-block":
        this.deleteBlock(slideIndex, blockIndex)
        break
      case "move-block-up":
        this.moveBlock(slideIndex, blockIndex, blockIndex - 1)
        break
      case "move-block-down":
        this.moveBlock(slideIndex, blockIndex, blockIndex + 1)
        break
      default:
        break
    }
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
    this.updateBlockBoundaries()
    this.syncProjectionEditability()
    this.setStatus("")
    this.restorePendingCaret()
  }

  previewStale(detail: { preserveActive?: boolean } = {}): void {
    if (!this.isMapSynchronized()) {
      this.operationPending = true
      this.setControlsDisabled(true)
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

  shiftMapAfterEdit(from: number, to: number, replacementLength: number): void {
    if (!this.map) return

    const delta = replacementLength - (to - from)
    const shiftRange = (range: EditorSourceRange | null | undefined): void => {
      if (!range) return
      const shiftPosition = (position: number): number => {
        if (position <= from) return position
        if (position >= to) return position + delta
        return from + replacementLength
      }
      range.start = shiftPosition(range.start)
      range.end = Math.max(range.start, shiftPosition(range.end))
    }
    const shiftObject = (object: ShiftableRanges | null | undefined): void => {
      if (!object) return
      shiftRange(object.range)
      shiftRange(object.source_range)
      shiftRange(object.content_range)
      shiftRange(object.delimiter_range)
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

  restorePendingCaret(): void {
    const pending = this.pendingCaretRestore
    if (!pending || this.element.dataset.editorMode !== "visual") return
    this.pendingCaretRestore = null
    this.scheduleFrame(() => this.restoreCaret(pending.sourceOffset, pending.preferredBlockId))
  }

  updateBlockBoundaries(): void {
    ;([...this.element.querySelectorAll('[data-presentation-editor-action="move-block-up"], [data-presentation-editor-action="move-block-down"]')] as Array<HTMLButtonElement>).forEach((control) => {
      const slide = this.map?.slides?.[Number(control.dataset.slideIndex)]
      const index = Number(control.dataset.blockIndex)
      const delta = control.dataset.presentationEditorAction === "move-block-up" ? -1 : 1
      const neighbor = slide?.blocks?.[index + delta]
      const block = slide?.blocks?.[index]
      let disabled = !neighbor || !block

      if (neighbor && block && (neighbor.position_scope === "group" || block.position_scope === "group")) {
        disabled = neighbor.position_scope !== "group" || block.position_scope !== "group" ||
          neighbor.position_directive_id !== block.position_directive_id
      }

      if (disabled) {
        if (control.dataset.editorBoundaryDisabled !== "true") control.dataset.editorBoundaryDisabled = "true"
        if (!control.disabled) control.disabled = true
      } else {
        if (control.dataset.editorBoundaryDisabled !== undefined) delete control.dataset.editorBoundaryDisabled
        if (control.disabled) control.disabled = false
      }
    })
  }

  editableText(element: Element): string {
    return ((element as HTMLElement).innerText || element.textContent || "").replace(/ /g, " ").replace(/\n+$/, "")
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
        control.disabled = control.dataset.editorOriginalDisabled === "true" || control.dataset.editorBoundaryDisabled === "true"
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
