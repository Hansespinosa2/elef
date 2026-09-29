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
import { handleMathClick, handleMathKeydown, syncActiveMath } from "controllers/editor_math"

export default class extends Controller {
  static targets = ["canvas", "source", "status"]

  connect() {
    this.element.presentationEditorController = this
    this.map = this.readMap()
    this.editorController = editorFor(this.sourceTarget)
    this.editorReady = (event) => {
      this.editorController = event.detail.editor
      this.applyMode(this.element.getAttribute("data-editor-mode") || "visual")
    }
    this.element.addEventListener("elef:editor-ready", this.editorReady)
    this.sourceInputHandler = (event) => this.sourceInput(event)
    this.element.addEventListener("input", this.sourceInputHandler)
    this.modeChangedHandler = (event) => this.applyMode(event.detail.mode)
    this.element.addEventListener("elef:editor-mode-change", this.modeChangedHandler)
    this.previewHandler = (event) => this.previewUpdated(event.detail.payload)
    this.element.addEventListener("elef:preview-updated", this.previewHandler)
    this.previewStaleHandler = (event) => this.previewStale(event.detail)
    this.element.addEventListener("elef:preview-stale", this.previewStaleHandler)
    this.clickHandler = (event) => this.handleAction(event)
    this.element.addEventListener("click", this.clickHandler)
    this.projectionLinkHandler = (event) => this.projectionLinkClicked(event)
    this.element.addEventListener("click", this.projectionLinkHandler)
    this.blockKeydownHandler = (event) => this.blockKeydown(event)
    this.element.addEventListener("keydown", this.blockKeydownHandler, true)
    this.selectionChangeHandler = () => this.rememberProjectionCaret()
    document.addEventListener("selectionchange", this.selectionChangeHandler)
    this.applyMode(this.element.getAttribute("data-editor-mode") || "visual")
    this.updateBlockBoundaries()
  }

  disconnect() {
    this.element.removeEventListener("elef:editor-ready", this.editorReady)
    this.element.removeEventListener("input", this.sourceInputHandler)
    this.element.removeEventListener("elef:editor-mode-change", this.modeChangedHandler)
    this.element.removeEventListener("elef:preview-updated", this.previewHandler)
    this.element.removeEventListener("elef:preview-stale", this.previewStaleHandler)
    this.element.removeEventListener("click", this.clickHandler)
    this.element.removeEventListener("click", this.projectionLinkHandler)
    this.element.removeEventListener("keydown", this.blockKeydownHandler, true)
    document.removeEventListener("selectionchange", this.selectionChangeHandler)
    if (this.pendingProjectionFrame) cancelAnimationFrame(this.pendingProjectionFrame)
    this.flushPendingProjectionEdits()
    if (this.element.presentationEditorController === this) delete this.element.presentationEditorController
  }

  applyMode(mode) {
    const visual = mode !== "source"
    this.element.dataset.editorMode = visual ? "visual" : "source"
    if (!visual) this.pendingCaretRestore = null
    if (this.hasSourceTarget) this.sourceTarget.classList.toggle("is-source-hidden", visual)
    this.syncProjectionEditability()
  }

  blockFocus(event) {
    this.activeProjectionBlock = event.currentTarget
    this.element.dataset.editorProjectionActive = "true"
  }

  blockBlur() {
    syncActiveMath(this.canvasTarget, () => this.flushPendingProjectionEdits())
    this.flushPendingProjectionEdits()
    this.activeProjectionBlock = null
    delete this.element.dataset.editorProjectionActive
    this.syncProjectionEditability()
  }

  projectionLinkClicked(event) {
    if (handleMathClick(event, this.canvasTarget)) return
    syncActiveMath(this.canvasTarget, () => this.flushPendingProjectionEdits())
    const link = event.target.closest?.(".editor-projection [contenteditable='true'] a")
    if (!link) return

    event.preventDefault()
    link.closest("[contenteditable='true']")?.focus()
  }

  blockInput(event) {
    if (!this.editorController || this.updatingSource) return
    const blockElement = event.target.closest?.("[data-editor-block-id]")
    if (!blockElement || !this.canEditBlock(blockElement)) return
    const block = this.findBlock(blockElement.dataset.editorBlockId)
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

  captureCaret() {
    const selection = window.getSelection()
    const block = selection?.focusNode
      ? (selection.focusNode.nodeType === Node.ELEMENT_NODE ? selection.focusNode : selection.focusNode.parentElement)?.closest?.("[data-editor-block-id]")
      : null
    const current = block && this.canvasTarget?.contains(block)
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
    if (!this.hasCanvasTarget || !this.editorController) return false
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

    const block = [...this.canvasTarget.querySelectorAll("[data-editor-block-id]")]
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
    if (edits.length === 0) {
      if (this.operationPending && this.element.previewController?.projectionFresh !== false) {
        this.operationPending = false
        this.setControlsDisabled(false)
        this.setStatus("")
      }
      return
    }

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
    syncActiveMath(this.canvasTarget, () => this.flushPendingProjectionEdits())
    const selection = window.getSelection()
    if (!selection?.focusNode) return
    const node = selection.focusNode.nodeType === Node.ELEMENT_NODE ? selection.focusNode : selection.focusNode.parentElement
    const block = node?.closest?.("[data-editor-block-id]")
    if (!block || !this.canvasTarget?.contains(block)) return
    const visibleOffset = visibleOffsetAtPoint(block, selection.focusNode, selection.focusOffset)
    if (visibleOffset !== null) this.lastProjectionCaret = { blockId: block.dataset.editorBlockId, visibleOffset }
  }

  blockKeydown(event) {
    if (this.pendingProjectionFrame || this.pendingProjectionEdits?.size) {
      this.flushPendingProjectionEdits()
    }
    if (handleMathKeydown(event, this.canvasTarget, () => this.flushPendingProjectionEdits())) return
    if (moveCaretBetweenBlocks(event, this.canvasTarget)) return
    if (!["Backspace", "Delete"].includes(event.key)) return

    const selection = window.getSelection()
    if (!selection?.isCollapsed) return
    const node = selection.focusNode?.nodeType === Node.ELEMENT_NODE ? selection.focusNode : selection.focusNode?.parentElement
    const blockElement = node?.closest?.("[data-editor-block-id][contenteditable='true']")
    if (!blockElement || !this.canvasTarget?.contains(blockElement) || this.editableText(blockElement).trim() !== "") return
    if (blockElement.querySelector("img, video, iframe, [data-editor-math-source]")) return

    const located = this.locateBlock(blockElement.dataset.editorBlockId)
    const slide = located && this.map?.slides?.[located.slideIndex]
    const block = located?.block
    if (!slide || !block) return

    event.preventDefault()
    this.flushPendingProjectionEdits()
    const source = this.sourceValue()
    let from = this.blockOperationStart(slide, block)
    let to = block.range.end
    if (block.position_scope === "group") {
      const groupMembers = slide.blocks.filter((candidate) => candidate.position_directive_id === block.position_directive_id)
      if (groupMembers.length === 1) {
        const directiveIndex = slide.directives.findIndex((candidate) => candidate.id === block.position_directive_id)
        const closing = slide.directives.slice(directiveIndex + 1).find((candidate) => candidate.type === "position_close")
        if (closing) {
          from = slide.directives[directiveIndex].range.start
          to = closing.range.end
        }
      }
    }
    const updated = removeEmptyBlockSource(source, from, to)
    if (updated !== source) this.replaceSource(updated)
  }

  alignmentChanged(event) {
    if (!this.canOperateOnProjection()) return
    const select = event.target
    const source = this.sourceValue()
    const slideIndex = Number(select.dataset.slideIndex)
    const blockIndex = Number(select.dataset.blockIndex)
    const block = this.map?.slides?.[slideIndex]?.blocks?.[blockIndex]
    if (!block) return

    const directive = this.map.slides[slideIndex].directives.find((candidate) => candidate.id === block.position_directive_id)
    const alignment = select.value
    let updated
    if (directive) {
      const from = directive.range.start
      const to = directive.range.end
      if (alignment) {
        const lineEnding = source.slice(from, to).match(/\r\n|\n|\r$/)?.[0] || ""
        updated = `${source.slice(0, from)}:::align{${alignment}}${lineEnding}${source.slice(to)}`
      } else {
        updated = this.removePositionDirectives(source, this.map.slides[slideIndex], directive)
      }
    } else if (alignment) {
      const from = block.range.start
      updated = `${source.slice(0, from)}:::align{${alignment}}\n\n${source.slice(from)}`
    } else {
      return
    }
    this.replaceSource(updated)
  }

  handleAction(event) {
    if (!this.canOperateOnProjection()) return
    const control = event.target.closest?.("[data-presentation-editor-action]")
    if (!control || control.disabled) return
    event.preventDefault()
    const action = control.dataset.presentationEditorAction
    const slideIndex = Number(control.dataset.slideIndex)
    const blockIndex = Number(control.dataset.blockIndex)

    if (action === "delete-slide" && !window.confirm("Delete this slide?")) return
    if (action === "delete-block" && !window.confirm("Delete this block?")) return

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

  addSlide(index) {
    const source = this.sourceValue()
    const markdown = "# New slide\n\nStart writing here."
    const slides = this.map?.slides || []
    let updated
    if (index >= slides.length) {
      updated = source.trim() === ""
        ? markdown
        : `${source}${source.endsWith("\n") ? "" : "\n"}---\n${markdown}`
    } else {
      const from = slides[index].range.start
      updated = `${source.slice(0, from)}${markdown}\n---\n${source.slice(from)}`
    }
    this.replaceSource(updated)
  }

  deleteSlide(index) {
    const slides = this.map?.slides || []
    const slide = slides[index]
    if (!slide || slides.length < 2) return
    let from
    let to
    if (index === 0) {
      from = slide.range.start
      to = slide.delimiter_range?.end || slide.range.end
    } else if (index === slides.length - 1) {
      from = slides[index - 1].delimiter_range.start
      to = slide.range.end
    } else {
      from = slide.range.start
      to = slide.delimiter_range?.end || slide.range.end
    }
    const source = this.sourceValue()
    this.replaceSource(`${source.slice(0, from)}${source.slice(to)}`)
  }

  moveSlide(index, target) {
    const slides = this.map?.slides || []
    if (!slides[index] || target < 0 || target >= slides.length) return
    const source = this.sourceValue()
    const bodyStart = this.map.front_matter?.range.end || 0
    const sections = slides.map((slide) => {
      const body = source.slice(slide.range.start, slide.range.end)
      const trailing = body.match(/\s*$/)?.[0] || ""
      return { body: body.slice(0, body.length - trailing.length), trailing }
    })
    const separators = slides.slice(0, -1).map((slide, slideIndex) =>
      `${sections[slideIndex].trailing}${source.slice(slide.delimiter_range.start, slide.delimiter_range.end)}`
    )
    const finalTrailing = sections.at(-1).trailing
    const moved = sections.splice(index, 1)[0]
    sections.splice(target, 0, moved)
    const body = sections.map((section, sectionIndex) => `${section.body}${separators[sectionIndex] || ""}`).join("")
    this.replaceSource(`${source.slice(0, bodyStart)}${body}${finalTrailing}`)
  }

  addBlock(slideIndex, index) {
    const slide = this.map?.slides?.[slideIndex]
    if (!slide) return
    const source = this.sourceValue()
    const insertion = index < slide.blocks.length
      ? this.blockOperationStart(slide, slide.blocks[index])
      : slide.range.end
    if (index < slide.blocks.length) {
      this.replaceSource(`${source.slice(0, insertion)}New block\n\n${source.slice(insertion)}`)
      return
    }

    const before = source.slice(0, insertion)
    const prefix = before.trim() === "" ? "" : before.endsWith("\n") ? "\n" : "\n\n"
    const suffix = slide.delimiter_range ? "\n" : ""
    this.replaceSource(`${source.slice(0, insertion)}${prefix}New block${suffix}${source.slice(insertion)}`)
  }

  deleteBlock(slideIndex, blockIndex) {
    const slide = this.map?.slides?.[slideIndex]
    const block = slide?.blocks?.[blockIndex]
    if (!slide || !block) return
    const source = this.sourceValue()
    let from = this.blockOperationStart(slide, block)
    let to = block.range.end

    if (block.position_scope === "group") {
      const groupMembers = slide.blocks.filter((candidate) => candidate.position_directive_id === block.position_directive_id)
      if (groupMembers.length === 1) {
        const directiveIndex = slide.directives.findIndex((candidate) => candidate.id === block.position_directive_id)
        const closing = slide.directives.slice(directiveIndex + 1).find((candidate) => candidate.type === "position_close")
        if (closing) {
          from = slide.directives[directiveIndex].range.start
          to = closing.range.end
        }
      }
    }

    const before = source.slice(0, from)
    let after = source.slice(to)
    if (before.trim() === "" && after.startsWith("\n")) after = after.slice(1)
    else if (after.startsWith("\n") && before.endsWith("\n\n")) after = after.slice(1)
    this.replaceSource(`${before}${after}`)
  }

  moveBlock(slideIndex, index, target) {
    const slide = this.map?.slides?.[slideIndex]
    if (!slide || target < 0 || target >= slide.blocks.length) return
    const movingGroupId = slide.blocks[index]?.position_scope === "group"
      ? slide.blocks[index].position_directive_id
      : null
    const low = Math.min(index, target)
    const high = Math.max(index, target)
    if (slide.blocks.slice(low, high + 1).some((block) =>
      block.position_scope === "group" && block.position_directive_id !== movingGroupId
    )) return
    if (movingGroupId && slide.blocks.slice(low, high + 1).some((block) =>
      block.position_scope !== "group" || block.position_directive_id !== movingGroupId
    )) return

    const source = this.sourceValue()
    const contentEnd = (block) => {
      const raw = source.slice(block.range.start, block.range.end)
      const ending = raw.match(/\r\n|\n|\r$/)?.[0] || ""
      return block.range.end - ending.length
    }
    const starts = slide.blocks.map((block) => this.blockOperationStart(slide, block))
    const blocks = slide.blocks.map((block, blockIndex) => source.slice(starts[blockIndex], contentEnd(block)))
    const separators = slide.blocks.slice(0, -1).map((block, blockIndex) =>
      source.slice(contentEnd(block), starts[blockIndex + 1])
    )
    const trailing = source.slice(contentEnd(slide.blocks.at(-1)), slide.range.end)
    const leading = source.slice(slide.range.start, starts[0])
    const moved = blocks.splice(index, 1)[0]
    blocks.splice(target, 0, moved)
    const body = `${leading}${blocks.map((block, blockIndex) => `${block}${separators[blockIndex] || ""}`).join("")}${trailing}`
    this.replaceSource(`${source.slice(0, slide.range.start)}${body}${source.slice(slide.range.end)}`)
  }

  previewUpdated(payload) {
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

  previewStale(detail = {}) {
    this.operationPending = true
    this.setControlsDisabled(true)
    this.syncProjectionEditability({ preserveActive: detail.preserveActive })
  }

  canOperateOnProjection() {
    return this.element.dataset.editorMode !== "source" && this.element.previewController?.projectionFresh !== false
  }

  canEditBlock(blockElement) {
    if (this.element.dataset.editorMode === "source" || blockElement.dataset.editorSourceEditable === "false") return false
    if (this.element.previewController?.projectionFresh !== false) return true

    return this.activeProjectionBlock === blockElement &&
      document.activeElement?.closest?.("[contenteditable='true']") === blockElement
  }

  syncProjectionEditability({ preserveActive = false } = {}) {
    const visual = this.element.dataset.editorMode !== "source"
    const fresh = this.element.previewController?.projectionFresh !== false
    const active = preserveActive ? document.activeElement?.closest?.("[data-editor-block-id]") : null
    this.element.querySelectorAll("[data-editor-block-id][data-editor-source-editable]").forEach((block) => {
      const sourceEditable = block.dataset.editorSourceEditable !== "false"
      const editable = sourceEditable && visual && (fresh || (preserveActive && block === active))
      block.contentEditable = String(editable)
      if (editable) {
        block.setAttribute("role", "textbox")
        block.setAttribute("aria-label", block.classList.contains("slide-title") ? "Editable slide title" : "Editable slide block")
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

  sourceInput(event) {
    if (this.updatingSource || !this.editorController) return
    if (event.target !== this.editorController.inputTarget) return
    if (document.activeElement?.closest?.(".editor-projection")) return

    this.operationPending = true
    this.setControlsDisabled(true)
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

  replaceSource(source) {
    if (!this.editorController) return
    this.operationPending = true
    this.setControlsDisabled(true)
    this.updatingSource = true
    this.editorController.replaceRange(source, 0, this.editorController.value.length)
    this.updatingSource = false
    this.setStatus("Updating visual preview…")
  }

  sourceValue() {
    return this.editorController?.value || this.sourceTarget?.querySelector("textarea")?.value || ""
  }

  findBlock(id) {
    return this.map?.slides?.flatMap((slide) => slide.blocks || []).find((block) => block.id === id)
  }

  locateBlock(id) {
    for (const [slideIndex, slide] of (this.map?.slides || []).entries()) {
      const block = slide.blocks?.find((candidate) => candidate.id === id)
      if (block) return { slideIndex, block }
    }
    return null
  }

  allRegions() {
    return this.map?.editable_regions || this.map?.slides?.flatMap((slide) => slide.editable_regions || []) || []
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

  blockOperationStart(slide, block) {
    if (block.position_scope !== "block" || !block.position_directive_id) return block.range.start
    const directive = slide.directives.find((candidate) => candidate.id === block.position_directive_id)
    return directive?.range.start ?? block.range.start
  }

  updateBlockBoundaries() {
    this.element.querySelectorAll('[data-presentation-editor-action="move-block-up"], [data-presentation-editor-action="move-block-down"]').forEach((control) => {
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
        control.dataset.editorBoundaryDisabled = "true"
        control.disabled = true
      } else {
        delete control.dataset.editorBoundaryDisabled
        control.disabled = false
      }
    })
  }

  removePositionDirectives(source, slide, directive) {
    const directiveIndex = slide.directives.findIndex((candidate) => candidate.id === directive.id)
    const closing = slide.directives[directiveIndex + 1]
    const ranges = [directive]
    if (closing?.type === "position_close") ranges.push(closing)
    return ranges
      .sort((left, right) => right.range.start - left.range.start)
      .reduce((updated, candidate) => {
        const before = updated.slice(0, candidate.range.start)
        let after = updated.slice(candidate.range.end)
        if (before.endsWith("\n\n") && after.startsWith("\n")) after = after.slice(1)
        return `${before}${after}`
      }, source)
  }

  editableText(element) {
    return (element.innerText || element.textContent || "").replace(/\u00a0/g, " ").replace(/\n+$/, "")
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

  setStatus(text) {
    if (this.hasStatusTarget) this.statusTarget.textContent = text
  }

  setControlsDisabled(disabled) {
    this.element.querySelectorAll("[data-presentation-editor-action], [data-presentation-editor-align]").forEach((control) => {
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
