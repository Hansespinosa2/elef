// Pure structural source transforms for Elef works (document | presentation).
//
// These are the string-computation cores ported verbatim from the authoring
// surfaces (shared presentation editor, document visual editor, snippet
// palette, media controller). Each function maps (source, map structs, …) to
// the updated source (or null when the operation is a no-op); caret restore,
// map bookkeeping, commits, and DOM updates stay host-side. No DOM, React,
// filesystem, network, Rails or Tauri.
const NEW_SLIDE_MARKDOWN = "# New slide\n\nStart writing here."

export function addSlide(source, slides, index) {
  const list = slides || []
  const markdown = NEW_SLIDE_MARKDOWN
  if (index >= list.length) {
    return source.trim() === ""
      ? markdown
      : `${source}${source.endsWith("\n") ? "" : "\n"}---\n${markdown}`
  }
  const from = list[index].range.start
  return `${source.slice(0, from)}${markdown}\n---\n${source.slice(from)}`
}

export function deleteSlide(source, slides, index) {
  const list = slides || []
  const slide = list[index]
  if (!slide || list.length < 2) return null
  let from
  let to
  if (index === 0) {
    from = slide.range.start
    to = slide.delimiter_range?.end || slide.range.end
  } else if (index === list.length - 1) {
    from = list[index - 1].delimiter_range.start
    to = slide.range.end
  } else {
    from = slide.range.start
    to = slide.delimiter_range?.end || slide.range.end
  }
  return `${source.slice(0, from)}${source.slice(to)}`
}

export function moveSlide(source, map, index, target) {
  const slides = map?.slides || []
  if (!slides[index] || target < 0 || target >= slides.length) return null
  const bodyStart = map.front_matter?.range.end || 0
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
  return `${source.slice(0, bodyStart)}${body}${finalTrailing}`
}

export function blockOperationStart(slide, block) {
  if (block.position_scope !== "block" || !block.position_directive_id) return block.range.start
  const directive = slide.directives.find((candidate) => candidate.id === block.position_directive_id)
  return directive?.range.start ?? block.range.start
}

export function insertBlock(source, slide, index) {
  if (!slide) return null
  const blocks = slide.blocks || []
  const insertion = index < blocks.length
    ? blockOperationStart(slide, blocks[index])
    : slide.range.end
  if (index < blocks.length) {
    return `${source.slice(0, insertion)}New block\n\n${source.slice(insertion)}`
  }

  const before = source.slice(0, insertion)
  const prefix = before.trim() === "" ? "" : before.endsWith("\n") ? "\n" : "\n\n"
  const suffix = slide.delimiter_range ? "\n" : ""
  return `${source.slice(0, insertion)}${prefix}New block${suffix}${source.slice(insertion)}`
}

export function removeBlock(source, slide, block) {
  if (!slide || !block) return null
  let from = blockOperationStart(slide, block)
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
  return `${before}${after}`
}

export function moveBlock(source, slide, index, target) {
  if (!slide || target < 0 || target >= (slide.blocks || []).length) return null
  const movingGroupId = slide.blocks[index]?.position_scope === "group"
    ? slide.blocks[index].position_directive_id
    : null
  const low = Math.min(index, target)
  const high = Math.max(index, target)
  if (slide.blocks.slice(low, high + 1).some((block) =>
    block.position_scope === "group" && block.position_directive_id !== movingGroupId
  )) return null
  if (movingGroupId && slide.blocks.slice(low, high + 1).some((block) =>
    block.position_scope !== "group" || block.position_directive_id !== movingGroupId
  )) return null

  const contentEnd = (block) => {
    const raw = source.slice(block.range.start, block.range.end)
    const ending = raw.match(/\r\n|\n|\r$/)?.[0] || ""
    return block.range.end - ending.length
  }
  const starts = slide.blocks.map((block) => blockOperationStart(slide, block))
  const blocks = slide.blocks.map((block, blockIndex) => source.slice(starts[blockIndex], contentEnd(block)))
  const separators = slide.blocks.slice(0, -1).map((block, blockIndex) =>
    source.slice(contentEnd(block), starts[blockIndex + 1])
  )
  const trailing = source.slice(contentEnd(slide.blocks.at(-1)), slide.range.end)
  const leading = source.slice(slide.range.start, starts[0])
  const moved = blocks.splice(index, 1)[0]
  blocks.splice(target, 0, moved)
  const body = `${leading}${blocks.map((block, blockIndex) => `${block}${separators[blockIndex] || ""}`).join("")}${trailing}`
  return `${source.slice(0, slide.range.start)}${body}${source.slice(slide.range.end)}`
}

export function parseAlignment(value) {
  if (!value) return { horizontal: "left", vertical: "top", verticalExplicit: false }
  const parts = value.trim().split(/\s+/)
  let vertical = "top"
  let horizontal = "left"
  if (parts.length === 1) {
    if (["left", "center", "right"].includes(parts[0])) horizontal = parts[0]
    else if (["top", "middle", "bottom"].includes(parts[0])) vertical = parts[0]
  } else if (parts.length >= 2) {
    vertical = parts[0] === "center" ? "middle" : parts[0]
    horizontal = parts[1]
  }
  return { horizontal, vertical, verticalExplicit: vertical !== "top" }
}

// Shared span math for replacing one `:::align{…}` directive line: absorbs the
// line ending into the replaced span (or synthesizes one) so the replacement
// never leaves a bare empty line behind.
export function directiveLineSpan(source, from, to) {
  let end = to
  let lineEnding = source.slice(from, end).match(/(?:\r\n|\r|\n)$/)?.[0]
  if (!lineEnding) {
    const restMatch = source.slice(end).match(/^(?:\r\n|\r|\n)/)?.[0]
    if (restMatch) {
      end += restMatch.length
      lineEnding = restMatch
    } else {
      lineEnding = "\n"
    }
  }
  return { from, to: end, lineEnding }
}

export function insertAlignDirective(source, from, inner) {
  const lineEnding = source.match(/\r\n|\r|\n/)?.[0] || "\n"
  const replacement = `${inner}${lineEnding}${lineEnding}`
  return { updated: `${source.slice(0, from)}${replacement}${source.slice(from)}`, replacement, lineEnding }
}

// Single-span excision for `:::align{…}` (+ `:::`) directive ranges. Returns
// the absorbed end offset alongside the updated source so hosts can keep
// offset-tracking and map bookkeeping exact.
export function exciseRange(source, range) {
  let rangeEnd = range.end
  const before = source.slice(0, range.start)
  const lineEnding = source.slice(range.start, rangeEnd).match(/(?:\r\n|\r|\n)$/)?.[0]
  if (!lineEnding) {
    const restMatch = source.slice(rangeEnd).match(/^(?:\r\n|\r|\n)/)?.[0]
    if (restMatch) rangeEnd += restMatch.length
  }
  let after = source.slice(rangeEnd)
  if (before.endsWith("\n\n") && after.startsWith("\n")) after = after.slice(1)
  return { updated: `${before}${after}`, to: rangeEnd }
}

// Shared removal math for `:::align{…}` (+ `:::`) directive ranges: excises
// the spans back-to-front, collapsing the blank line left behind.
export function exciseRanges(source, ranges) {
  return [...ranges]
    .sort((left, right) => right.start - left.start)
    .reduce((updated, range) => exciseRange(updated, range).updated, source)
}

// Pure snippet-template expansion: `${n:default}` stops resolve to their
// defaults; tab-stop navigation stays host-side.
export function expandSnippet(body) {
  const stops = []
  const text = body.replace(/\$\{(\d+)(?::([^}]*))?\}/g, (_, number, value = "") => {
    const start = textLengthBefore(body, stops)
    stops.push({ number: Number(number), start, length: value.length })
    return value
  })
  return { text, stops: stops.sort((a, b) => (a.number === 0 ? 1 : b.number === 0 ? -1 : a.number - b.number)) }
}

function textLengthBefore(body, stops) {
  const markers = [...body.matchAll(/\$\{\d+(?::[^}]*)?\}/g)]
  const marker = markers[stops.length]
  if (!marker) return body.length

  return marker.index - stops.reduce((position, stop, index) =>
    position + markers[index][0].length - stop.length, 0)
}

// Pure media-markdown insertion text: pads the embed with blank lines unless
// the insertion point already sits on a blank boundary.
export function mediaInsertText(source, range, markdown) {
  const before = source.slice(0, range.from)
  const after = source.slice(range.to)
  const prefix = before.length === 0 || /\n\n$/.test(before) ? "" : /\n$/.test(before) ? "\n" : "\n\n"
  const suffix = after.length === 0 || /^\n\n/.test(after) ? "" : /^\n/.test(after) ? "\n" : "\n\n"
  return `${prefix}${markdown}${suffix}`
}
