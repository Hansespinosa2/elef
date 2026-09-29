import { Controller } from "@hotwired/stimulus"
import { pointAtVisibleOffset, visibleOffsetAtPoint } from "controllers/editor_caret"

const DESIGN_WIDTH = 794

const FLOW_TEXT_SELECTOR = "p, h1, h2, h3, h4, h5, h6, pre, li, td, th"
const HIDDEN_TEXT_SELECTOR = ".katex-mathml, [aria-hidden='true'], [contenteditable='false']"

export default class extends Controller {
  static targets = ["surface"]

  connect() {
    this.active = true
    this.nextFlowId = 0
    this.nextCaretTargetId = 0
    this.paginationGeneration = 0
    this.resizeFrame = null
    this.reflowFrame = null
    this.reflowTimer = null
    this.boundResize = () => this.resizeFrames()
    this.form = this.element.closest(".visual-editor-form")
    this.modeChangedHandler = () => this.resizeFrames()
    this.form?.addEventListener("elef:editor-mode-change", this.modeChangedHandler)
    this.boundFocusOut = () => queueMicrotask(() => {
      if (this.active && !this.focusedEditable()) this.schedulePagination()
    })
    this.resizeObserver = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(this.boundResize)
    this.mutationObserver = typeof MutationObserver === "undefined" ? null : new MutationObserver(() => this.schedulePagination())

    window.addEventListener("resize", this.boundResize)
    this.surfaceTarget.addEventListener("focusout", this.boundFocusOut)
    this.surfaceTarget.dataset.documentPagesSettled = "false"
    this.paginate()
    this.mutationObserver?.observe(this.surfaceTarget, { childList: true, characterData: true, subtree: true })

    if (document.fonts?.ready) {
      document.fonts.ready.then(() => {
        if (this.active) this.schedulePagination()
      })
    }
  }

  disconnect() {
    this.active = false
    window.removeEventListener("resize", this.boundResize)
    this.form?.removeEventListener("elef:editor-mode-change", this.modeChangedHandler)
    this.surfaceTarget.removeEventListener("focusout", this.boundFocusOut)
    this.resizeObserver?.disconnect()
    this.mutationObserver?.disconnect()
    cancelAnimationFrame(this.resizeFrame)
    cancelAnimationFrame(this.reflowFrame)
    clearTimeout(this.reflowTimer)
  }

  resizeFrames() {
    if (!this.surfaceTarget) return
    const preview = this.sourceModePreview()
    const previewStyle = preview && getComputedStyle(preview)
    const fittedWidth = previewStyle
      ? Math.max(0, Math.min(
        DESIGN_WIDTH,
        preview.clientWidth - parseFloat(previewStyle.paddingLeft) - parseFloat(previewStyle.paddingRight),
        (preview.clientHeight - parseFloat(previewStyle.paddingTop) - parseFloat(previewStyle.paddingBottom)) * 210 / 297
      ))
      : null

    this.surfaceTarget.querySelectorAll(".document-page-frame").forEach((frame) => {
      if (fittedWidth === null) frame.style.removeProperty("width")
      else frame.style.width = `${fittedWidth}px`
      frame.style.setProperty("--document-page-scale", frame.clientWidth / DESIGN_WIDTH)
    })
  }

  sourceModePreview() {
    if (this.form?.dataset.editorMode !== "source") return null
    return this.element.closest(".preview-pane")
  }

  schedulePagination() {
    if (!this.active) return
    this.surfaceTarget.dataset.documentPagesSettled = "false"
    if (this.focusedEditable()) {
      clearTimeout(this.reflowTimer)
      this.reflowTimer = null
      return
    }
    clearTimeout(this.reflowTimer)
    this.reflowTimer = setTimeout(() => {
      this.reflowTimer = null
      if (!this.active || this.reflowFrame) return
      this.reflowFrame = requestAnimationFrame(() => {
        this.reflowFrame = null
        if (!this.active || this.focusedEditable() || !this.projectionFresh()) return
        this.paginate()
      })
    }, 300)
  }

  paginate() {
    if (!this.surfaceTarget || !this.active) return

    const generation = ++this.paginationGeneration
    const caret = this.captureCaret() || this.pendingCaretRestore
    this.pendingCaretRestore = caret
    this.resizeObserver?.disconnect()
    const blocks = this.logicalBlocks()
    blocks.forEach((block) => this.ensureFlowId(block))

    this.surfaceTarget.replaceChildren()
    this.surfaceTarget.classList.add("is-paginated")
    const pages = []
    let currentPage = this.createPage(pages.length + 1)
    pages.push(currentPage)

    this.pageUnits(blocks).forEach((unit) => {
      const hadContent = currentPage.content.childElementCount > 0
      unit.forEach((block) => currentPage.content.append(block))
      if (!this.overflows(currentPage)) return

      unit.forEach((block) => currentPage.content.removeChild(block))
      if (hadContent) {
        currentPage = this.createPage(pages.length + 1)
        pages.push(currentPage)
        unit.forEach((block) => currentPage.content.append(block))
        if (!this.overflows(currentPage)) return
        unit.forEach((block) => currentPage.content.removeChild(block))
      }

      if (unit.length > 1) {
        unit.slice(0, -1).forEach((block) => currentPage.content.append(block))
        this.flowBlock(unit.at(-1), pages, currentPage, unit.slice(0, -1))
      } else {
        this.flowBlock(unit[0], pages, currentPage)
      }
      currentPage = pages.at(-1)
    })

    pages.forEach(({ page, number, frame }) => {
      page.setAttribute("aria-label", `Document page ${number} of ${pages.length}`)
      page.querySelector(".document-page-number").textContent = `Page ${number} of ${pages.length}`
      if (this.resizeObserver) this.resizeObserver.observe(frame)
    })
    const preview = this.element.closest(".preview-pane")
    if (preview && this.resizeObserver) this.resizeObserver.observe(preview)

    this.resizeFrames()
    this.mutationObserver?.takeRecords()
    requestAnimationFrame(() => {
      if (!this.active || generation !== this.paginationGeneration) return
      if (caret) this.restoreCaret(caret)
      this.pendingCaretRestore = null
      this.finishPagination({ paginated: true })
    })
  }

  finishPagination({ paginated = false } = {}) {
    if (!this.active || !this.surfaceTarget) return
    this.surfaceTarget.dataset.documentPagesSettled = "true"
    this.surfaceTarget.dispatchEvent(new CustomEvent("elef:document-pages-settled", { bubbles: true }))
    if (paginated) this.surfaceTarget.dispatchEvent(new CustomEvent("elef:document-paginated", { bubbles: true }))
  }

  logicalBlocks() {
    const frames = [...this.surfaceTarget.children].filter((child) => child.classList.contains("document-page-frame"))
    const blocks = frames.length
      ? frames.flatMap((frame) => [...frame.querySelector(".document-page-content").children])
      : [...this.surfaceTarget.children]

    const logical = []
    const positions = new Map()
    blocks.forEach((block) => {
      const flowId = block.dataset.documentPageFlowId
      const existingIndex = flowId ? positions.get(flowId) : null
      if (existingIndex === undefined || existingIndex === null) {
        if (flowId) positions.set(flowId, logical.length)
        logical.push(block)
        return
      }

      this.mergeFlowFragment(logical[existingIndex], block)
    })

    logical.forEach((block) => {
      (block.matches("[data-document-page-flow-content]") ? block : block.querySelector("[data-document-page-flow-content]"))
        ?.removeAttribute("data-document-page-flow-content")
    })

    return logical
  }

  mergeFlowFragment(first, next) {
    const firstTarget = first.matches("[data-document-page-flow-content]")
      ? first
      : first.querySelector("[data-document-page-flow-content]")
    const nextTarget = next.matches("[data-document-page-flow-content]")
      ? next
      : next.querySelector("[data-document-page-flow-content]")
    if (!firstTarget || !nextTarget || firstTarget.tagName !== nextTarget.tagName) return

    while (nextTarget.firstChild) firstTarget.append(nextTarget.firstChild)
    next.remove()
  }

  ensureFlowId(block) {
    if (block.dataset.documentPageFlowId) return
    this.nextFlowId += 1
    block.dataset.documentPageFlowId = `flow-${this.nextFlowId}`
  }

  pageUnits(blocks) {
    const units = []

    let index = 0
    while (index < blocks.length) {
      const unit = []
      while (blocks[index]?.matches(".document-source-anchor")) {
        unit.push(blocks[index])
        index += 1
      }

      const block = blocks[index]
      if (!block) {
        if (unit.length) units.push(unit)
        break
      }

      unit.push(block)
      index += 1
      if (this.isHeading(block)) {
        while (true) {
          while (blocks[index]?.matches(".document-source-anchor")) {
            unit.push(blocks[index])
            index += 1
          }

          const next = blocks[index]
          if (!next) break
          unit.push(next)
          index += 1
          if (!this.isHeading(next)) break
        }
      }
      units.push(unit)
    }

    return units
  }

  isHeading(block) {
    return /^H[1-6]$/.test(block.tagName) || Boolean(block.querySelector(":scope > h1, :scope > h2, :scope > h3, :scope > h4, :scope > h5, :scope > h6"))
  }

  flowBlock(block, pages, page, keepWith = []) {
    let remainder = block
    let currentPage = page

    while (remainder) {
      currentPage.content.append(remainder)
      if (!this.overflows(currentPage)) return
      currentPage.content.removeChild(remainder)

      let split = this.splitBlock(remainder, currentPage)

      if (!split && keepWith.length && keepWith.every((node) => currentPage.content.contains(node))) {
        if (currentPage.content.childElementCount > keepWith.length) {
          keepWith.forEach((node) => currentPage.content.removeChild(node))
          currentPage = this.createPage(pages.length + 1)
          pages.push(currentPage)
          currentPage.content.append(...keepWith)
          split = this.splitBlock(remainder, currentPage)
        }
      }

      if (!split && currentPage.content.childElementCount > 0) {
        if (keepWith.length && keepWith.every((node) => currentPage.content.contains(node))) {
          currentPage.content.append(remainder)
          currentPage.page.classList.add("is-overflowing-content")
          return
        }

        currentPage = this.createPage(pages.length + 1)
        pages.push(currentPage)
        split = this.splitBlock(remainder, currentPage)
      }

      if (!split) {
        // Keep otherwise indivisible media or tables visible. Their intrinsic
        // content remains intact and the following Markdown block starts on
        // the next fixed-size page.
        currentPage.content.append(remainder)
        currentPage.page.classList.add("is-overflowing-content")
        return
      }

      currentPage.content.append(split[0])
      keepWith = []
      remainder = split[1]
      currentPage = this.createPage(pages.length + 1)
      pages.push(currentPage)
    }
  }

  splitBlock(block, page) {
    const groupedSplit = this.splitGroupedChildren(block, page)
    if (groupedSplit) return groupedSplit

    const target = this.splittableTextTarget(block)
    if (!target) return null
    const textMap = this.textMap(target)
    if (textMap.text.length < 2) return null

    const wordBoundaries = this.wordBoundaries(textMap.text)
    let best = this.largestFittingBoundary(block, target, textMap, wordBoundaries, page)
    if (!best) {
      const characterBoundaries = this.characterBoundaries(textMap.text)
      best = this.largestFittingBoundary(block, target, textMap, characterBoundaries, page)
    }
    if (!best) return null

    return [
      this.textFragment(block, target, textMap, 0, best),
      this.textFragment(block, target, textMap, best, textMap.text.length)
    ]
  }

  splitGroupedChildren(block, page) {
    const list = block.matches("ul, ol") ? block : block.querySelector("ul, ol")
    if (list && list.children.length > 1 && [...list.children].every((child) => child.tagName === "LI")) {
      const children = [...list.children]
      const bestCount = this.largestFittingChildCount(block, list, children, page)
      if (bestCount > 0 && bestCount < children.length) {
        return [
          this.childFragment(block, list, children.slice(0, bestCount)),
          this.childFragment(block, list, children.slice(bestCount))
        ]
      }
    }

    const quote = block.matches("blockquote") ? block : block.querySelector("blockquote")
    if (quote && quote.children.length > 1 && [...quote.children].every((child) => /^(P|DIV)$/.test(child.tagName))) {
      const children = [...quote.children]
      const bestCount = this.largestFittingChildCount(block, quote, children, page)
      if (bestCount > 0 && bestCount < children.length) {
        return [
          this.childFragment(block, quote, children.slice(0, bestCount)),
          this.childFragment(block, quote, children.slice(bestCount))
        ]
      }
    }

    const table = block.matches("table") ? block : block.querySelector("table")
    const tableBody = table?.tBodies?.[0]
    if (table && tableBody && tableBody.rows.length > 1) {
      const children = [...tableBody.rows]
      const bestCount = this.largestFittingChildCount(block, tableBody, children, page)
      if (bestCount > 0 && bestCount < children.length) {
        return [
          this.childFragment(block, tableBody, children.slice(0, bestCount)),
          this.childFragment(block, tableBody, children.slice(bestCount))
        ]
      }
    }

    return null
  }

  largestFittingChildCount(block, target, children, page) {
    let low = 1
    let high = children.length - 1
    let best = 0

    while (low <= high) {
      const count = Math.floor((low + high) / 2)
      const candidate = this.childFragment(block, target, children.slice(0, count))
      page.content.append(candidate)
      const fits = !this.overflows(page)
      page.content.removeChild(candidate)
      if (fits) {
        best = count
        low = count + 1
      } else {
        high = count - 1
      }
    }

    return best
  }

  childFragment(block, target, children) {
    const clone = block.cloneNode(true)
    const cloneTarget = this.nodeAtPath(clone, this.nodePath(block, target))
    cloneTarget.replaceChildren(...children.map((child) => child.cloneNode(true)))
    cloneTarget.dataset.documentPageFlowContent = "true"
    return clone
  }

  splittableTextTarget(block) {
    const selector = FLOW_TEXT_SELECTOR
    if (block.matches(selector)) return block

    const candidates = [...block.querySelectorAll(selector)].filter((element) => this.textMap(element).text.length > 1)
    return candidates.length === 1 ? candidates[0] : null
  }

  largestFittingBoundary(block, target, textMap, boundaries, page) {
    let low = 0
    let high = boundaries.length - 1
    let best = 0

    while (low <= high) {
      const index = Math.floor((low + high) / 2)
      const end = boundaries[index]
      if (end >= textMap.text.length) {
        high = index - 1
        continue
      }

      const candidate = this.textFragment(block, target, textMap, 0, end)
      page.content.append(candidate)
      const fits = !this.overflows(page)
      page.content.removeChild(candidate)
      if (fits) {
        best = end
        low = index + 1
      } else {
        high = index - 1
      }
    }

    return best
  }

  textFragment(block, target, textMap, from, to) {
    const clone = block.cloneNode(true)
    const cloneTarget = this.nodeAtPath(clone, this.nodePath(block, target))
    const range = document.createRange()
    const start = this.pointAtTextOffset(textMap, from)
    const end = this.pointAtTextOffset(textMap, to)
    range.setStart(start.node, start.offset)
    range.setEnd(end.node, end.offset)
    cloneTarget.replaceChildren(range.cloneContents())
    cloneTarget.dataset.documentPageFlowContent = "true"
    return clone
  }

  textMap(element) {
    const nodes = []
    const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT, {
      acceptNode: (node) => node.parentElement?.closest(HIDDEN_TEXT_SELECTOR) ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_ACCEPT
    })
    let node
    let text = ""
    while ((node = walker.nextNode())) {
      nodes.push({ node, start: text.length, end: text.length + node.textContent.length })
      text += node.textContent
    }
    return { nodes, text, root: element }
  }

  pointAtTextOffset(textMap, offset) {
    if (offset <= 0) return { node: textMap.root, offset: 0 }
    if (offset >= textMap.text.length) return { node: textMap.root, offset: textMap.root.childNodes.length }
    const entry = textMap.nodes.find(({ start, end }) => offset >= start && offset <= end) || textMap.nodes.at(-1)
    return { node: entry.node, offset: Math.max(0, Math.min(offset - entry.start, entry.node.textContent.length)) }
  }

  wordBoundaries(text) {
    const boundaries = []
    for (let index = 0; index < text.length; index += 1) {
      if (/\s/.test(text[index])) boundaries.push(index + 1)
    }
    return boundaries.length ? boundaries : this.characterBoundaries(text)
  }

  characterBoundaries(text) {
    const boundaries = []
    for (let index = 1; index <= text.length; index += 1) {
      if (index === text.length || !/[\uDC00-\uDFFF]/.test(text[index])) boundaries.push(index)
    }
    return boundaries
  }

  nodePath(root, target) {
    const path = []
    let node = target
    while (node !== root) {
      const parent = node.parentNode
      path.unshift([...parent.childNodes].indexOf(node))
      node = parent
    }
    return path
  }

  nodeAtPath(root, path) {
    return path.reduce((node, index) => node.childNodes[index], root)
  }

  captureCaret() {
    const selection = window.getSelection()
    if (!selection?.focusNode) return null
    const node = selection.focusNode.nodeType === Node.ELEMENT_NODE ? selection.focusNode : selection.focusNode.parentElement
    const block = node?.closest?.("[data-editor-block-id][contenteditable='true']")
    if (!block || !this.surfaceTarget.contains(block)) return null

    // A fresh preview arrives as unpaginated HTML, so its focused block has no
    // flow ID yet. Assign one before paginate() replaces the surface; otherwise
    // restoreCaret() cannot find the new fragment and the editor loses focus.
    this.ensureFlowId(block)
    const flowId = block.dataset.documentPageFlowId
    const fragments = flowId ? this.pageFragments(flowId) : [block]
    const index = fragments.indexOf(block)
    const prefix = fragments.slice(0, Math.max(0, index)).reduce((sum, fragment) => sum + this.visibleTextLength(fragment), 0)
    const local = visibleOffsetAtPoint(block, selection.focusNode, selection.focusOffset)
    if (local === null) return null

    const structuredLine = node?.closest?.("li, blockquote > p, blockquote > div")
    let caretTargetId = null
    let caretTargetOffset = null
    if (structuredLine && block.contains(structuredLine)) {
      this.nextCaretTargetId += 1
      caretTargetId = `caret-${this.nextCaretTargetId}`
      caretTargetOffset = visibleOffsetAtPoint(structuredLine, selection.focusNode, selection.focusOffset)
      structuredLine.dataset.documentPageCaretTarget = caretTargetId
    }

    return {
      blockId: block.dataset.editorBlockId,
      flowId,
      visibleOffset: prefix + local,
      caretTargetId,
      caretTargetOffset
    }
  }

  restoreCaret(caret) {
    const fragments = caret.flowId ? this.pageFragments(caret.flowId) : []
    const block = fragments.find((fragment) => fragment.dataset.editorBlockId === caret.blockId)
    if (!block || block.contentEditable !== "true") return

    let target = block
    let point = null
    if (caret.caretTargetId) {
      const markedTargets = [...this.surfaceTarget.querySelectorAll("[data-document-page-caret-target]")]
      const caretTarget = markedTargets.find((element) => element.dataset.documentPageCaretTarget === caret.caretTargetId)
      markedTargets.forEach((element) => element.removeAttribute("data-document-page-caret-target"))
      const targetBlock = caretTarget?.closest?.("[data-editor-block-id]")
      if (caretTarget && targetBlock?.contentEditable === "true") {
        target = targetBlock
        point = pointAtVisibleOffset(caretTarget, caret.caretTargetOffset || 0)
      }
    }

    if (!point) {
      let offset = caret.visibleOffset
      for (const fragment of fragments) {
        const length = this.visibleTextLength(fragment)
        if (offset <= length) {
          target = fragment
          break
        }
        offset -= length
        target = fragment
      }
      point = pointAtVisibleOffset(target, offset)
    }

    target.focus({ preventScroll: true })
    window.getSelection()?.setPosition(point[0], point[1])
  }

  pageFragments(flowId) {
    return [...this.surfaceTarget.querySelectorAll("[data-document-page-flow-id]")]
      .filter((block) => block.dataset.documentPageFlowId === flowId)
  }

  visibleTextLength(element) {
    const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT, {
      acceptNode: (node) => node.parentElement?.closest(HIDDEN_TEXT_SELECTOR) ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_ACCEPT
    })
    let length = 0
    while (walker.nextNode()) length += walker.currentNode.textContent.length
    return length
  }

  createPage(number) {
    const frame = document.createElement("div")
    frame.className = "document-page-frame"

    const page = document.createElement("article")
    page.className = "document-page"

    const content = document.createElement("div")
    content.className = "document-page-content"

    const footer = document.createElement("footer")
    footer.className = "document-page-footer"
    footer.setAttribute("aria-hidden", "true")

    const pageNumber = document.createElement("span")
    pageNumber.className = "document-page-number"
    pageNumber.textContent = `Page ${number}`
    footer.append(pageNumber)

    page.append(content, footer)
    frame.append(page)
    this.surfaceTarget.append(frame)
    return { content, number, page, frame }
  }

  overflows({ content }) {
    return content.scrollHeight > content.clientHeight + 1
  }

  focusedEditable() {
    const active = document.activeElement
    return Boolean(active?.isContentEditable && this.surfaceTarget.contains(active))
  }

  projectionFresh() {
    return this.element.closest("form")?.previewController?.projectionFresh !== false
  }
}
