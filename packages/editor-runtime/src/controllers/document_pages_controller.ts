import { Controller } from "@hotwired/stimulus"
import { pointAtVisibleOffset, visibleOffsetAtPoint } from "./editor_caret.js"
import { markStage } from "../lib/stage_marks.js"

interface DocumentPage {
  content: HTMLElement;
  number: number;
  page: HTMLElement;
  frame: HTMLElement;
}

interface TextMapEntry {
  node: Node;
  start: number;
  end: number;
}

interface TextMap {
  nodes: TextMapEntry[];
  text: string;
  root: Element;
}

interface CapturedCaret {
  blockId: string | undefined;
  flowId: string | undefined;
  visibleOffset: number;
  caretTargetId: string | null;
  caretTargetOffset: number | null;
}

const DESIGN_WIDTH = 794

const FLOW_TEXT_SELECTOR = "p, h1, h2, h3, h4, h5, h6, pre, li, td, th"
const HIDDEN_TEXT_SELECTOR = ".katex, .katex-mathml, [aria-hidden='true'], [contenteditable='false']"
const ART_ITEM_TOO_TALL = "ART_ITEM_TOO_TALL"

// S4 paginate counters: overflows() is the forced-layout hot spot, so the
// benchmark reads counts + accumulated ms from here (reset per pass).
type PaginateStats = {
  overflows: number
  overflowsMs: number
  overflowsMax: number
  probeOverflows: number
  probeOverflowsMs: number
  flows: number
  units: number
  batches: number
  replays: number
}

function paginateStats(): PaginateStats {
  const host = globalThis as { __paginateStats?: PaginateStats }
  host.__paginateStats ??= { overflows: 0, overflowsMs: 0, overflowsMax: 0, probeOverflows: 0, probeOverflowsMs: 0, flows: 0, units: 0, batches: 0, replays: 0 }
  return host.__paginateStats
}

function resetPaginateStats(): void {
  const stats = paginateStats()
  stats.overflows = 0
  stats.overflowsMs = 0
  stats.overflowsMax = 0
  stats.probeOverflows = 0
  stats.probeOverflowsMs = 0
  stats.flows = 0
  stats.units = 0
  stats.batches = 0
  stats.replays = 0
}

function now(): number {
  return typeof performance === "undefined" ? 0 : performance.now()
}

export default class extends Controller<HTMLElement> {
  static targets = ["surface"]

  connect() {
    markStage("pages-connect")
    this.active = true
    this.nextFlowId = 0
    this.nextCaretTargetId = 0
    this.paginationGeneration = 0
    this.probingDepth = 0
    this.openPage = null
    this.resizeFrame = null
    this.reflowFrame = null
    this.reflowTimer = null
    this.paginatedOnce = false
    this.firstPassWithoutFonts = false
    const connection = {}
    this.resourceConnection = connection
    this.resourceTimer = null
    this.watchedImages = new Map<HTMLImageElement, () => void>()
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
    this.mutationObserver?.observe(this.surfaceTarget, { childList: true, characterData: true, subtree: true })

    // Resources-first single pagination: webfont arrival shifts every line
    // box and unloaded images measure at zero height, so a pre-resources
    // pass is always thrown away (2.0s mixed / 4.7s math of the cold-open
    // profile). When fonts or surface images are still loading, await
    // them before the first pass instead of paginating twice; a timeout
    // keeps a slow host from holding the page hostage (the late pass
    // then repaginates once resources land, as before). Cached resources
    // paginate immediately with no second pass.
    this.watchSurfaceImages()
    if (this.resourcesReady()) {
      this.paginate()
    } else {
      const firstPass = () => {
        this.resourceTimer = null
        if (this.paginatedOnce || !this.active) return
        this.paginate()
      }
      this.resourceTimer = setTimeout(firstPass, 3000)
      document.fonts?.ready.then(() => {
        if (!this.active || this.resourceConnection !== connection) return
        if (this.paginatedOnce) {
          if (this.firstPassWithoutFonts) this.schedulePagination()
        }
        else this.maybeFirstPass()
      })
    }
  }

  // True when the first pass may measure: fonts settled (or unsupported)
  // and every surface image finished loading (error counts: broken
  // images render deterministically at their alt box).
  resourcesReady(): boolean {
    const fonts = (typeof document === "undefined" ? undefined : document.fonts) as FontFaceSet | undefined
    if (fonts && fonts.status !== "loaded") return false
    const images = this.surfaceTarget.querySelectorAll("img")
    for (const image of images) {
      if (!(image as HTMLImageElement).complete) return false
    }
    return true
  }

  // Re-check the first-pass gate after any resource trigger (font ready,
  // image load/error, surface mutation from install). Clears the timeout
  // once resources settle so the late pass never double-fires.
  maybeFirstPass(): void {
    if (this.paginatedOnce || !this.active) return
    this.watchSurfaceImages()
    if (!this.resourcesReady()) return
    clearTimeout(this.resourceTimer)
    this.resourceTimer = null
    this.paginate()
  }

  // Image triggers are idempotent: newly installed images get listeners
  // on the next mutation recheck; fired listeners drop out of the set.
  // A post-first-pass image arrival repaginates (late images previously
  // overflowed their pages silently).
  watchSurfaceImages(): void {
    // Preview replacement can detach pending images before they settle.
    for (const [element, cleanup] of this.watchedImages) {
      if (!this.surfaceTarget.contains(element)) cleanup()
    }
    const images = this.surfaceTarget.querySelectorAll("img")
    for (const image of images) {
      const element = image as HTMLImageElement
      if (element.complete || this.watchedImages.has(element)) continue
      const cleanup = () => {
        element.removeEventListener("load", settled)
        element.removeEventListener("error", settled)
        this.watchedImages.delete(element)
      }
      const settled = () => {
        cleanup()
        if (!this.active) return
        if (this.paginatedOnce) this.schedulePagination()
        else this.maybeFirstPass()
      }
      this.watchedImages.set(element, cleanup)
      element.addEventListener("load", settled, { once: true })
      element.addEventListener("error", settled, { once: true })
    }
  }

  disconnect() {
    this.active = false
    this.resourceConnection = null
    window.removeEventListener("resize", this.boundResize)
    this.form?.removeEventListener("elef:editor-mode-change", this.modeChangedHandler)
    this.surfaceTarget.removeEventListener("focusout", this.boundFocusOut)
    this.resizeObserver?.disconnect()
    this.mutationObserver?.disconnect()
    cancelAnimationFrame(this.resizeFrame)
    cancelAnimationFrame(this.reflowFrame)
    clearTimeout(this.reflowTimer)
    clearTimeout(this.resourceTimer)
    this.resourceTimer = null
    for (const cleanup of this.watchedImages.values()) cleanup()
  }

  resizeFrames(): void {
    if (!this.surfaceTarget) return
    markStage("resize-frames-start")
    const preview = this.element.closest(".library-preview") || this.sourceModePreview()
    const previewStyle = preview && getComputedStyle(preview)
    const fittedWidth = previewStyle
      ? Math.max(0, Math.min(
        DESIGN_WIDTH,
        preview.clientWidth - parseFloat(previewStyle.paddingLeft) - parseFloat(previewStyle.paddingRight),
        (preview.clientHeight - parseFloat(previewStyle.paddingTop) - parseFloat(previewStyle.paddingBottom)) * 210 / 297
      ))
      : null

    const frames = [...this.surfaceTarget.querySelectorAll(".document-page-frame")] as HTMLElement[]
    frames.forEach((frame: HTMLElement) => {
      if (fittedWidth === null) frame.style.removeProperty("width")
      else frame.style.width = `${fittedWidth}px`
    })
    // Every frame shares the same CSS width, so one layout read serves
    // all of them. Prefer a rendered frame: settled pages are sealed or
    // quieted (content-visibility) and report intrinsic size rather than
    // measured width. Falls back to the first frame once all are quiet
    // (post-pass calls), preserving today's behavior there. The scale
    // feeds a transform (compositor only).
    const measured = frames.find((frame) => !frame.classList.contains("is-quiet") && !frame.classList.contains("is-sealed")) ?? frames[0]
    const firstWidth = measured?.clientWidth
    const scale = firstWidth === undefined ? "1" : String(firstWidth / DESIGN_WIDTH)
    frames.forEach((frame: HTMLElement) => {
      frame.style.setProperty("--document-page-scale", scale)
    })
    markStage("resize-frames-end")
  }

  sourceModePreview(): Element | null {
    if (this.form?.dataset.editorMode !== "source") return null
    return this.element.closest(".preview-pane")
  }

  schedulePagination(): void {
    if (!this.active) return
    this.watchSurfaceImages()
    // Pre-first-pass schedules re-check the resources gate (install
    // swaps in new images; user interaction during the wait must not
    // force an early pass). The gate keeps single pagination.
    if (!this.paginatedOnce) {
      this.maybeFirstPass()
      return
    }
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

  paginate(): void {
    if (!this.surfaceTarget || !this.active) return
    if (!this.paginatedOnce) this.firstPassWithoutFonts = document.fonts?.status === "loading"

    markStage("paginate-start")
    resetPaginateStats()
    this.openPage = null
    const generation = ++this.paginationGeneration
    const caret = this.captureCaret() || this.pendingCaretRestore
    this.pendingCaretRestore = caret
    this.resizeObserver?.disconnect()
    const blocks = this.logicalBlocks()
    blocks.forEach((block) => this.clearArtItemTooTall(block))
    blocks.forEach((block) => this.ensureFlowId(block))

    this.surfaceTarget.replaceChildren()
    this.surfaceTarget.classList.add("is-paginated")
    const pages: DocumentPage[] = []
    let currentPage = this.createPage(pages.length + 1)
    pages.push(currentPage)

    // NOTE: batched appends (append N units, measure once, replay on
    // overflow) were tried and reverted: breaks are too dense (a break
    // every ~13 units), so 38-69% of batches replayed and the wasted
    // full-state measures plus double DOM churn beat the savings.
    const units = this.pageUnits(blocks)
    paginateStats().units = units.length
    units.forEach((unit) => {
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
      currentPage = pages.at(-1) ?? currentPage
    })

    markStage("paginate-finalize-start")
    pages.forEach(({ page, number, frame }) => {
      page.setAttribute("aria-label", `Document page ${number} of ${pages.length}`)
      const pageNumber = page.querySelector(".document-page-number")
      if (pageNumber) pageNumber.textContent = `Page ${number} of ${pages.length}`
      if (this.resizeObserver) this.resizeObserver.observe(frame)
    })
    const preview = this.element.closest(".library-preview") || this.element.closest(".preview-pane")
    if (preview && this.resizeObserver) this.resizeObserver.observe(preview)

    this.resizeFrames()
    this.mutationObserver?.takeRecords()
    this.paginatedOnce = true
    // Perf Q2: quiet settled frames so off-screen pages skip rendering
    // (style, layout, paint) until near the viewport. Earlier pages were
    // sealed progressively as the pass advanced (see createPage); swap
    // seal for quiet and quiet the final open page. The next pass
    // rebuilds bare frames, so its measurements stay exact.
    pages.forEach(({ frame }) => {
      frame.classList.remove("is-sealed")
      frame.classList.add("is-quiet")
    })
    markStage("paginate-finalize-end")
    requestAnimationFrame(() => {
      if (!this.active || generation !== this.paginationGeneration) return
      markStage("paginate-end")
      if (caret) this.restoreCaret(caret)
      this.pendingCaretRestore = null
      this.finishPagination({ paginated: true })
    })
  }

  finishPagination({ paginated = false }: { paginated?: boolean } = {}): void {
    if (!this.active || !this.surfaceTarget) return
    this.surfaceTarget.dataset.documentPagesSettled = "true"
    this.surfaceTarget.dispatchEvent(new CustomEvent("elef:document-pages-settled", { bubbles: true }))
    if (paginated) this.surfaceTarget.dispatchEvent(new CustomEvent("elef:document-paginated", { bubbles: true }))
  }

  logicalBlocks(): HTMLElement[] {
    const frames = [...this.surfaceTarget.children].filter((child) => child.classList.contains("document-page-frame"))
    const blocks = frames.length
      ? frames.flatMap((frame) => [...frame.querySelector(".document-page-content").children])
      : [...this.surfaceTarget.children]

    const logical: HTMLElement[] = []
    const positions = new Map<string, number>()
    blocks.forEach((block) => {
      const flowId = block.dataset.documentPageFlowId
      const existingIndex = flowId ? positions.get(flowId) : null
      if (existingIndex === undefined || existingIndex === null) {
        if (flowId) positions.set(flowId, logical.length)
        logical.push(block)
        return
      }

      const existing = logical[existingIndex]
      if (existing) this.mergeFlowFragment(existing, block)
    })

    logical.forEach((block) => {
      (block.matches("[data-document-page-flow-content]") ? block : block.querySelector("[data-document-page-flow-content]"))
        ?.removeAttribute("data-document-page-flow-content")
    })

    return logical
  }

  mergeFlowFragment(first: HTMLElement, next: HTMLElement): void {
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

  ensureFlowId(block: HTMLElement): void {
    if (block.dataset.documentPageFlowId) return
    this.nextFlowId += 1
    block.dataset.documentPageFlowId = `flow-${this.nextFlowId}`
  }

  pageUnits(blocks: HTMLElement[]): HTMLElement[][] {
    const units: HTMLElement[][] = []

    let index = 0
    while (index < blocks.length) {
      const unit: HTMLElement[] = []
      let anchor = blocks[index]
      while (anchor?.matches(".document-source-anchor")) {
        unit.push(anchor)
        index += 1
        anchor = blocks[index]
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
          let keepAnchor = blocks[index]
          while (keepAnchor?.matches(".document-source-anchor")) {
            unit.push(keepAnchor)
            index += 1
            keepAnchor = blocks[index]
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

  isHeading(block: HTMLElement): boolean {
    return /^H[1-6]$/.test(block.tagName) || Boolean(block.querySelector(":scope > h1, :scope > h2, :scope > h3, :scope > h4, :scope > h5, :scope > h6"))
  }

  flowBlock(block: HTMLElement | undefined, pages: DocumentPage[], page: DocumentPage, keepWith: HTMLElement[] = []): void {
    markStage("paginate-flow-start")
    paginateStats().flows += 1
    try {
      this.flowBlockInner(block, pages, page, keepWith)
    } finally {
      markStage("paginate-flow-end")
    }
  }

  flowBlockInner(block: HTMLElement | undefined, pages: DocumentPage[], page: DocumentPage, keepWith: HTMLElement[] = []): void {
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
          this.markOversizedArtItem(remainder, currentPage)
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
        this.markOversizedArtItem(remainder, currentPage)
        return
      }

      currentPage.content.append(split[0])
      keepWith = []
      remainder = split[1]
      currentPage = this.createPage(pages.length + 1)
      pages.push(currentPage)
    }
  }

  splitBlock(block: HTMLElement, page: DocumentPage): [HTMLElement, HTMLElement] | null {
    const art = this.artRoot(block)
    if (art) return this.splitArtBlock(block, art, page)

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

  splitArtBlock(block: HTMLElement, artRoot: HTMLElement, page: DocumentPage): [HTMLElement, HTMLElement] | null {
    const list = artRoot.querySelector(".elef-art-list")
    if (!list) return null
    const children = [...list.children]
    if (children.length < 2 || !children.every((child) => child.tagName === "LI")) {
      const onlyChild = children[0]
      if (children.length === 1 && onlyChild && page.content.childElementCount === 0 && this.artItemOverflows(block, list, onlyChild, page)) {
        page.page.classList.add("is-overflowing-content")
        this.markArtItemTooTall(block)
      }
      return null
    }

    const bestCount = this.largestFittingChildCount(block, list, children, page)
    if (bestCount > 0 && bestCount < children.length) {
      return this.artFragments(block, list, children, bestCount)
    }

    const leadChild = children[0]
    if (bestCount === 0 && leadChild && page.content.childElementCount === 0 && this.artItemOverflows(block, list, leadChild, page)) {
      page.page.classList.add("is-overflowing-content")
      this.markArtItemTooTall(block)
      return this.artFragments(block, list, children, 1)
    }
    return null
  }

  artFragments(block: HTMLElement, list: Element, children: Element[], splitAt: number): [HTMLElement, HTMLElement] {
    const first = this.childFragment(block, list, children.slice(0, splitAt))
    const remainder = this.childFragment(block, list, children.slice(splitAt))
    if (list.tagName === "OL") {
      const baseStart = list.hasAttribute("start") ? Number(list.getAttribute("start")) : 1
      const remainderList = this.artRootList(remainder)
      remainderList?.setAttribute("start", String(baseStart + splitAt))
    }
    return [first, remainder]
  }

  artItemOverflows(block: HTMLElement, list: Element, item: Element, page: DocumentPage): boolean {
    const candidate = this.childFragment(block, list, [item])
    page.content.append(candidate)
    this.probingDepth += 1
    try {
      return this.overflows(page)
    } finally {
      this.probingDepth -= 1
      page.content.removeChild(candidate)
    }
  }

  artRoot(block: HTMLElement): HTMLElement | null {
    if (block.matches("[data-elef-art-root]")) return block
    return block.querySelector("[data-elef-art-root]") as HTMLElement | null
  }

  artRootList(block: HTMLElement): Element | null {
    return this.artRoot(block)?.querySelector(".elef-art-list") || null
  }

  markArtItemTooTall(block: HTMLElement): void {
    const artRoot = this.artRoot(block)
    if (!artRoot) return
    if (!artRoot.dataset.artDiagnostic) artRoot.dataset.artDiagnostic = ART_ITEM_TOO_TALL
    if (artRoot.dataset.artItemTooTall === "true") return
    artRoot.dataset.artItemTooTall = "true"
    const blockId = block.dataset.editorBlockId || null
    artRoot.dispatchEvent(new CustomEvent("elef:art-diagnostic", {
      bubbles: true,
      detail: {
        code: ART_ITEM_TOO_TALL,
        message: "An Art item is taller than a document page. It remains atomic and is available through the page overflow content.",
        blockId
      }
    }))
  }

  markOversizedArtItem(block: HTMLElement, page: DocumentPage): void {
    const artRoot = this.artRoot(block)
    const list = artRoot?.querySelector(".elef-art-list")
    if (!list || !page.content.contains(block)) return
    const items = [...list.children].filter((child) => child.tagName === "LI")
    page.content.removeChild(block)
    const oversized = items.some((item) => this.artItemOverflows(block, list, item, page))
    page.content.append(block)
    if (oversized) this.markArtItemTooTall(block)
  }

  clearArtItemTooTall(block: HTMLElement): void {
    const artRoot = this.artRoot(block)
    if (!artRoot || artRoot.dataset.artItemTooTall !== "true") return
    artRoot.removeAttribute("data-art-item-too-tall")
    if (artRoot.dataset.artDiagnostic === ART_ITEM_TOO_TALL) artRoot.removeAttribute("data-art-diagnostic")
    artRoot.dispatchEvent(new CustomEvent("elef:art-diagnostic", {
      bubbles: true,
      detail: { code: null, message: null, blockId: block.dataset.editorBlockId || null }
    }))
  }

  splitGroupedChildren(block: HTMLElement, page: DocumentPage): [HTMLElement, HTMLElement] | null {
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
    const tableBody = table instanceof HTMLTableElement ? table.tBodies[0] : undefined
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

  largestFittingChildCount(block: HTMLElement, target: Element, children: Element[], page: DocumentPage): number {
    // Clone-once probing: one probe shell per split, with each child
    // cloned once and moved between probes (replaceChildren moves nodes,
    // never copies). Every probe measures byte-identical content to a
    // fresh clone per probe; only redundant deep clones are skipped.
    const clone = block.cloneNode(true) as HTMLElement
    const cloneTarget = this.nodeAtPath(clone, this.nodePath(block, target))
    cloneTarget.dataset.documentPageFlowContent = "true"
    const childClones = children.map((child) => child.cloneNode(true))
    page.content.append(clone)
    let low = 1
    let high = children.length - 1
    let best = 0

    try {
      this.probingDepth += 1
      while (low <= high) {
        const count = Math.floor((low + high) / 2)
        cloneTarget.replaceChildren(...childClones.slice(0, count))
        const fits = !this.overflows(page)
        if (fits) {
          best = count
          low = count + 1
        } else {
          high = count - 1
        }
      }
    } finally {
      this.probingDepth -= 1
      page.content.removeChild(clone)
    }

    return best
  }

  childFragment(block: HTMLElement, target: Element, children: Element[]): HTMLElement {
    const clone = block.cloneNode(true) as HTMLElement
    const cloneTarget = this.nodeAtPath(clone, this.nodePath(block, target))
    cloneTarget.replaceChildren(...children.map((child) => child.cloneNode(true)))
    cloneTarget.dataset.documentPageFlowContent = "true"
    return clone
  }

  splittableTextTarget(block: HTMLElement): Element | null {
    const selector = FLOW_TEXT_SELECTOR
    if (block.matches(selector)) return block

    // Only a unique long-text descendant qualifies: stop mapping text
    // once a second one appears (each text map walks the subtree).
    let found: Element | null = null
    for (const element of block.querySelectorAll(selector)) {
      if (this.textMap(element).text.length <= 1) continue
      if (found) return null
      found = element
    }
    return found
  }

  largestFittingBoundary(block: HTMLElement, target: Element, textMap: TextMap, boundaries: number[], page: DocumentPage): number {
    // Clone-once probing: one probe shell per split; each probe only
    // swaps the clone target's ranged children. Byte-identical to a
    // fresh clone per probe (the rest of the clone copies the same
    // untouched original); only redundant deep clones are skipped.
    const clone = block.cloneNode(true) as HTMLElement
    const cloneTarget = this.nodeAtPath(clone, this.nodePath(block, target))
    cloneTarget.dataset.documentPageFlowContent = "true"
    let low = 0
    let high = boundaries.length - 1
    let best = 0

    // Interpolated probing: fitting is monotonic in length, so every
    // probe narrows [low, high] wherever it lands and best-tracking
    // finds the same maximum as pure binary search. Length-proportional
    // height estimates land near the answer on large ranges; a probe
    // that barely narrows abandons interpolation for midpoints, so the
    // worst case is one wasted probe. Small ranges skip the estimate
    // (binary search already costs ~4 probes there). The base height is
    // read before the probe shell goes in (one layout).
    let interpolate = boundaries.length >= 24
    let interpolations = 0
    const baseScroll = interpolate ? page.content.scrollHeight : 0
    const remaining = interpolate ? page.content.clientHeight - baseScroll : 0
    if (remaining <= 0) interpolate = false
    page.content.append(clone)

    const probe = (index: number): boolean | null => {
      const end = boundaries[index]
      if (end === undefined || end >= textMap.text.length) return null
      const range = document.createRange()
      const start = this.pointAtTextOffset(textMap, 0)
      const stop = this.pointAtTextOffset(textMap, end)
      range.setStart(start.node, start.offset)
      range.setEnd(stop.node, stop.offset)
      cloneTarget.replaceChildren(range.cloneContents())
      const fits = !this.overflows(page)
      if (fits) {
        if (end > best) best = end
        return true
      }
      return false
    }

    const indexNearLength = (length: number): number => {
      let lo = low
      let hi = high
      let nearest = low
      while (lo <= hi) {
        const mid = (lo + hi) >> 1
        const value = boundaries[mid] ?? 0
        if (value === length) return mid
        if (value < length) {
          nearest = mid
          lo = mid + 1
        } else {
          hi = mid - 1
        }
      }
      return Math.max(low, Math.min(high, nearest))
    }

    // Density state from the most recent probe: growth px for a
    // fragment of lastLength chars. The first probe is always the
    // midpoint (a plain binary probe); its growth seeds the estimate.
    let lastGrowth = 0
    let lastLength = 0

    try {
      this.probingDepth += 1
      while (low <= high) {
        const span = high - low + 1
        let index = Math.floor((low + high) / 2)
        let estimated = false
        if (interpolate && interpolations < 3 && lastGrowth > 0 && lastLength > 0) {
          index = indexNearLength((remaining * lastLength) / lastGrowth)
          estimated = true
          interpolations += 1
        }
        const end = boundaries[index] ?? 0
        const fits = probe(index)
        if (fits === null) {
          high = index - 1
          continue
        }
        // Growth read rides the probe's forced layout (scrollHeight was
        // just read by overflows), so the density update costs nothing.
        lastGrowth = page.content.scrollHeight - baseScroll
        lastLength = end
        if (fits) {
          low = index + 1
        } else {
          high = index - 1
        }
        if (estimated && high - low + 1 > span * 0.875) interpolate = false
      }
    } finally {
      this.probingDepth -= 1
      page.content.removeChild(clone)
    }

    return best
  }

  textFragment(block: HTMLElement, target: Element, textMap: TextMap, from: number, to: number): HTMLElement {
    const clone = block.cloneNode(true) as HTMLElement
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

  textMap(element: Element): TextMap {
    const nodes: TextMapEntry[] = []
    const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT, {
      acceptNode: (node) => node.parentElement?.closest(HIDDEN_TEXT_SELECTOR) ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_ACCEPT
    })
    let node: Node | null
    let text = ""
    while ((node = walker.nextNode())) {
      const nodeText = node.textContent ?? ""
      nodes.push({ node, start: text.length, end: text.length + nodeText.length })
      text += nodeText
    }
    return { nodes, text, root: element }
  }

  pointAtTextOffset(textMap: TextMap, offset: number): { node: Node; offset: number } {
    if (offset <= 0) return { node: textMap.root, offset: 0 }
    if (offset >= textMap.text.length) return { node: textMap.root, offset: textMap.root.childNodes.length }
    // Entries are contiguous and sorted by start, so the leftmost entry
    // with end >= offset is exactly the linear scan's first
    // start <= offset <= end match (any earlier entry ends before
    // offset; contiguity guarantees this one's start <= offset).
    const nodes = textMap.nodes
    if (!nodes.length) return { node: textMap.root, offset: 0 }
    let low = 0
    let high = nodes.length - 1
    let index = nodes.length - 1
    while (low <= high) {
      const mid = (low + high) >> 1
      if ((nodes[mid]?.end ?? 0) >= offset) {
        index = mid
        high = mid - 1
      } else {
        low = mid + 1
      }
    }
    const entry = nodes[index] ?? nodes.at(-1)
    if (!entry) return { node: textMap.root, offset: 0 }
    return { node: entry.node, offset: Math.max(0, Math.min(offset - entry.start, (entry.node.textContent ?? "").length)) }
  }

  wordBoundaries(text: string): number[] {
    const boundaries: number[] = []
    for (let index = 0; index < text.length; index += 1) {
      if (/\s/.test(text[index] ?? "")) boundaries.push(index + 1)
    }
    return boundaries.length ? boundaries : this.characterBoundaries(text)
  }

  characterBoundaries(text: string): number[] {
    const boundaries: number[] = []
    for (let index = 1; index <= text.length; index += 1) {
      if (index === text.length || !/[\uDC00-\uDFFF]/.test(text[index] ?? "")) boundaries.push(index)
    }
    return boundaries
  }

  nodePath(root: Element, target: Element): number[] {
    const path: number[] = []
    let node: Element | null = target
    while (node !== null && node !== root) {
      const parent: Element | null = node.parentElement
      if (!parent) break
      path.unshift([...parent.childNodes].indexOf(node))
      node = parent
    }
    return path
  }

  nodeAtPath(root: Node, path: number[]): HTMLElement {
    return path.reduce((node: any, index: number) => node.childNodes[index], root)
  }

  captureCaret(): CapturedCaret | null {
    const selection = window.getSelection()
    if (!selection?.focusNode) return null
    const focusNode = selection.focusNode
    const node = focusNode.nodeType === Node.ELEMENT_NODE ? (focusNode as Element) : focusNode.parentElement
    const block = node?.closest?.("[data-editor-block-id][contenteditable='true']")
    if (!(block instanceof HTMLElement) || !this.surfaceTarget.contains(block)) return null

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
    if (structuredLine instanceof HTMLElement && block.contains(structuredLine)) {
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

  restoreCaret(caret: CapturedCaret): void {
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
      if (caretTarget && targetBlock instanceof HTMLElement && targetBlock.contentEditable === "true") {
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

  pageFragments(flowId: string): HTMLElement[] {
    return ([...this.surfaceTarget.querySelectorAll("[data-document-page-flow-id]")] as HTMLElement[])
      .filter((block: HTMLElement) => block.dataset.documentPageFlowId === flowId)
  }

  visibleTextLength(element: Element): number {
    const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT, {
      acceptNode: (node) => node.parentElement?.closest(HIDDEN_TEXT_SELECTOR) ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_ACCEPT
    })
    let length = 0
    while (walker.nextNode()) length += (walker.currentNode.textContent ?? "").length
    return length
  }

  createPage(number: number): DocumentPage {
    // Progressive sealing: the previous page is settled (no more appends
    // or probes will touch it), so skip its rendering unconditionally
    // while the pass continues. overflows() then costs O(one page)
    // instead of O(all pages so far). Measurements stay exact: page
    // boxes are fixed-size and only the open page is ever measured.
    // Sealed (hidden) rather than quiet (auto): auto would still render
    // near-viewport pages. The end-of-pass loop swaps seal for quiet.
    this.openPage?.frame.classList.add("is-sealed")
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
    const created = { content, number, page, frame }
    this.openPage = created
    return created
  }

  overflows({ content }: DocumentPage): boolean {
    const stats = paginateStats()
    const start = now()
    const result = content.scrollHeight > content.clientHeight + 1
    const ms = now() - start
    stats.overflows += 1
    stats.overflowsMs += ms
    if (ms > stats.overflowsMax) stats.overflowsMax = ms
    if (this.probingDepth > 0) {
      stats.probeOverflows += 1
      stats.probeOverflowsMs += ms
    }
    return result
  }

  focusedEditable(): boolean {
    const active = document.activeElement
    return Boolean(active instanceof HTMLElement && active.isContentEditable && this.surfaceTarget.contains(active))
  }

  projectionFresh(): boolean {
    return this.element.closest("form")?.previewController?.projectionFresh !== false
  }
}
