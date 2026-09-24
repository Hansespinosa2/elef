import { Controller } from "@hotwired/stimulus"
import { editorFor } from "controllers/editor_controller"
import { markdownForVisibleText, renderInlineMath } from "controllers/editor_markdown"

export default class extends Controller {
  static targets = ["projection"]
  static values = { kind: String }

  connect() {
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
    this.applyMode("visual")
  }

  disconnect() {
    this.element.removeEventListener("elef:editor-ready", this.editorReady)
    this.element.removeEventListener("elef:editor-mode-change", this.modeChangedHandler)
    this.element.removeEventListener("elef:preview-updated", this.previewHandler)
    this.element.removeEventListener("elef:preview-stale", this.previewStaleHandler)
    this.element.removeEventListener("click", this.projectionLinkHandler)
  }

  modeChanged(event) {
    this.applyMode(event.detail.mode)
  }

  applyMode(mode) {
    const visual = mode !== "source"
    this.element.dataset.editorMode = visual ? "visual" : "source"
    if (this.hasProjectionTarget) this.projectionTarget.setAttribute("aria-label", visual ? "Visual editing surface" : "Rendered preview")
    this.syncProjectionEditability()
  }

  blockFocus(event) {
    this.activeProjectionBlock = event.currentTarget
    this.element.dataset.editorProjectionActive = "true"
  }

  blockBlur() {
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
    const currentSource = this.editorController.value.slice(from, to)
    const replacement = markdownForVisibleText(currentSource, this.editableText(blockElement), region.kind, blockElement)
    if (replacement === currentSource) return

    this.shiftMapAfterEdit(from, to, replacement.length)
    this.editorController.replaceRange(replacement, from, to)
    if (region.kind !== "code") renderInlineMath(blockElement)
  }

  previewUpdated(payload) {
    if (payload?.editor_map) this.map = payload.editor_map
    this.syncProjectionEditability({ preserveActive: Boolean(this.activeProjectionBlock && this.element.dataset.editorProjectionActive === "true") })
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
