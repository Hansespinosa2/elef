import { Controller } from "@hotwired/stimulus"
import { editorFor } from "controllers/editor_controller"
import { markdownForVisibleText, renderInlineMath } from "controllers/editor_markdown"

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
    this.clickHandler = (event) => this.handleAction(event)
    this.element.addEventListener("click", this.clickHandler)
    this.projectionLinkHandler = (event) => this.projectionLinkClicked(event)
    this.element.addEventListener("click", this.projectionLinkHandler)
    this.applyMode("visual")
  }

  disconnect() {
    this.element.removeEventListener("elef:editor-ready", this.editorReady)
    this.element.removeEventListener("input", this.sourceInputHandler)
    this.element.removeEventListener("elef:editor-mode-change", this.modeChangedHandler)
    this.element.removeEventListener("elef:preview-updated", this.previewHandler)
    this.element.removeEventListener("click", this.clickHandler)
    this.element.removeEventListener("click", this.projectionLinkHandler)
    if (this.element.presentationEditorController === this) delete this.element.presentationEditorController
  }

  applyMode(mode) {
    const visual = mode !== "source"
    this.element.dataset.editorMode = visual ? "visual" : "source"
    if (this.hasCanvasTarget) this.canvasTarget.hidden = !visual
    if (this.hasSourceTarget) this.sourceTarget.classList.toggle("is-source-hidden", visual)
  }

  blockFocus() {
    this.element.dataset.editorProjectionActive = "true"
  }

  blockBlur() {
    delete this.element.dataset.editorProjectionActive
  }

  projectionLinkClicked(event) {
    const link = event.target.closest?.(".editor-projection [contenteditable='true'] a")
    if (!link) return

    event.preventDefault()
    link.closest("[contenteditable='true']")?.focus()
  }

  blockInput(event) {
    if (!this.editorController || this.updatingSource) return
    const blockElement = event.target.closest?.("[data-editor-block-id]")
    if (!blockElement) return
    const block = this.findBlock(blockElement.dataset.editorBlockId)
    const region = this.map?.editable_regions?.find((candidate) => candidate.block_id === block?.id)
    if (!block || !region) return

    const from = region.content_range.start
    const to = region.content_range.end
    const currentSource = this.editorController.value.slice(from, to)
    const replacement = markdownForVisibleText(currentSource, this.editableText(blockElement), region.kind, blockElement)
    if (replacement === currentSource) return

    this.operationPending = true
    this.setControlsDisabled(true)
    this.setStatus("Updating visual structure… finish editing to refresh the controls.")
    this.shiftMapAfterEdit(from, to, replacement.length)
    this.editorController.replaceRange(replacement, from, to)
    if (region.kind !== "code") renderInlineMath(blockElement)
  }

  positionChanged(event) {
    const select = event.target
    const source = this.sourceValue()
    const slideIndex = Number(select.dataset.slideIndex)
    const blockIndex = Number(select.dataset.blockIndex)
    const block = this.map?.slides?.[slideIndex]?.blocks?.[blockIndex]
    if (!block) return

    const directive = this.map.slides[slideIndex].directives.find((candidate) => candidate.id === block.position_directive_id)
    const position = select.value
    let updated
    if (directive) {
      const from = directive.range.start
      const to = directive.range.end
      if (position) {
        const lineEnding = source.slice(from, to).match(/\r\n|\n|\r$/)?.[0] || ""
        updated = `${source.slice(0, from)}:::position{${position}}${lineEnding}${source.slice(to)}`
      } else {
        updated = this.removePositionDirectives(source, this.map.slides[slideIndex], directive)
      }
    } else if (position) {
      const from = block.range.start
      updated = `${source.slice(0, from)}:::position{${position}}\n\n${source.slice(from)}`
    } else {
      return
    }
    this.replaceSource(updated)
  }

  handleAction(event) {
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
    const insertion = index < slide.blocks.length ? slide.blocks[index].range.start : slide.range.end
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
    const block = this.map?.slides?.[slideIndex]?.blocks?.[blockIndex]
    if (!block) return
    const source = this.sourceValue()
    const before = source.slice(0, block.range.start)
    let after = source.slice(block.range.end)
    if (before.trim() === "" && after.startsWith("\n")) after = after.slice(1)
    else if (after.startsWith("\n") && before.endsWith("\n\n")) after = after.slice(1)
    this.replaceSource(`${before}${after}`)
  }

  moveBlock(slideIndex, index, target) {
    const slide = this.map?.slides?.[slideIndex]
    if (!slide || target < 0 || target >= slide.blocks.length) return
    const source = this.sourceValue()
    const contentEnd = (block) => {
      const raw = source.slice(block.range.start, block.range.end)
      const ending = raw.match(/\r\n|\n|\r$/)?.[0] || ""
      return block.range.end - ending.length
    }
    const blocks = slide.blocks.map((block) => source.slice(block.range.start, contentEnd(block)))
    const separators = slide.blocks.slice(0, -1).map((block, blockIndex) =>
      source.slice(contentEnd(block), slide.blocks[blockIndex + 1].range.start)
    )
    const trailing = source.slice(contentEnd(slide.blocks.at(-1)), slide.range.end)
    const moved = blocks.splice(index, 1)[0]
    blocks.splice(target, 0, moved)
    const from = slide.range.start
    const to = slide.range.end
    const body = blocks.map((block, blockIndex) => `${block}${separators[blockIndex] || ""}`).join("")
    this.replaceSource(`${source.slice(0, from)}${body}${trailing}${source.slice(to)}`)
  }

  previewUpdated(payload) {
    if (!payload?.editor_map) {
      if (this.operationPending) this.setStatus("Visual controls are paused until the preview recovers.")
      return
    }
    const wasPending = this.operationPending
    this.map = payload.editor_map
    this.operationPending = false
    if (wasPending) this.setControlsDisabled(false)
    this.setStatus("")
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
    this.editorController.focus()
  }

  sourceValue() {
    return this.editorController?.value || this.sourceTarget?.querySelector("textarea")?.value || ""
  }

  findBlock(id) {
    return this.map?.slides?.flatMap((slide) => slide.blocks || []).find((block) => block.id === id)
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
    this.element.querySelectorAll("[data-presentation-editor-action], [data-presentation-editor-position]").forEach((control) => {
      if (!disabled && control.dataset.editorBoundaryDisabled === "true") return
      if (disabled) {
        control.dataset.editorOriginalDisabled = String(control.disabled)
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
