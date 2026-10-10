// Slide vertical-position layout: assigns each block an effective vertical
// (top/middle/bottom) and groups middle runs and the trailing bottom lane
// into entries the projection and exporters share. Non-trailing bottom
// blocks demote to top with a warning. Pure: no DOM, no host.
export const NON_TRAILING_BOTTOM_WARNING = "Only trailing bottom blocks pin; this block was treated as top."

export interface SlidePositionBlock {
  position?: { horizontal?: string | null; vertical?: string | null } | null
}

export interface SlideMiddleEntry {
  type: "middle"
  start: number
  end: number
  flushBottom: boolean
}

export interface SlideBottomEntry {
  type: "bottom"
  start: number
  end: number
}

export interface SlideBlockEntry {
  type: "block"
  start: number
  end: number
}

export type SlidePositionEntry = SlideMiddleEntry | SlideBottomEntry | SlideBlockEntry

export interface SlidePositionLayout {
  entries: Array<SlidePositionEntry>
  verticals: Array<string>
  warnings: Array<string>
}

const verticalOf = (block: SlidePositionBlock): string => block?.position?.vertical || "top"
const beforeMiddle = (vertical: string): boolean => vertical === "bottom" || vertical === "middle"
const afterMiddle = (vertical: string): boolean => vertical === "top" || vertical === "middle"

export function slidePositionLayout(blocks: Array<SlidePositionBlock> = []): SlidePositionLayout {
  const sourceVerticals = blocks.map(verticalOf)
  const absorbedBottoms = new Set<number>()

  // A contiguous bottom/middle run containing a middle anchor is absorbed
  // into that stack. Scanning runs once keeps this pass linear in block count.
  for (let start = 0; start < sourceVerticals.length;) {
    if (!beforeMiddle(sourceVerticals[start] as string)) {
      start += 1
      continue
    }

    let end = start
    let lastMiddle = -1
    while (end < sourceVerticals.length && beforeMiddle(sourceVerticals[end] as string)) {
      if (sourceVerticals[end] === "middle") lastMiddle = end
      end += 1
    }
    if (lastMiddle >= 0) {
      for (let index = start; index < lastMiddle; index += 1) {
        if (sourceVerticals[index] === "bottom") absorbedBottoms.add(index)
      }
    }
    start = end
  }

  let laneStart = blocks.length
  while (laneStart > 0 && sourceVerticals[laneStart - 1] === "bottom" && !absorbedBottoms.has(laneStart - 1)) {
    laneStart -= 1
  }
  const bottomLane = laneStart < blocks.length ? { start: laneStart, end: blocks.length } : null
  const demoted = new Set<number>()
  sourceVerticals.forEach((vertical, index) => {
    if (vertical === "bottom" && !absorbedBottoms.has(index) && (!bottomLane || index < bottomLane.start)) demoted.add(index)
  })

  const verticals = sourceVerticals.map((vertical, index) => (demoted.has(index) ? "top" : vertical))
  const starts: Array<number> = new Array(verticals.length)
  const ends: Array<number> = new Array(verticals.length)
  for (let index = 0; index < verticals.length; index += 1) {
    starts[index] = index > 0 && beforeMiddle(verticals[index - 1] as string) ? (starts[index - 1] as number) : index
  }
  for (let index = verticals.length - 1; index >= 0; index -= 1) {
    ends[index] = index + 1 < verticals.length && afterMiddle(verticals[index + 1] as string) ? (ends[index + 1] as number) : index + 1
  }

  const intervals: Array<{ start: number; end: number }> = []
  verticals.forEach((vertical, index) => {
    if (vertical !== "middle") return
    const start = starts[index] as number
    const end = ends[index] as number
    const previous = intervals.at(-1)
    if (previous && start <= previous.end) previous.end = Math.max(previous.end, end)
    else intervals.push({ start, end })
  })

  const entries: Array<SlidePositionEntry> = []
  let index = 0
  let intervalIndex = 0
  while (index < blocks.length) {
    const middle = intervals[intervalIndex]
    if (middle?.start === index) {
      const flushBottom = Boolean(bottomLane && middle.end === bottomLane.start)
      entries.push({ type: "middle", ...middle, flushBottom })
      index = middle.end
      intervalIndex += 1
    } else if (bottomLane?.start === index) {
      entries.push({ type: "bottom", ...bottomLane })
      index = bottomLane.end
    } else {
      entries.push({ type: "block", start: index, end: index + 1 })
      index += 1
    }
  }

  return {
    entries,
    verticals,
    warnings: [...demoted].map(() => NON_TRAILING_BOTTOM_WARNING)
  }
}

export function slidePositionClasses(
  position: { horizontal?: string | null; vertical?: string | null } | null | undefined,
  verticalOverride: string | null = null
): string {
  return `position-${position?.horizontal || "left"} position-${verticalOverride || position?.vertical || "top"}`
}
