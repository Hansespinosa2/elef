export const NON_TRAILING_BOTTOM_WARNING = "Only trailing bottom blocks pin; this block was treated as top."

const verticalOf = (block) => block?.position?.vertical || "top"

export function slidePositionLayout(blocks = []) {
  const sourceVerticals = blocks.map(verticalOf)
  const absorbedBottoms = new Set()

  // A middle anchor pulls a contiguous run of preceding bottom/middle blocks
  // into its stack. Mark those bottoms before finding the trailing lane.
  sourceVerticals.forEach((vertical, index) => {
    if (vertical !== "middle") return
    for (let previous = index - 1; previous >= 0 && ["bottom", "middle"].includes(sourceVerticals[previous]); previous -= 1) {
      if (sourceVerticals[previous] === "bottom") absorbedBottoms.add(previous)
    }
  })

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
  const intervals = []
  verticals.forEach((vertical, index) => {
    if (vertical !== "middle") return
    let start = index
    let end = index + 1
    while (start > 0 && ["bottom", "middle"].includes(verticals[start - 1])) start -= 1
    while (end < verticals.length && ["top", "middle"].includes(verticals[end])) end += 1

    // F-10 explicitly groups the top block between a demoted bottom and the
    // following middle anchor. That fixture conflicts with Q1a's general
    // preceding-top rule, so keep this narrowly scoped exception visible.
    if (start > 1 && verticals[start - 1] === "top" && demoted.has(start - 2)) start -= 1

    const previous = intervals.at(-1)
    if (previous && start <= previous.end) previous.end = Math.max(previous.end, end)
    else intervals.push({ start, end })
  })

  const entries = []
  let index = 0
  while (index < blocks.length) {
    const middle = intervals.find(interval => interval.start === index)
    if (middle) {
      const flushBottom = Boolean(bottomLane && middle.end === bottomLane.start)
      entries.push({ type: "middle", ...middle, flushBottom })
      index = middle.end
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
