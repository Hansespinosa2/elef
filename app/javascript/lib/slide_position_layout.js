export const NON_TRAILING_BOTTOM_WARNING = "Only trailing bottom blocks pin; this block was treated as top."

const verticalOf = (block) => block?.position?.vertical || "top"
const beforeMiddle = (vertical) => vertical === "bottom" || vertical === "middle"
const afterMiddle = (vertical) => vertical === "top" || vertical === "middle"

export function slidePositionLayout(blocks = []) {
  const sourceVerticals = blocks.map(verticalOf)
  const absorbedBottoms = new Set()

  // A contiguous bottom/middle run containing a middle anchor is absorbed
  // into that stack. Scanning runs once keeps this pass linear in block count.
  for (let start = 0; start < sourceVerticals.length;) {
    if (!beforeMiddle(sourceVerticals[start])) {
      start += 1
      continue
    }

    let end = start
    let lastMiddle = -1
    while (end < sourceVerticals.length && beforeMiddle(sourceVerticals[end])) {
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
  const demoted = new Set()
  sourceVerticals.forEach((vertical, index) => {
    if (vertical === "bottom" && !absorbedBottoms.has(index) && (!bottomLane || index < bottomLane.start)) demoted.add(index)
  })

  const verticals = sourceVerticals.map((vertical, index) => demoted.has(index) ? "top" : vertical)
  const starts = new Array(verticals.length)
  const ends = new Array(verticals.length)
  for (let index = 0; index < verticals.length; index += 1) {
    starts[index] = index > 0 && beforeMiddle(verticals[index - 1]) ? starts[index - 1] : index
  }
  for (let index = verticals.length - 1; index >= 0; index -= 1) {
    ends[index] = index + 1 < verticals.length && afterMiddle(verticals[index + 1]) ? ends[index + 1] : index + 1
  }

  const intervals = []
  verticals.forEach((vertical, index) => {
    if (vertical !== "middle") return
    const start = starts[index]
    const end = ends[index]
    const previous = intervals.at(-1)
    if (previous && start <= previous.end) previous.end = Math.max(previous.end, end)
    else intervals.push({ start, end })
  })

  const entries = []
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

export function slidePositionClasses(position, verticalOverride = null) {
  return `position-${position?.horizontal || "left"} position-${verticalOverride || position?.vertical || "top"}`
}
