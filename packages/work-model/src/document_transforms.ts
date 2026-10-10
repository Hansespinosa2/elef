// Pure structural source transforms for Elef works (document | presentation).
//
// These are the string-computation cores ported verbatim from the authoring
// surfaces (shared presentation editor, document visual editor, snippet
// palette, media controller). Each function maps (source, map structs, …) to
// the updated source (or null when the operation is a no-op); caret restore,
// map bookkeeping, commits, and DOM updates stay host-side. No DOM, React,
// filesystem, network, Rails or Tauri.

// Minimal structural views of the editor map: the transforms accept any map
// object with these fields (including the client editors' local shapes),
// never the full document-map interfaces, so no runtime import couples the
// modules and each dist entry bundles standalone.
export interface TransformRange {
  start: number;
  end: number;
}

export interface TransformBlock {
  range?: TransformRange | null;
  position_scope?: string | null;
  position_directive_id?: string | null;
}

export interface TransformDirective {
  id?: string | null;
  type?: string | null;
  range?: TransformRange | null;
}

export interface TransformSlide {
  range?: TransformRange | null;
  delimiter_range?: TransformRange | null;
  blocks?: TransformBlock[] | null;
  directives?: TransformDirective[] | null;
}

export interface TransformMap {
  slides?: TransformSlide[] | null;
  front_matter?: { range?: TransformRange | null } | null;
}

export interface BlockOperationSpan {
  from: number;
  to: number;
}

export interface Alignment {
  horizontal: string;
  vertical: string;
  verticalExplicit: boolean;
}

export interface DirectiveLineSpan {
  from: number;
  to: number;
  lineEnding: string;
}

export interface AlignInsertion {
  updated: string;
  replacement: string;
  lineEnding: string;
}

export interface RangeExcision {
  updated: string;
  to: number;
}

export interface SnippetStop {
  number: number;
  start: number;
  length: number;
}

export interface SnippetExpansion {
  text: string;
  stops: SnippetStop[];
}

export interface CaretRange {
  from: number;
  to: number;
}

const NEW_SLIDE_MARKDOWN = "# New slide\n\nStart writing here."

export function addSlide(source: string, slides: readonly TransformSlide[] | null | undefined, index: number): string {
  const list = slides || []
  const markdown = NEW_SLIDE_MARKDOWN
  if (index >= list.length) {
    return source.trim() === ""
      ? markdown
      : `${source}${source.endsWith("\n") ? "" : "\n"}---\n${markdown}`
  }
  const target = list[index]
  const targetRange = target?.range
  if (!targetRange) throw new TypeError("Slide insertion needs the target slide range.")
  const from = targetRange.start
  return `${source.slice(0, from)}${markdown}\n---\n${source.slice(from)}`
}

export function deleteSlide(source: string, slides: readonly TransformSlide[] | null | undefined, index: number): string | null {
  const list = slides || []
  const slide = list[index]
  if (!slide || list.length < 2) return null
  const range = slide.range
  if (!range) return null
  let from: number
  let to: number
  if (index === 0) {
    from = range.start
    to = slide.delimiter_range?.end || range.end
  } else if (index === list.length - 1) {
    const previous = list[index - 1]
    const previousDelimiter = previous?.delimiter_range
    if (!previousDelimiter) return null
    from = previousDelimiter.start
    to = range.end
  } else {
    from = range.start
    to = slide.delimiter_range?.end || range.end
  }
  return `${source.slice(0, from)}${source.slice(to)}`
}

export function moveSlide(source: string, map: TransformMap | null | undefined, index: number, target: number): string | null {
  const slides = map?.slides || []
  if (!slides[index] || target < 0 || target >= slides.length) return null
  const bodyStart = map?.front_matter?.range?.end || 0
  const sections: Array<{ body: string; trailing: string }> = []
  for (const slide of slides) {
    const range = slide.range
    if (!range) return null
    const body = source.slice(range.start, range.end)
    const trailing = body.match(/\s*$/)?.[0] || ""
    sections.push({ body: body.slice(0, body.length - trailing.length), trailing })
  }
  const separators: string[] = []
  for (const [slideIndex, slide] of slides.slice(0, -1).entries()) {
    const section = sections[slideIndex]
    const delimiter = slide.delimiter_range
    if (!section || !delimiter) return null
    separators.push(`${section.trailing}${source.slice(delimiter.start, delimiter.end)}`)
  }
  const last = sections.at(-1)
  if (!last) return null
  const finalTrailing = last.trailing
  const moved = sections.splice(index, 1)[0]
  if (!moved) return null
  sections.splice(target, 0, moved)
  const body = sections.map((section, sectionIndex) => `${section.body}${separators[sectionIndex] || ""}`).join("")
  return `${source.slice(0, bodyStart)}${body}${finalTrailing}`
}

export function blockOperationStart(
  slide: TransformSlide | null | undefined,
  block: TransformBlock | null | undefined
): number {
  if (!block) throw new TypeError("Block operations need a block.")
  const range = block.range
  if (!range) throw new TypeError("Block operations need a block range.")
  if (block.position_scope !== "block" || !block.position_directive_id) return range.start
  const directive = slide?.directives?.find((candidate) => candidate.id === block.position_directive_id)
  return directive?.range?.start ?? range.start
}

// Shared block-operation span (F6): the source range a block-level operation
// (remove, empty-block cleanup) must cover, including the single-block
// directive or — for a lone group member — the whole directive pair. Both
// client editors call this instead of restating the group math.
export function blockOperationRange(
  block: TransformBlock | null | undefined,
  slide: TransformSlide | null | undefined
): BlockOperationSpan | null {
  if (!block || !slide) return null
  const range = block.range
  if (!range) return null
  let from = blockOperationStart(slide, block)
  let to = range.end

  if (block.position_scope === "group") {
    const groupMembers = (slide.blocks || []).filter((candidate) => candidate.position_directive_id === block.position_directive_id)
    if (groupMembers.length === 1) {
      const directives = slide.directives || []
      const directiveIndex = directives.findIndex((candidate) => candidate.id === block.position_directive_id)
      const directive = directiveIndex >= 0 ? directives[directiveIndex] : undefined
      const closing = directives.slice(directiveIndex + 1).find((candidate) => candidate.type === "position_close")
      const directiveRange = directive?.range
      const closingRange = closing?.range
      if (directiveRange && closingRange) {
        from = directiveRange.start
        to = closingRange.end
      }
    }
  }

  return { from, to }
}

export function insertBlock(source: string, slide: TransformSlide | null | undefined, index: number): string | null {
  if (!slide) return null
  const blocks = slide.blocks || []
  const slideRange = slide.range
  if (!slideRange) return null
  const target = index < blocks.length ? blocks[index] : undefined
  if (index < blocks.length && !target) return null
  const insertion = target ? blockOperationStart(slide, target) : slideRange.end
  if (index < blocks.length) {
    return `${source.slice(0, insertion)}New block\n\n${source.slice(insertion)}`
  }

  const before = source.slice(0, insertion)
  const prefix = before.trim() === "" ? "" : before.endsWith("\n") ? "\n" : "\n\n"
  const suffix = slide.delimiter_range ? "\n" : ""
  return `${source.slice(0, insertion)}${prefix}New block${suffix}${source.slice(insertion)}`
}

export function removeBlock(
  source: string,
  slide: TransformSlide | null | undefined,
  block: TransformBlock | null | undefined
): string | null {
  if (!slide || !block) return null
  const span = blockOperationRange(block, slide)
  if (!span) return null
  const before = source.slice(0, span.from)
  let after = source.slice(span.to)
  if (before.trim() === "" && after.startsWith("\n")) after = after.slice(1)
  else if (after.startsWith("\n") && before.endsWith("\n\n")) after = after.slice(1)
  return `${before}${after}`
}

export function moveBlock(
  source: string,
  slide: TransformSlide | null | undefined,
  index: number,
  target: number
): string | null {
  if (!slide || target < 0 || target >= (slide.blocks || []).length) return null
  const blocks = slide.blocks || []
  const slideRange = slide.range
  if (!slideRange) return null
  const ranged: Array<{ block: TransformBlock; range: TransformRange }> = []
  for (const block of blocks) {
    if (!block.range) return null
    ranged.push({ block, range: block.range })
  }
  const indexed = blocks[index]
  const movingGroupId = indexed?.position_scope === "group"
    ? indexed.position_directive_id
    : null
  const low = Math.min(index, target)
  const high = Math.max(index, target)
  if (blocks.slice(low, high + 1).some((block) =>
    block.position_scope === "group" && block.position_directive_id !== movingGroupId
  )) return null
  if (movingGroupId && blocks.slice(low, high + 1).some((block) =>
    block.position_scope !== "group" || block.position_directive_id !== movingGroupId
  )) return null

  const bodies: string[] = []
  const separators: string[] = []
  let firstStart: number | null = null
  let previousContentEnd = 0
  for (const { block, range } of ranged) {
    const start = blockOperationStart(slide, block)
    const raw = source.slice(range.start, range.end)
    const ending = raw.match(/\r\n|\n|\r$/)?.[0] || ""
    const contentEnd = range.end - ending.length
    bodies.push(source.slice(start, contentEnd))
    if (firstStart === null) firstStart = start
    else separators.push(source.slice(previousContentEnd, start))
    previousContentEnd = contentEnd
  }
  if (firstStart === null) return null
  const trailing = source.slice(previousContentEnd, slideRange.end)
  const leading = source.slice(slideRange.start, firstStart)
  const moved = bodies.splice(index, 1)[0]
  if (moved === undefined) return null
  bodies.splice(target, 0, moved)
  const body = `${leading}${bodies.map((text, position) => `${text}${separators[position] || ""}`).join("")}${trailing}`
  return `${source.slice(0, slideRange.start)}${body}${source.slice(slideRange.end)}`
}

export function parseAlignment(value?: string | null): Alignment {
  if (!value) return { horizontal: "left", vertical: "top", verticalExplicit: false }
  const parts = value.trim().split(/\s+/)
  let vertical = "top"
  let horizontal = "left"
  if (parts.length === 1) {
    const only = parts[0] ?? ""
    if (["left", "center", "right"].includes(only)) horizontal = only
    else if (["top", "middle", "bottom"].includes(only)) vertical = only
  } else if (parts.length >= 2) {
    const first = parts[0] ?? ""
    const second = parts[1] ?? ""
    vertical = first === "center" ? "middle" : first
    horizontal = second
  }
  return { horizontal, vertical, verticalExplicit: vertical !== "top" }
}

// Shared span math for replacing one `:::align{…}` directive line: absorbs the
// line ending into the replaced span (or synthesizes one) so the replacement
// never leaves a bare empty line behind.
export function directiveLineSpan(source: string, from: number, to: number): DirectiveLineSpan {
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

export function insertAlignDirective(source: string, from: number, inner: string): AlignInsertion {
  const lineEnding = source.match(/\r\n|\r|\n/)?.[0] || "\n"
  const replacement = `${inner}${lineEnding}${lineEnding}`
  return { updated: `${source.slice(0, from)}${replacement}${source.slice(from)}`, replacement, lineEnding }
}

// Single-span excision for `:::align{…}` (+ `:::`) directive ranges. Returns
// the absorbed end offset alongside the updated source so hosts can keep
// offset-tracking and map bookkeeping exact.
export function exciseRange(source: string, range: TransformRange): RangeExcision {
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
export function exciseRanges(source: string, ranges: readonly TransformRange[]): string {
  return [...ranges]
    .sort((left, right) => right.start - left.start)
    .reduce((updated, range) => exciseRange(updated, range).updated, source)
}

// Pure snippet-template expansion: `${n:default}` stops resolve to their
// defaults; tab-stop navigation stays host-side.
export function expandSnippet(body: string): SnippetExpansion {
  const stops: SnippetStop[] = []
  const text = body.replace(/\$\{(\d+)(?::([^}]*))?\}/g, (_, number: string, value = "") => {
    const start = textLengthBefore(body, stops)
    stops.push({ number: Number(number), start, length: value.length })
    return value
  })
  return { text, stops: stops.sort((a, b) => (a.number === 0 ? 1 : b.number === 0 ? -1 : a.number - b.number)) }
}

function textLengthBefore(body: string, stops: SnippetStop[]): number {
  const markers = [...body.matchAll(/\$\{\d+(?::[^}]*)?\}/g)]
  const marker = markers[stops.length]
  if (!marker || marker.index === undefined) return body.length

  return marker.index - stops.reduce((position, stop, index) =>
    position + (markers[index]?.[0].length ?? 0) - stop.length, 0)
}

// Pure media-markdown insertion text: pads the embed with blank lines unless
// the insertion point already sits on a blank boundary.
export function mediaInsertText(source: string, range: CaretRange, markdown: string): string {
  const before = source.slice(0, range.from)
  const after = source.slice(range.to)
  const prefix = before.length === 0 || /\n\n$/.test(before) ? "" : /\n$/.test(before) ? "\n" : "\n\n"
  const suffix = after.length === 0 || /^\n\n/.test(after) ? "" : /^\n/.test(after) ? "\n" : "\n\n"
  return `${prefix}${markdown}${suffix}`
}
