// Projection input translation: the input-bridge intent leg, shared by the
// document and presentation visual editors.
//
// A beforeinput intent plus the pre-mutation caret translates to an exact
// source transaction on the live engine, so typing history, Vim insert
// state, and extensions observe precise edits instead of reconstructed
// whole-block replacements. The native mutation still proceeds (the event
// is never preventDefaulted here): the existing pending/flush path re-reads
// the block afterwards and becomes a no-op when the precise change matches,
// a correction when it does not.
//
// Only caret-local plain-text intents translate. Structure intents (line
// splits and joins, word operations), compositions, rich transfers, and
// history intents return null and stay on the structure-aware legacy path,
// which also owns any batch once legacy pending edits exist.
export interface ProjectionInputIntent {
  readonly inputType: string
  readonly data: string | null
  readonly transferText: string | null
  readonly transferHasHtml: boolean
  readonly anchorVisible: number
  readonly focusVisible: number
  readonly kind: string
}

export interface TranslatedProjectionEdit {
  readonly fromVisible: number
  readonly toVisible: number
  readonly insert: string
}

function previousGraphemeBoundary(text: string, offset: number): number {
  if (offset <= 0) return 0
  if (typeof Intl.Segmenter === "function") {
    const segmenter = new Intl.Segmenter(undefined, { granularity: "grapheme" })
    let boundary = 0
    for (const segment of segmenter.segment(text) as Iterable<{ index: number }>) {
      if (segment.index >= offset) break
      boundary = segment.index
    }
    return boundary
  }
  const code = text.charCodeAt(offset - 1)
  if (offset >= 2 && code >= 0xdc00 && code <= 0xdfff) return offset - 2
  return offset - 1
}

function nextGraphemeBoundary(text: string, offset: number): number {
  if (offset >= text.length) return text.length
  if (typeof Intl.Segmenter === "function") {
    const segmenter = new Intl.Segmenter(undefined, { granularity: "grapheme" })
    for (const segment of segmenter.segment(text) as Iterable<{ index: number; segment: string }>) {
      if (segment.index > offset) return segment.index
      if (segment.index + segment.segment.length > offset) return segment.index + segment.segment.length
    }
    return text.length
  }
  const code = text.charCodeAt(offset)
  if (offset + 1 < text.length && code >= 0xd800 && code <= 0xdbff) return offset + 2
  return offset + 1
}

// Visible block text with the same exclusions the caret mapping uses:
// screen-reader KaTeX sources, aria-hidden runs, and all newlines
// never count as visible. Mirror: editor_caret.ts skips the same
// characters; the source map never models newlines as visible (it
// has no pre-awareness either), so counting them shifts every later
// offset. Plain-space runs (no newline) are rendered spaces and
// stay counted.
export function visibleBlockText(block: Element): string {
  const document = block.ownerDocument
  const filter = document?.defaultView?.NodeFilter?.SHOW_TEXT ?? 4
  const walker = document?.createTreeWalker(block, filter)
  if (!walker) return (block.textContent ?? "").replace(/[\r\n]/g, "")
  let text = ""
  while (walker.nextNode()) {
    const node = walker.currentNode as unknown as { parentElement?: Element | null; textContent?: string | null }
    // Skip whole KaTeX subtrees: math renders as one atom (mathml output
    // has no hidden duplicate to key on, so the wrapper is excluded).
    if (node.parentElement?.closest?.(".katex, .katex-mathml, [aria-hidden='true']")) continue
    const content = node.textContent ?? ""
    if (content.trim() === "" && /[\r\n]/.test(content)) continue
    text += content.replace(/[\r\n]/g, "")
  }
  return text
}

// Keys that keep their native behavior when Vim does not consume them in
// visual normal mode: caret navigation, focus traversal, and function keys.
// Everything else is swallowed so normal-mode keys can never insert text.
export function vimPassthroughKey(key: string): boolean {
  return /^(ArrowUp|ArrowDown|ArrowLeft|ArrowRight|Home|End|PageUp|PageDown|Tab|F\d{1,2})$/.test(key)
}

export function translateProjectionInput(
  intent: ProjectionInputIntent,
  visibleText = ""
): TranslatedProjectionEdit | null {
  const collapsed = intent.anchorVisible === intent.focusVisible
  const fromVisible = Math.min(intent.anchorVisible, intent.focusVisible)
  const toVisible = Math.max(intent.anchorVisible, intent.focusVisible)

  let edit: TranslatedProjectionEdit | null
  switch (intent.inputType) {
    case "insertText":
      if (typeof intent.data !== "string") return null
      edit = { fromVisible, toVisible, insert: intent.data }
      break
    case "insertFromPaste":
    case "insertFromDrop":
      if (typeof intent.transferText !== "string" || intent.transferHasHtml) return null
      edit = { fromVisible, toVisible, insert: intent.transferText }
      break
    case "deleteContentBackward":
      if (!collapsed) {
        edit = { fromVisible, toVisible, insert: "" }
        break
      }
      if (intent.focusVisible <= 0) return null
      edit = { fromVisible: previousGraphemeBoundary(visibleText, intent.focusVisible), toVisible: intent.focusVisible, insert: "" }
      break
    case "deleteContentForward":
      if (!collapsed) {
        edit = { fromVisible, toVisible, insert: "" }
        break
      }
      if (intent.focusVisible >= visibleText.length) return null
      edit = { fromVisible: intent.focusVisible, toVisible: nextGraphemeBoundary(visibleText, intent.focusVisible), insert: "" }
      break
    default:
      return null
  }
  // Outside code the legacy path collapses every whitespace run and
  // trims content-edge whitespace (see markdownForVisibleText); the
  // precise path must decline any edit the legacy path would
  // normalize, or the two paths produce different source.
  if (intent.kind !== "code") {
    if (formsCollapsedWhitespaceRun(visibleText, edit)) return null
    if (touchesEdgeWhitespace(visibleText, edit)) return null
  }
  return edit
}

function isCollapseSpace(char: string | undefined): boolean {
  return char === " " || char === "\t" || char === "\u00a0"
}

// True when the edit leaves two horizontal spaces adjacent: an
// internal run in the insert, a run spanning an insert edge, or a
// deletion joining two spaces. Newlines are content, not collapse
// spaces: neither path collapses them.
function formsCollapsedWhitespaceRun(visibleText: string, edit: TranslatedProjectionEdit): boolean {
  if (/[ \t\u00a0]{2,}/.test(edit.insert)) return true
  const left = visibleText[edit.fromVisible - 1]
  const right = visibleText[edit.toVisible]
  if (edit.insert === "") return isCollapseSpace(left) && isCollapseSpace(right)
  const first = edit.insert[0]
  const last = edit.insert[edit.insert.length - 1]
  return (isCollapseSpace(left) && isCollapseSpace(first)) || (isCollapseSpace(last) && isCollapseSpace(right))
}

// True when the edit touches leading edge whitespace (inserts merge with
// a concealed structural separator there, e.g. the `# ` of an empty
// heading, which only the collapsing legacy path owns) or when a
// deletion exposes edge whitespace. Trailing inserts stay precise: the
// legacy trim hides them from the differ and refuses pure-trailing
// diffs as precise-owned, so declining strands trailing insertion
// entirely — while committing can never diverge (trailing spaces are
// content: hard-break authoring needs them verbatim, and legacy
// round-trips source edges byte-identical). Run-forming inserts still
// decline above: collapsing genuinely normalizes those.
function touchesEdgeWhitespace(visibleText: string, edit: TranslatedProjectionEdit): boolean {
  const { fromVisible, toVisible, insert } = edit
  if (insert === "") {
    if (fromVisible === 0 && isCollapseSpace(visibleText[toVisible])) return true
    if (toVisible === visibleText.length && isCollapseSpace(visibleText[fromVisible - 1])) return true
    return false
  }
  if (fromVisible === 0 && isCollapseSpace(insert[0])) return true
  return false
}

// Maps a DOM-visible offset to a source offset: the inverse walk of
// alignSourceOffset, sharing its concealed-syntax steps. Either side can
// lead by whitespace the other folded (trimmed trailing spaces the DOM
// never rendered, just-typed nbsp the engine has not committed, edge
// spaces the renderer kept): both skip, with syntax winning over DOM
// whitespace when the source opens a construct. A DOM offset beside a
// zero-width atom resolves to the construct start (the DOM cannot
// express which side); anything else unrecognized declines so callers
// fall back to the position map. DOM-end gets end-of-source affinity
// past an invisible tail; interior carets hug the preceding character.
export function alignVisibleOffset(slice: string, blockText: string, domOffset: number): number | null {
  // Contenteditable stores typed edge whitespace as non-breaking spaces
  // while the engine commits regular spaces; normalize both sides before
  // comparing. The substitution is one-to-one, so offsets still index the
  // original texts.
  slice = slice.replace(/\u00a0/g, " ")
  blockText = blockText.replace(/\u00a0/g, " ")
  if (domOffset < 0 || domOffset > blockText.length) return null
  // Offset zero with a hidden prefix (concealed markers, stripped leading
  // whitespace) has no unambiguous source: committing at zero would place
  // the edit outside formatting the DOM caret sits inside, so decline to
  // the structure-aware legacy path. Empty blocks map zero to zero.
  if (domOffset === 0 && slice.length > 0 && slice[0] !== blockText[0]) return null
  let sourceIndex = 0
  let domIndex = 0
  while (domIndex < domOffset) {
    if (sourceIndex >= slice.length) return null
    if (slice[sourceIndex] === blockText[domIndex]) {
      sourceIndex += 1
      domIndex += 1
      continue
    }
    if (isAlignSkippable(slice[sourceIndex])) {
      sourceIndex += 1
      continue
    }
    if (isAlignSkippable(blockText[domIndex]) &&
      (!OPENS_ALIGN_SYNTAX.has(slice[sourceIndex] ?? "") || literalAlignAhead(slice, blockText, sourceIndex, domIndex))) {
      domIndex += 1
      continue
    }
    const stepped = skipAlignSyntax(slice, blockText, sourceIndex, domIndex)
    if (stepped) {
      sourceIndex = stepped.sourceIndex
      domIndex = stepped.domIndex
      continue
    }
    if (isAlignSkippable(blockText[domIndex])) {
      domIndex += 1
      continue
    }
    return null
  }
  if (domOffset === blockText.length) {
    while (sourceIndex < slice.length && isAlignSkippable(slice[sourceIndex])) sourceIndex += 1
    return sourceIndex === slice.length ? sourceIndex : null
  }
  return sourceIndex
}

// Inverse of alignVisibleOffset: maps a source offset to a DOM-visible
// offset for caret placement. The DOM can LEAD the engine by whitespace
// the source trimmed (a just-typed edge space stored as nbsp): the walk
// skips whitespace on either side (source-extra is DOM-folded,
// DOM-extra is uncommitted lag), sharing its concealed-syntax steps with
// the read direction below.

// Mirror: packages/editor-runtime/src/controllers/editor_caret.ts
// markdownPositionMap (order, patterns, and visible forms).
const ALIGN_LINE_PREFIX = /^[ \t]{0,3}(?:#{1,6}[ \t]+|>[ \t]?|(?:[-+*]|\d+[.)])[ \t]+)/
const ALIGN_IMAGE = /^!\[([^\]]*)\]\((?:\\.|[^)])*\)/
const ALIGN_LINK = /^\[([^\]]+)\]\((?:\\.|[^)])*\)/
const ALIGN_DOCUMENT_LINK = /^\[\[([^\]]+)\]\]/
const ALIGN_LINK_CLOSE = /^\]\((?:\\.|[^)])*\)/
const ALIGN_DOCUMENT_LINK_CLOSE = /^\]\]/
const ALIGN_MATH = /^(?:\$\$((?:[^\\]|\\[\s\S])+?)\$\$|\$(?!\$)((?:[^$\\\r\n]|\\[^\r\n])+?)\$(?!\$))/
const ALIGN_DELIMITER = /^(?:\*\*|__|~~|`+|\*|_)/
const ALIGN_ESCAPABLE = /[\\`*_{}\[\]()#+.!|>~-]/
// Characters that can open a concealed construct. When the source holds
// one of these opposite DOM whitespace, the whitespace either belongs
// after a folded construct (e.g. the space following rendered math), so
// syntax wins over the whitespace skip, or is lag before a literally
// shown construct (e.g. an nbsp before an active display span), so the
// lag skips and the literal text flows through the equality branch. The
// literal-ahead lookahead below tells the two apart. A failed construct
// still falls through to the lag skip: literal dollars can face a
// just-typed space.
const OPENS_ALIGN_SYNTAX = new Set([
  "#", ">", "-", "+", "*", "_", "~", "`", "$", "[", "]", "!", "|", "\\",
  "0", "1", "2", "3", "4", "5", "6", "7", "8", "9",
])

function isAlignSkippable(char: string | undefined): boolean {
  return char === " " || char === "\t" || char === "\n" || char === "\r"
}

// True when the DOM shows the source construct at `sourceIndex` literally
// past a whitespace lag run: the construct's visible form (math source,
// link text, escaped char, prefix) starts after the run. Callers skip the
// lag and let the literal text align through equality instead of
// consuming the construct as folded.
function literalAlignAhead(slice: string, blockText: string, sourceIndex: number, domIndex: number): boolean {
  let ahead = domIndex
  while (isAlignSkippable(blockText[ahead])) ahead += 1
  const rest = slice.slice(sourceIndex)
  const math = rest.match(ALIGN_MATH)
  if (math && blockText.startsWith(math[0] ?? "", ahead)) return true
  if (rest[0] === "!") {
    const image = rest.match(ALIGN_IMAGE)
    if (image && blockText.startsWith(image[1] ?? "", ahead)) return true
  } else {
    const link = rest.match(ALIGN_LINK)
    if (link && blockText.startsWith(link[1] ?? "", ahead)) return true
    const docLink = rest.match(ALIGN_DOCUMENT_LINK)
    if (docLink && blockText.startsWith(docLink[1] ?? "", ahead)) return true
  }
  if (rest[0] === "\\" && rest.length > 1 && ALIGN_ESCAPABLE.test(rest[1] ?? "") && blockText[ahead] === rest[1]) return true
  const linePrefix = rest.match(ALIGN_LINE_PREFIX)
  if (linePrefix && blockText.startsWith(linePrefix[0] ?? "", ahead)) return true
  return false
}

interface AlignSyntaxStep {
  sourceIndex: number
  domIndex: number
}

// One concealed-construct step shared by both walk directions. Either the
// DOM shows the construct literally (active spans, unrendered markers),
// in which case indices advance together, or the DOM folded it and only
// the source advances. Links consume in two phases: the opener verifies
// the text ahead but advances past the bracket alone, so the text flows
// through the equality branch one character at a time and mid-text carets
// map inside the text instead of overshooting to the link end; the closer
// then consumes atomically. Anything unrecognized declines so callers
// fall back to the position map.
function skipAlignSyntax(
  slice: string,
  blockText: string,
  sourceIndex: number,
  domIndex: number
): AlignSyntaxStep | null {
  const rest = slice.slice(sourceIndex)
  // Line prefixes only open at a line start: mid-line `* ` is an
  // emphasis boundary plus a space, not a bullet.
  const atLineStart = sourceIndex === 0 || slice[sourceIndex - 1] === "\n"
  const linePrefix = atLineStart ? rest.match(ALIGN_LINE_PREFIX) : null
  if (linePrefix) {
    const length = linePrefix[0]?.length ?? 0
    return {
      sourceIndex: sourceIndex + length,
      domIndex: blockText.startsWith(linePrefix[0] ?? "", domIndex) ? domIndex + length : domIndex
    }
  }
  if (rest[0] === "!") {
    const image = rest.match(ALIGN_IMAGE)
    if (image) {
      const text = image[1] ?? ""
      if (!blockText.startsWith(text, domIndex)) return null
      return { sourceIndex: sourceIndex + 2, domIndex }
    }
  } else {
    const link = rest.match(ALIGN_LINK)
    if (link) {
      const text = link[1] ?? ""
      if (!blockText.startsWith(text, domIndex)) return null
      return { sourceIndex: sourceIndex + 1, domIndex }
    }
    const docLink = rest.match(ALIGN_DOCUMENT_LINK)
    if (docLink) {
      const text = docLink[1] ?? ""
      if (!blockText.startsWith(text, domIndex)) return null
      return { sourceIndex: sourceIndex + 2, domIndex }
    }
  }
  if (rest[0] === "]") {
    const close = rest.match(ALIGN_LINK_CLOSE) ?? rest.match(ALIGN_DOCUMENT_LINK_CLOSE)
    if (!close) return null
    return { sourceIndex: sourceIndex + (close[0]?.length ?? 0), domIndex }
  }
  const math = rest.match(ALIGN_MATH)
  if (math) {
    const full = math[0] ?? ""
    return {
      sourceIndex: sourceIndex + full.length,
      domIndex: blockText.startsWith(full, domIndex) ? domIndex + full.length : domIndex
    }
  }
  if (rest[0] === "\\" && rest.length > 1 && ALIGN_ESCAPABLE.test(rest[1] ?? "")) {
    if (blockText[domIndex] !== rest[1]) return null
    return { sourceIndex: sourceIndex + 2, domIndex: domIndex + 1 }
  }
  const char = rest[0]
  if (char === "\n" || char === "\r") {
    return { sourceIndex: sourceIndex + 1, domIndex }
  }
  if (char === "|") {
    return {
      sourceIndex: sourceIndex + 1,
      domIndex: blockText[domIndex] === "|" ? domIndex + 1 : domIndex
    }
  }
  const delimiter = rest.match(ALIGN_DELIMITER)
  if (delimiter) {
    return { sourceIndex: sourceIndex + (delimiter[0]?.length ?? 0), domIndex }
  }
  return null
}

export function alignSourceOffset(slice: string, blockText: string, sourceOffset: number): number | null {
  slice = slice.replace(/\u00a0/g, " ")
  blockText = blockText.replace(/\u00a0/g, " ")
  if (sourceOffset < 0 || sourceOffset > slice.length) return null
  let sourceIndex = 0
  let domIndex = 0
  while (sourceIndex < sourceOffset) {
    if (domIndex >= blockText.length) {
      while (sourceIndex < sourceOffset && isAlignSkippable(slice[sourceIndex])) sourceIndex += 1
      return sourceIndex === sourceOffset ? domIndex : null
    }
    if (slice[sourceIndex] === blockText[domIndex]) {
      sourceIndex += 1
      domIndex += 1
      continue
    }
    if (isAlignSkippable(slice[sourceIndex])) {
      sourceIndex += 1
      continue
    }
    if (isAlignSkippable(blockText[domIndex]) &&
      (!OPENS_ALIGN_SYNTAX.has(slice[sourceIndex] ?? "") || literalAlignAhead(slice, blockText, sourceIndex, domIndex))) {
      domIndex += 1
      continue
    }
    const stepped = skipAlignSyntax(slice, blockText, sourceIndex, domIndex)
    if (stepped) {
      sourceIndex = stepped.sourceIndex
      domIndex = stepped.domIndex
      continue
    }
    if (isAlignSkippable(blockText[domIndex])) {
      domIndex += 1
      continue
    }
    return null
  }
  return domIndex
}

// A visible offset touches concealed syntax when the source map jumps
// across hidden characters beside it: a leading offset with source
// after position zero (marker prefix), or an interior offset whose
// source leapfrogs its predecessor (hidden delimiters between content).
// Edits touching such offsets stay on the structure-aware legacy path,
// which resolves DOM caret gravity and marker-adjacent whitespace the
// way it always has; the precise path only handles unambiguous
// interior content. Trailing offsets need no check: the map resolves
// them past closing delimiters, where both paths agree. The mapping
// must be the same one the commit uses (the whitespace-tolerant
// aligner): the caret map jumps over lag whitespace the DOM never
// rendered, which would decline every keystroke after a folded run.
// Unmappable offsets decline: the edit stays legacy.
export function touchesConcealedBoundary(
  sourceOffsetForVisibleOffset: (source: string, offset: number) => number | null,
  slice: string,
  fromVisible: number,
  toVisible: number,
): boolean {
  for (const visible of [fromVisible, toVisible]) {
    const source = sourceOffsetForVisibleOffset(slice, visible)
    if (source === null) return true
    if (visible <= 0) {
      if (source > 0) return true
      continue
    }
    const previous = sourceOffsetForVisibleOffset(slice, visible - 1)
    if (previous === null || source - previous > 1) return true
  }
  return false
}
