import type { EditorMap, MapBlock, MapSlide } from "@elef/work-model"

interface BlockMatch {
  block: MapBlock;
  index: number;
  progress: number;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value))
}

function escapeAttrValue(value: string): string {
  if (typeof CSS !== "undefined" && typeof CSS.escape === "function") {
    return CSS.escape(value)
  }
  return value.replace(/["\\]/g, "\\$&")
}

function findBlockElements(container: Element, blockId: string): HTMLElement[] {
  return [...container.querySelectorAll<HTMLElement>(`[data-editor-block-id="${escapeAttrValue(blockId)}"]`)]
}

function measureRect(element: HTMLElement): DOMRect {
  const frame = element.closest<HTMLElement>(".document-page-frame.is-quiet")
  if (!frame) return element.getBoundingClientRect()
  frame.classList.remove("is-quiet")
  const rect = element.getBoundingClientRect()
  frame.classList.add("is-quiet")
  return rect
}

function resolveDocumentBlock(blocks: readonly MapBlock[], offset: number): BlockMatch | null {
  if (blocks.length === 0) return null

  const exactIndex = blocks.findIndex(
    (block) => !block.empty_placeholder && block.range.start <= offset && offset <= block.range.end
  )
  if (exactIndex >= 0) {
    const block = blocks[exactIndex]
    if (block) {
      const span = Math.max(1, block.range.end - block.range.start)
      return { block, index: exactIndex, progress: clamp((offset - block.range.start) / span, 0, 1) }
    }
  }

  const placeholderIndex = blocks.findIndex(
    (block) => block.empty_placeholder && block.range.start <= offset && offset <= block.range.end
  )
  if (placeholderIndex >= 0) {
    const block = blocks[placeholderIndex]
    if (block) return { block, index: placeholderIndex, progress: 0 }
  }

  const nextIndex = blocks.findIndex((block) => block.range.start > offset)
  if (nextIndex >= 0) {
    const block = blocks[nextIndex]
    if (block) return { block, index: nextIndex, progress: 0 }
  }

  const lastIndex = blocks.length - 1
  const lastBlock = blocks[lastIndex]
  return lastBlock ? { block: lastBlock, index: lastIndex, progress: 1 } : null
}

function measureBlockTarget(
  container: HTMLElement,
  containerRect: DOMRect,
  elements: readonly HTMLElement[],
  progress: number
): { targetY: number; top: number; bottom: number } | null {
  if (elements.length === 0) return null

  const currentScrollTop = container.scrollTop
  const boxes = elements.map((element) => {
    const rect = measureRect(element)
    return {
      top: rect.top - containerRect.top + currentScrollTop,
      height: rect.height
    }
  })

  const first = boxes[0]
  const last = boxes[boxes.length - 1]
  if (!first || !last) return null

  const totalTop = first.top
  const totalBottom = last.top + last.height
  const totalHeight = boxes.reduce((sum, box) => sum + box.height, 0)

  if (totalHeight <= 0) {
    return { targetY: totalTop, top: totalTop, bottom: totalBottom }
  }

  let remaining = progress * totalHeight
  for (const box of boxes) {
    if (remaining <= box.height || box === last) {
      const targetY = box.top + clamp(remaining, 0, box.height)
      return { targetY, top: totalTop, bottom: totalBottom }
    }
    remaining -= box.height
  }

  return { targetY: totalBottom, top: totalTop, bottom: totalBottom }
}

function fallbackTargetBetweenBlocks(
  container: HTMLElement,
  containerRect: DOMRect,
  blocks: readonly MapBlock[],
  matchIndex: number,
  offset: number,
  maxScrollTop: number
): { targetY: number; top: number; bottom: number } | number | null {
  let prevElement: HTMLElement | null = null
  let prevBlock: MapBlock | null = null
  for (let i = matchIndex - 1; i >= 0; i -= 1) {
    const candidate = blocks[i]
    if (!candidate) continue
    const found = findBlockElements(container, candidate.id).at(-1)
    if (found) {
      prevElement = found
      prevBlock = candidate
      break
    }
  }

  let nextElement: HTMLElement | null = null
  let nextBlock: MapBlock | null = null
  for (let i = matchIndex + 1; i < blocks.length; i += 1) {
    const candidate = blocks[i]
    if (!candidate) continue
    const found = findBlockElements(container, candidate.id)[0]
    if (found) {
      nextElement = found
      nextBlock = candidate
      break
    }
  }

  if (!prevElement && !nextElement) return null
  if (!prevElement) return 0
  if (!nextElement) return maxScrollTop

  const currentScrollTop = container.scrollTop
  const prevRect = measureRect(prevElement)
  const nextRect = measureRect(nextElement)
  const prevBottom = prevRect.bottom - containerRect.top + currentScrollTop
  const nextTop = nextRect.top - containerRect.top + currentScrollTop

  const rangeStart = prevBlock ? prevBlock.range.end : offset
  const rangeEnd = nextBlock ? nextBlock.range.start : offset
  const ratio = rangeEnd > rangeStart ? clamp((offset - rangeStart) / (rangeEnd - rangeStart), 0, 1) : 0.5
  const targetY = prevBottom + ratio * Math.max(0, nextTop - prevBottom)
  return { targetY, top: prevBottom, bottom: nextTop }
}

function computeViewportScrollTop(
  currentScrollTop: number,
  viewportHeight: number,
  scrollHeight: number,
  target: { targetY: number; top: number; bottom: number },
  { isFirstBlock, isLastBlock }: { isFirstBlock: boolean; isLastBlock: boolean }
): number {
  const maxScrollTop = Math.max(0, scrollHeight - viewportHeight)
  if (maxScrollTop === 0) return 0

  if (isFirstBlock && target.targetY < viewportHeight * 0.5) {
    return 0
  }

  if (isLastBlock && target.targetY > scrollHeight - viewportHeight * 0.35) {
    return maxScrollTop
  }

  const comfortTop = currentScrollTop + viewportHeight * 0.15
  const comfortBottom = currentScrollTop + viewportHeight * 0.8
  if (target.targetY >= comfortTop && target.targetY <= comfortBottom) {
    return currentScrollTop
  }

  return clamp(Math.round(target.targetY - viewportHeight * 0.33), 0, maxScrollTop)
}

function resolveSlide(slides: readonly MapSlide[], offset: number): MapSlide | null {
  if (slides.length === 0) return null
  const exact = slides.find((slide) => slide.range.start <= offset && offset <= slide.range.end)
  if (exact) return exact
  const next = slides.find((slide) => slide.range.start > offset)
  if (next) return next
  return slides[slides.length - 1] ?? null
}

export function computeSourceEditScrollTop(
  container: HTMLElement,
  editorMap: EditorMap | null | undefined,
  offset: number
): number | null {
  if (!editorMap) return null
  const viewportHeight = container.clientHeight
  const scrollHeight = container.scrollHeight
  const maxScrollTop = Math.max(0, scrollHeight - viewportHeight)
  if (maxScrollTop === 0) return 0

  if (editorMap.mode === "presentation") {
    const slides = editorMap.slides ?? []
    const slide = resolveSlide(slides, offset)
    if (!slide) return null

    const isFirstSlide = slide.index === 0
    const isLastSlide = slide.index === slides.length - 1
    const slideFrame = container.querySelector<HTMLElement>(`[data-slide-index="${slide.index}"]`)?.closest<HTMLElement>(".slide-frame")
      ?? container.querySelector<HTMLElement>(`[data-slide-index="${slide.index}"]`)
    const blockMatch = resolveDocumentBlock(slide.blocks ?? [], offset)
    const blockElements = blockMatch ? findBlockElements(container, blockMatch.block.id) : []
    const containerRect = container.getBoundingClientRect()
    const target = blockElements.length > 0
      ? measureBlockTarget(container, containerRect, blockElements, blockMatch?.progress ?? 0)
      : slideFrame
        ? measureBlockTarget(container, containerRect, [slideFrame], 0)
        : null
    if (!target) return null

    if (isFirstSlide && target.top < viewportHeight * 0.5) return 0
    if (isLastSlide && target.bottom > scrollHeight - viewportHeight * 0.35) return maxScrollTop

    const comfortTop = container.scrollTop + viewportHeight * 0.15
    const comfortBottom = container.scrollTop + viewportHeight * 0.8
    if (target.targetY >= comfortTop && target.targetY <= comfortBottom) {
      return container.scrollTop
    }
    return clamp(Math.round(target.targetY - viewportHeight * 0.33), 0, maxScrollTop)
  }

  const blocks = editorMap.slides?.[0]?.blocks ?? []
  if (blocks.length === 0) return 0

  const firstBlock = blocks[0]
  const lastBlock = blocks[blocks.length - 1]
  const bodyStart = editorMap.front_matter?.body_start ?? 0
  if (offset <= bodyStart || (firstBlock && offset < firstBlock.range.start)) {
    return 0
  }
  if (lastBlock && offset >= lastBlock.range.end) {
    return maxScrollTop
  }

  const match = resolveDocumentBlock(blocks, offset)
  if (!match) return null

  const containerRect = container.getBoundingClientRect()
  const elements = findBlockElements(container, match.block.id)
  let target = measureBlockTarget(container, containerRect, elements, match.progress)
  if (!target) {
    const fallback = fallbackTargetBetweenBlocks(container, containerRect, blocks, match.index, offset, maxScrollTop)
    if (typeof fallback === "number") return fallback
    target = fallback
  }
  if (!target) return null

  return computeViewportScrollTop(container.scrollTop, viewportHeight, scrollHeight, target, {
    isFirstBlock: match.index === 0,
    isLastBlock: match.index === blocks.length - 1
  })
}

export function scrollPreviewToSourceOffset(
  container: HTMLElement,
  editorMap: EditorMap | null | undefined,
  offset: number
): boolean {
  const nextTop = computeSourceEditScrollTop(container, editorMap, offset)
  if (nextTop === null) return false
  container.scrollTop = nextTop
  return true
}
