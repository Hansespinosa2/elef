import { Controller } from "@hotwired/stimulus"
import { editorFor } from "controllers/editor_controller"
import { markdownForVisibleText, renderInlineMath, sourceOffsetForVisiblePosition } from "controllers/editor_markdown"

export default class extends Controller {
  static targets = ["projection"]
  static values = { kind: String, focusTitle: Boolean }

  connect() {
    this.map = this.readMap()
    this.editorController = editorFor(this.element.querySelector("[data-controller~='editor']"))
    this.editorReady = (event) => {
      this.editorController = event.detail.editor
      this.applyMode(this.element.getAttribute("data-editor-mode") || "visual")
      this.focusNewDocumentTitle()
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
    this.applyMode(this.element.getAttribute("data-editor-mode") || "visual")
    this.focusNewDocumentTitle()
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

  blockFocus() {
    this.element.dataset.editorProjectionActive = "true"
  }

  blockBlur() {
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
    const replacement = markdownForVisibleText(
      currentSource,
      this.editableText(blockElement, region.kind, currentSource),
      region.kind,
      blockElement,
      { documentMode: this.kindValue === "document" }
    )
    if (replacement === currentSource) return

    this.shiftMapAfterEdit(from, to, replacement.length, blockElement.dataset.editorBlockId)
    this.editorController.replaceRange(replacement, from, to)
    if (region.kind !== "code") renderInlineMath(blockElement)
  }

  projectionKeydown(event) {
    if (this.kindValue !== "document" || event.isComposing || event.altKey || event.ctrlKey || event.metaKey) return

    const blockElement = event.target.closest?.(".document-editor-block[data-editor-block-id]")
    if (!blockElement || !this.canEditBlock(blockElement)) return

    const block = this.map?.slides?.flatMap((slide) => slide.blocks || [])
      .find((candidate) => candidate.id === blockElement.dataset.editorBlockId)
    const region = this.map?.editable_regions?.find((candidate) => candidate.block_id === block?.id)
    if (!block || !region) return

    const source = this.editorController.value
    const { start, end } = region.content_range
    const sourceMarkdown = source.slice(start, end)
    const visibleMarkdown = block.empty_placeholder ? this.editableText(blockElement, region.kind, sourceMarkdown) : ""
    const markdown = block.empty_placeholder && sourceMarkdown === "" ? visibleMarkdown : sourceMarkdown
    const kind = this.currentBlockKind(markdown, this.currentBlockKind(visibleMarkdown, region.kind))
    const emptyListItem = kind === "list" && this.hasEmptyTrailingMarker(markdown, "list")
    const emptyQuoteLine = kind === "quote" && this.hasEmptyTrailingMarker(markdown, "quote")

    if (event.key === "Backspace") {
      if (region.role === "title" && markdown.trim() === "") {
        event.preventDefault()
        return
      }
      if ((emptyListItem || emptyQuoteLine) && !this.selectionIsInEmptyStructuredLine(blockElement, kind)) return
      if (this.removeEmptyBlock(blockElement, block, region, kind, markdown, source)) event.preventDefault()
      return
    }
    if (event.key !== "Enter" || event.shiftKey || kind === "code") return

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
      const localOffset = this.sourceOffsetForSelection(blockElement, markdown)
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

  previewUpdated(payload) {
    if (payload?.editor_map) this.map = payload.editor_map
    this.syncProjectionEditability({ preserveActive: Boolean(this.focusedProjectionBlock()) })
    this.restorePendingCaret()
  }

  previewStale(detail = {}) {
    this.syncProjectionEditability({ preserveActive: detail.preserveActive || Boolean(this.focusedProjectionBlock()) })
  }

  canEditBlock(blockElement) {
    if (this.element.dataset.editorMode !== "visual") return false
    if (this.element.previewController?.projectionFresh !== false) return true

    return this.focusedProjectionBlock() === blockElement
  }

  focusedProjectionBlock() {
    const block = document.activeElement?.closest?.(".document-editor-block[data-editor-block-id]")
    return block && this.hasProjectionTarget && this.projectionTarget.contains(block) ? block : null
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

  shiftMapAfterEdit(from, to, replacementLength, editedBlockId = null) {
    if (!this.map) return

    const delta = replacementLength - (to - from)
    const shiftRange = (range, editedBlock) => {
      if (!range) return
      const shiftStart = (position) => {
        if (position === from && editedBlock) return position
        if (position <= from) return position
        if (position >= to) return position + delta
        return from
      }
      const shiftEnd = (position) => {
        if (from === to && position === from) return editedBlock ? from + replacementLength : position
        if (position <= from) return position
        if (position >= to) return position + delta
        return editedBlock ? from + replacementLength : from
      }
      range.start = shiftStart(range.start)
      range.end = Math.max(range.start, shiftEnd(range.end))
    }
    const shifted = new Set()
    const shiftObject = (object) => {
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

  readMap() {
    const source = this.element.querySelector("[data-editor-map-json]")?.textContent
    if (!source) return null
    try {
      return JSON.parse(source)
    } catch (_error) {
      return null
    }
  }

  editableText(element, kind, source = "") {
    let value
    let structuredLines
    if (kind === "list" && !element.querySelector("li li")) {
      structuredLines = [...element.querySelectorAll("li")]
      if (structuredLines.length) value = structuredLines.map((item) => (item.innerText || item.textContent || "").replace(/\u00a0/g, " ").replace(/\n+$/, "")).join("\n")
    }

    if (value === undefined && kind === "quote") {
      const quote = element.querySelector("blockquote")
      structuredLines = quote && [...quote.children].filter((child) => /^(P|DIV)$/.test(child.tagName))
      if (structuredLines?.length) value = structuredLines.map((line) => (line.innerText || line.textContent || "").replace(/\u00a0/g, " ").replace(/\n+$/, "")).join("\n")
    }

    if (value === undefined) {
      const blockChildren = [...element.children].filter((child) => /^(P|DIV|H[1-6])$/.test(child.tagName))
      value = blockChildren.length > 1
        ? blockChildren.map((child) => (child.innerText || child.textContent || "").replace(/\u00a0/g, " ").replace(/\n+$/, "")).join("\n\n")
        : (element.innerText || element.textContent || "").replace(/\u00a0/g, " ")
    }

    const lastLine = source.replace(/\r\n?/g, "\n").split("\n").at(-1) || ""
    const lastStructuredLine = structuredLines?.at(-1)
    const emptyStructuredLine = source.includes("\n") && lastStructuredLine &&
      (lastStructuredLine.innerText || lastStructuredLine.textContent || "").trim() === "" &&
      ((kind === "list" && /^[ \t]*(?:[-*+]|\d+[.)])[ \t]*$/.test(lastLine)) ||
        (kind === "quote" && /^[ \t]*>[ \t]*$/.test(lastLine)))
    if (emptyStructuredLine && !value.endsWith("\n")) value += "\n"
    return value
  }

  focusNewDocumentTitle() {
    if (!this.focusTitleValue || this.initialTitleFocused || !this.hasProjectionTarget) return

    const heading = this.projectionTarget.querySelector(".document-editor-block h1")
    const block = heading?.closest(".document-editor-block[contenteditable='true']")
    if (!heading || !block) return

    this.initialTitleFocused = true
    this.focusAtEnd(block, heading)
  }

  currentBlockKind(markdown, fallback) {
    const source = markdown.replace(/\r\n?/g, "\n")
    if (/^\s{0,3}#{1,6}(?:[ \t]+|[ \t]*$)/.test(source)) return "heading"
    if (/^\s*(?:[-*+] |\d+[.)] )/.test(source)) return "list"
    if (/^\s*>/.test(source)) return "quote"
    if (/^\s*(?:`{3,}|~{3,})/.test(source)) return "code"
    return fallback || "paragraph"
  }

  selectionIsAtEnd(element) {
    const selection = window.getSelection()
    if (!selection?.isCollapsed || !element.contains(selection.anchorNode)) return false

    const remaining = document.createRange()
    remaining.selectNodeContents(element)
    remaining.setStart(selection.anchorNode, selection.anchorOffset)
    const fragment = remaining.cloneContents()
    return fragment.textContent.replace(/[\u200b\ufeff]/g, "") === "" &&
      !fragment.querySelector("[data-editor-math-source], [data-editor-image-source], img")
  }

  selectionIsInEmptyStructuredLine(element, kind) {
    const lines = kind === "list"
      ? [...element.querySelectorAll("li")]
      : [...element.querySelectorAll("blockquote p, blockquote div")]
    const line = lines.at(-1)
    const selection = window.getSelection()
    if (!line || !selection?.isCollapsed || !element.contains(selection.anchorNode)) return false

    const text = line.innerText || line.textContent || ""
    return text.trim() === "" && (line === selection.anchorNode || line.contains(selection.anchorNode))
  }

  selectionIsInsideBlock(element) {
    const selection = window.getSelection()
    return Boolean(selection?.isCollapsed && selection.anchorNode && element.contains(selection.anchorNode))
  }

  sourceOffsetForSelection(element, markdown) {
    const selection = window.getSelection()
    if (!selection?.isCollapsed || !element.contains(selection.anchorNode)) return null

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
    let visiblePosition
    try {
      visiblePosition = (prefix.innerText || prefix.textContent || "")
        .replace(/\u00a0/g, " ")
        .replace(/\n+$/, "")
        .replace(/[\t\n\f\r ]+/g, " ").length
    } finally {
      prefix.remove()
    }

    return sourceOffsetForVisiblePosition(markdown, element, visiblePosition)
  }

  replaceAndFocus(blockElement, from, to, replacement, caret) {
    this.pendingCaret = caret
    this.shiftMapAfterEdit(from, to, replacement.length, blockElement.dataset.editorBlockId)
    this.editorController.replaceRange(replacement, from, to)
    blockElement.blur()
  }

  continueStructuredBlock(blockElement, region, kind, markdown, source, emptyMarker) {
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

  hasEmptyTrailingMarker(markdown, kind) {
    const lastLine = markdown.split("\n").at(-1) || ""
    return kind === "list"
      ? /^[ \t]*(?:[-*+]|\d+[.)])[ \t]*$/.test(lastLine)
      : /^[ \t]*>[ \t]*$/.test(lastLine)
  }

  removeEmptyBlock(blockElement, block, region, kind, markdown, source) {
    if (region.role === "title") return false

    const emptyListItem = kind === "list" && this.hasEmptyTrailingMarker(markdown, "list")
    const emptyQuoteLine = kind === "quote" && this.hasEmptyTrailingMarker(markdown, "quote")
    const emptyPlaceholder = block.empty_placeholder && markdown.trim() === ""
    if (!emptyListItem && !emptyQuoteLine && !emptyPlaceholder) return false

    const from = region.content_range.start
    const to = region.content_range.end
    let replacement
    let sourceOffset
    let location
    if (emptyPlaceholder) {
      const prefix = source.slice(0, block.range.start)
      const endings = [...prefix.matchAll(/\r\n|\r|\n/g)]
      if (endings.length < 2) return false

      const deleteFrom = endings.at(-2).index
      const deleteTo = block.range.start
      this.pendingCaret = { sourceOffset: deleteFrom, location: "block_end" }
      this.shiftMapAfterEdit(deleteFrom, deleteTo, 0, block.id)
      this.editorController.replaceRange("", deleteFrom, deleteTo)
      blockElement.blur()
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

  restorePendingCaret() {
    const pending = this.pendingCaret
    if (!pending || !this.map) return

    const blocks = this.map.slides?.flatMap((slide) => slide.blocks || []) || []
    const containsCaret = (block) => block.range.start <= pending.sourceOffset && block.range.end >= pending.sourceOffset
    const candidate = blocks.find((block) => block.empty_placeholder && containsCaret(block)) ||
      blocks.find((block) => !block.empty_placeholder && block.range.start <= pending.sourceOffset && block.range.end > pending.sourceOffset) ||
      blocks.find((block) => !block.empty_placeholder && block.range.end === pending.sourceOffset)
    const element = candidate && this.projectionTarget.querySelector(`[data-editor-block-id="${CSS.escape(candidate.id)}"]`)
    if (!candidate || !element) return

    this.pendingCaret = null
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

  focusAtEnd(block, target = block) {
    block.focus({ preventScroll: true })
    const range = document.createRange()
    range.selectNodeContents(target)
    range.collapse(false)
    const selection = window.getSelection()
    selection.removeAllRanges()
    selection.addRange(range)
  }
}
