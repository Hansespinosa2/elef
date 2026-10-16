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
    if (node.parentElement?.closest?.(".katex-mathml, [aria-hidden='true']")) continue
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

// True when the edit leaves horizontal whitespace at a content edge:
// a leading/trailing space in the insert, or a deletion exposing one.
function touchesEdgeWhitespace(visibleText: string, edit: TranslatedProjectionEdit): boolean {
  const { fromVisible, toVisible, insert } = edit
  if (insert === "") {
    if (fromVisible === 0 && isCollapseSpace(visibleText[toVisible])) return true
    if (toVisible === visibleText.length && isCollapseSpace(visibleText[fromVisible - 1])) return true
    return false
  }
  if (fromVisible === 0 && isCollapseSpace(insert[0])) return true
  if (toVisible === visibleText.length && isCollapseSpace(insert[insert.length - 1])) return true
  return false
}

// A visible offset touches concealed syntax when the source map jumps
// across hidden characters beside it: a leading offset with source
// after position zero (marker prefix), or an interior offset whose
// source leapfrogs its predecessor (hidden delimiters between content).
// Edits touching such offsets stay on the structure-aware legacy path,
// which resolves DOM caret gravity and marker-adjacent whitespace the
// way it always has; the precise path only handles unambiguous
// interior content. Trailing offsets need no check: the map resolves
// them past closing delimiters, where both paths agree.
export function touchesConcealedBoundary(
  sourceOffsetForVisibleOffset: (source: string, offset: number) => number,
  slice: string,
  fromVisible: number,
  toVisible: number,
): boolean {
  for (const visible of [fromVisible, toVisible]) {
    const source = sourceOffsetForVisibleOffset(slice, visible)
    if (visible <= 0) {
      if (source > 0) return true
      continue
    }
    if (source - sourceOffsetForVisibleOffset(slice, visible - 1) > 1) return true
  }
  return false
}
