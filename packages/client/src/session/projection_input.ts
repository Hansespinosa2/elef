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
// screen-reader KaTeX sources and aria-hidden runs never count as visible.
export function visibleBlockText(block: Element): string {
  const document = block.ownerDocument
  const filter = document?.defaultView?.NodeFilter?.SHOW_TEXT ?? 4
  const walker = document?.createTreeWalker(block, filter)
  if (!walker) return block.textContent ?? ""
  let text = ""
  while (walker.nextNode()) {
    const node = walker.currentNode as unknown as { parentElement?: Element | null; textContent?: string | null }
    if (node.parentElement?.closest?.(".katex-mathml, [aria-hidden='true']")) continue
    text += node.textContent ?? ""
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

  switch (intent.inputType) {
    case "insertText":
      if (typeof intent.data !== "string") return null
      return { fromVisible, toVisible, insert: intent.data }
    case "insertFromPaste":
    case "insertFromDrop":
      if (typeof intent.transferText !== "string" || intent.transferHasHtml) return null
      return { fromVisible, toVisible, insert: intent.transferText }
    case "deleteContentBackward":
      if (!collapsed) return { fromVisible, toVisible, insert: "" }
      if (intent.focusVisible <= 0) return null
      return { fromVisible: previousGraphemeBoundary(visibleText, intent.focusVisible), toVisible: intent.focusVisible, insert: "" }
    case "deleteContentForward":
      if (!collapsed) return { fromVisible, toVisible, insert: "" }
      if (intent.focusVisible >= visibleText.length) return null
      return { fromVisible: intent.focusVisible, toVisible: nextGraphemeBoundary(visibleText, intent.focusVisible), insert: "" }
    default:
      return null
  }
}
