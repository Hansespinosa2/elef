import { Controller } from "@hotwired/stimulus"
import { editorFor } from "controllers/editor_controller"
import { markdownForVisibleText, renderInlineMath } from "controllers/editor_markdown"
import {
  moveCaretBetweenBlocks,
  pointAtVisibleOffset,
  removeEmptyBlockSource,
  sourceOffsetForVisibleOffset,
  visibleOffsetAtPoint,
  visibleOffsetForSourceOffset
} from "controllers/editor_caret"

export default class extends Controller {
  static targets = ["projection"]
  static values = { kind: String }

  connect() {
    this.element.visualEditorController = this
    this.map = this.readMap()
    this.editorController = editorFor(this.element.querySelector("[data-controller~='editor']"))
    this.editorReady = (event) => {
      this.editorController = event.detail.editor
      this.applyMode(this.element.getAttribute("data-editor-mode") || "visual")
    }
    this.element.addEventListener("elef:editor-ready", this.editorReady)
    this.modeChangedHandler = (event) => this.applyMode(event.detail.mode)
    this.element.addEventListener("elef:editor-mode-change", this.modeChangedHandler)
    this.previewHandler = (event) => this.previewUpdated(event.detail.payload)
    this.element.addEventListener("elef:preview-updated", this.previewHandler)
    this.previewStaleHandler = (event) => this.previewStale(event.detail)
    this.element.addEventListener("elef:preview-stale", this.previewStaleHandler)
    this.projectionLinkHandler = (event) => this.projectionLinkClicked(event)
    this.element.addEventListener("click", this.projectionLinkHandler)
    this.hasPresentationProjection = Boolean(this.element.querySelector(".presentation-editor-projection"))
    if (!this.hasPresentationProjection) {
      this.blockKeydownHandler = (event) => this.blockKeydown(event)
      this.element.addEventListener("keydown", this.blockKeydownHandler, true)
      this.selectionChangeHandler = () => this.rememberProjectionCaret()
      document.addEventListener("selectionchange", this.selectionChangeHandler)
    }
    this.applyMode("visual")
  }

  disconnect() {
    this.element.removeEventListener("elef:editor-ready", this.editorReady)
    this.element.removeEventListener("elef:editor-mode-change", this.modeChangedHandler)
    this.element.removeEventListener("elef:preview-updated", this.previewHandler)
    this.element.removeEventListener("elef:preview-stale", this.previewStaleHandler)
    this.element.removeEventListener("click", this.projectionLinkHandler)
    this.element.removeEventListener("keydown", this.blockKeydownHandler, true)
    document.removeEventListener("selectionchange", this.selectionChangeHandler)
    if (this.pendingProjectionFrame) cancelAnimationFrame(this.pendingProjectionFrame)
    this.flushPendingProjectionEdits()
    if (this.element.visualEditorController === this) delete this.element.visualEditorController
  }

  modeChanged(event) {
    this.applyMode(event.detail.mode)
  }

  applyMode(mode) {
    const visual = mode !== "source"
    this.element.dataset.editorMode = visual ? "visual" : "source"
    if (!visual) this.pendingCaretRestore = null
    if (this.hasProjectionTarget) this.projectionTarget.setAttribute("aria-label", visual ? "Visual editing surface" : "Rendered preview")
    this.syncProjectionEditability()
  }

  blockFocus(event) {
    this.activeProjectionBlock = event.currentTarget
    this.element.dataset.editorProjectionActive = "true"
  }

  blockBlur() {
    this.flushPendingProjectionEdits()
    this.activeProjectionBlock = null
    delete this.element.dataset.editorProjectionActive
    this.syncProjectionEditability()
  }

  projectionLinkClicked(event) {
    const link = event.target.closest?.(".editor-projection [contenteditable='true'] a")
    if (!link) return

    event.preventDefault()
    link.closest("[contenteditable='true']")?.focus()
  }

  projectionInput(event) {
    if (!this.editorController || this.updatingProjection) return

    const blockElement = event.target.closest?.("[data-editor-block-id]")
    if (!blockElement || !this.canEditBlock(blockElement)) return
    const block = this.map?.slides?.flatMap((slide) => slide.blocks || []).find((candidate) => candidate.id === blockElement.dataset.editorBlockId)
    const region = this.map?.editable_regions?.find((candidate) => candidate.block_id === block?.id)
    if (!block || !region) return

    const from = region.content_range.start
    const to = region.content_range.end
    this.pendingProjectionEdits ||= new Map()
    const pending = this.pendingProjectionEdits.get(region.id)
    const currentSource = pending?.source ?? this.editorController.value.slice(from, to)
    this.pendingProjectionEdits.set(region.id, { id: region.id, blockId: block.id, from, to, source: currentSource, kind: region.kind, blockElement })
    this.scheduleProjectionFlush()
  }

  captureCaret() {
    const selection = window.getSelection()
    const block = selection?.focusNode
      ? (selection.focusNode.nodeType === Node.ELEMENT_NODE ? selection.focusNode : selection.focusNode.parentElement)?.closest?.("[data-editor-block-id]")
      : null
    const current = block && this.projectionTarget?.contains(block)
      ? { blockId: block.dataset.editorBlockId, visibleOffset: visibleOffsetAtPoint(block, selection.focusNode, selection.focusOffset) }
      : this.lastProjectionCaret
    if (!current || current.visibleOffset === null || current.visibleOffset === undefined) return null

    const region = this.regionForBlock(current.blockId)
    if (!region) return null
    const source = this.editorController.value.slice(region.content_range.start, region.content_range.end)
    return {
      blockId: current.blockId,
      sourceOffset: region.content_range.start + sourceOffsetForVisibleOffset(source, current.visibleOffset)
    }
  }

  restoreCaret(sourceOffset, preferredBlockId = null) {
    if (!this.hasProjectionTarget || !this.editorController) return false
    const regions = this.allRegions().filter((region) => region.editable)
    const region = regions.find((candidate) => candidate.block_id === preferredBlockId) ||
      regions.find((candidate) => sourceOffset >= candidate.content_range.start && sourceOffset <= candidate.content_range.end) ||
      regions.reduce((closest, candidate) => {
        if (!closest) return candidate
        const distance = Math.min(Math.abs(sourceOffset - candidate.content_range.start), Math.abs(sourceOffset - candidate.content_range.end))
        const closestDistance = Math.min(Math.abs(sourceOffset - closest.content_range.start), Math.abs(sourceOffset - closest.content_range.end))
        return distance < closestDistance ? candidate : closest
      }, null)
    if (!region) return false

    const block = [...this.projectionTarget.querySelectorAll("[data-editor-block-id]")]
      .find((candidate) => candidate.dataset.editorBlockId === region.block_id)
    if (!block) return false
    if (block.contentEditable !== "true") {
      if (this.element.previewController?.projectionFresh === false) this.pendingCaretRestore = { sourceOffset, preferredBlockId }
      return false
    }
    const source = this.editorController.value.slice(region.content_range.start, region.content_range.end)
    const visibleOffset = visibleOffsetForSourceOffset(source, sourceOffset - region.content_range.start)
    const point = pointAtVisibleOffset(block, visibleOffset)
    block.focus({ preventScroll: true })
    window.getSelection()?.setPosition(point[0], point[1])
    this.lastProjectionCaret = { blockId: region.block_id, visibleOffset }
    return true
  }

  flushPendingProjectionEdits() {
    if (this.pendingProjectionFrame) cancelAnimationFrame(this.pendingProjectionFrame)
    this.pendingProjectionFrame = null
    if (!this.pendingProjectionEdits?.size || !this.editorController) return

    const edits = [...this.pendingProjectionEdits.values()].map((edit) => ({
      ...edit,
      replacement: markdownForVisibleText(edit.source, this.editableText(edit.blockElement), edit.kind, edit.blockElement)
    })).filter((edit) => edit.replacement !== edit.source)
    this.pendingProjectionEdits.clear()
    if (edits.length === 0) return

    edits.forEach((edit) => {
      if (edit.kind !== "code") renderInlineMath(edit.blockElement)
    })
    const changes = edits.map((edit) => ({ from: edit.from, to: edit.to, insert: edit.replacement }))
      .sort((left, right) => left.from - right.from)
    edits.sort((left, right) => right.from - left.from).forEach((edit) => {
      this.shiftMapAfterEdit(edit.from, edit.to, edit.replacement.length)
    })
    this.editorController.replaceRanges(changes)
  }

  scheduleProjectionFlush() {
    if (this.pendingProjectionFrame) return
    this.pendingProjectionFrame = requestAnimationFrame(() => {
      this.pendingProjectionFrame = null
      this.flushPendingProjectionEdits()
    })
  }

  rememberProjectionCaret() {
    const selection = window.getSelection()
    if (!selection?.focusNode) return
    const node = selection.focusNode.nodeType === Node.ELEMENT_NODE ? selection.focusNode : selection.focusNode.parentElement
    const block = node?.closest?.("[data-editor-block-id]")
    if (!block || !this.projectionTarget?.contains(block)) return
    const visibleOffset = visibleOffsetAtPoint(block, selection.focusNode, selection.focusOffset)
    if (visibleOffset !== null) this.lastProjectionCaret = { blockId: block.dataset.editorBlockId, visibleOffset }
  }

  blockKeydown(event) {
    if (moveCaretBetweenBlocks(event, this.projectionTarget)) return
    if (!["Backspace", "Delete"].includes(event.key)) return

    const selection = window.getSelection()
    if (!selection?.isCollapsed) return
    const node = selection.focusNode?.nodeType === Node.ELEMENT_NODE ? selection.focusNode : selection.focusNode?.parentElement
    const block = node?.closest?.("[data-editor-block-id][contenteditable='true']")
    if (!block || !this.projectionTarget?.contains(block) || this.editableText(block).trim() !== "") return
    if (block.querySelector("img, video, iframe, [data-editor-math-source]")) return

    const sourceBlock = this.map?.slides?.flatMap((slide) => slide.blocks || [])
      .find((candidate) => candidate.id === block.dataset.editorBlockId)
    const region = this.regionForBlock(block.dataset.editorBlockId)
    if (!sourceBlock || !region) return

    event.preventDefault()
    this.flushPendingProjectionEdits()
    const source = this.editorController.value
    const updated = removeEmptyBlockSource(source, sourceBlock.range.start, sourceBlock.range.end)
    if (updated === source) return
    this.editorController.replaceRange(updated, 0, source.length)
  }

  previewUpdated(payload) {
    if (payload?.editor_map) this.map = payload.editor_map
    this.syncProjectionEditability({ preserveActive: Boolean(this.activeProjectionBlock && this.element.dataset.editorProjectionActive === "true") })
    this.restorePendingCaret()
  }

  allRegions() {
    return this.map?.slides?.flatMap((slide) => slide.editable_regions || []) || this.map?.editable_regions || []
  }

  regionForBlock(blockId) {
    return this.allRegions().find((region) => region.block_id === blockId) || null
  }

  restorePendingCaret() {
    const pending = this.pendingCaretRestore
    if (!pending || this.element.dataset.editorMode !== "visual") return
    this.pendingCaretRestore = null
    requestAnimationFrame(() => this.restoreCaret(pending.sourceOffset, pending.preferredBlockId))
  }

  previewStale(detail = {}) {
    this.syncProjectionEditability({ preserveActive: detail.preserveActive })
  }

  canEditBlock(blockElement) {
    if (this.element.dataset.editorMode !== "visual") return false
    if (this.element.previewController?.projectionFresh !== false) return true

    return this.activeProjectionBlock === blockElement &&
      document.activeElement?.closest?.("[contenteditable='true']") === blockElement
  }

  syncProjectionEditability({ preserveActive = false } = {}) {
    if (!this.hasProjectionTarget) return

    const visual = this.element.dataset.editorMode !== "source"
    const fresh = this.element.previewController?.projectionFresh !== false
    const active = preserveActive ? document.activeElement?.closest?.("[data-editor-block-id]") : null
    this.projectionTarget.querySelectorAll(".document-editor-block[data-editor-block-id]").forEach((block) => {
      const editable = visual && (fresh || (preserveActive && block === active))
      block.contentEditable = String(editable)
      if (editable) {
        block.setAttribute("role", "textbox")
        block.setAttribute("aria-label", "Editable Markdown block")
        block.setAttribute("aria-multiline", "true")
        block.setAttribute("spellcheck", "true")
        block.removeAttribute("aria-readonly")
      } else {
        block.removeAttribute("role")
        block.removeAttribute("aria-label")
        block.removeAttribute("aria-multiline")
        block.removeAttribute("spellcheck")
        block.setAttribute("aria-readonly", "true")
      }
    })
  }

  shiftMapAfterEdit(from, to, replacementLength) {
    if (!this.map) return

    const delta = replacementLength - (to - from)
    const shiftRange = (range) => {
      if (!range) return
      const shiftPosition = (position) => {
        if (position <= from) return position
        if (position >= to) return position + delta
        return from + replacementLength
      }
      range.start = shiftPosition(range.start)
      range.end = Math.max(range.start, shiftPosition(range.end))
    }
    const shiftObject = (object) => {
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

  readMap() {
    const source = this.element.querySelector("[data-editor-map-json]")?.textContent
    if (!source) return null
    try {
      return JSON.parse(source)
    } catch (_error) {
      return null
    }
  }

  editableText(element) {
    return (element.innerText || element.textContent || "").replace(/\u00a0/g, " ").replace(/\n+$/, "")
  }
}
