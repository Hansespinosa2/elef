// Verified math-span pairing for caret placement.
//
// The position map models math as zero-width (rendered atoms hide their
// text from the offset walkers), so a source offset at a math END
// boundary maps to the same visible point as its start. Mid-block that
// lands correctly in the following text, but at block end the walker
// can only express block start (before the atom), and inside an active
// span (which shows literal source) the map disagrees with the DOM
// entirely. Placing after math therefore resolves the realized span
// directly instead of routing through the map. Reading a caret inside
// an active span likewise resolves the span's match and counts source
// offsets from the match start (identity), instead of collapsing every
// in-span position to the match end.

// Mirror: packages/editor-runtime/src/controllers/editor_caret.ts
// MARKDOWN_MATH. Same match semantics (inline `$...$` confined to one
// line, display `$$...$$` spanning lines, escape pairs atomic) so
// pairing agrees with the position map about what counts as math.
const MATH_PATTERN = /\$\$((?:[^\\]|\\[\s\S])+?)\$\$|\$(?!\$)((?:[^$\\\r\n]|\\[^\r\n])+?)\$(?!\$)/g

export interface MathMatch {
  start: number
  end: number
  interior: string
}

export function scanMathMatches(source: string): MathMatch[] {
  const matches: MathMatch[] = []
  MATH_PATTERN.lastIndex = 0
  let match: RegExpExecArray | null
  while ((match = MATH_PATTERN.exec(source)) !== null) {
    const full = match[0] ?? ""
    if (full.length === 0) {
      MATH_PATTERN.lastIndex += 1
      continue
    }
    matches.push({ start: match.index, end: match.index + full.length, interior: match[1] ?? match[2] ?? "" })
  }
  return matches
}

export interface MathPair {
  match: MathMatch
  span: Element
}

// Positional pairing (nth source match to nth DOM span, document
// order), verified: counts must agree and every span must agree with
// its match, so stale or ambiguous spans refuse and callers fall
// through to the map. Active spans show literal source, so they verify
// against the match slice (their recorded source goes stale on the
// first native edit inside); rendered spans are immutable, so they
// verify against their recorded source.
export function pairMathSpans(spans: Element[], source: string): MathPair[] | null {
  const matches = scanMathMatches(source)
  if (spans.length !== matches.length) return null
  const pairs: MathPair[] = []
  for (let index = 0; index < matches.length; index += 1) {
    const match = matches[index]
    const span = spans[index]
    if (!match || !span) return null
    const active = span.hasAttribute("data-editor-math-active") || span.classList.contains("editor-math-active")
    if (active) {
      if ((span.textContent ?? "") !== source.slice(match.start, match.end)) return null
    } else if (span.getAttribute("data-editor-math-source") !== match.interior) {
      return null
    }
    pairs.push({ match, span })
  }
  return pairs
}

export function collectMathSpans(fragments: Element[]): Element[] {
  const spans: Element[] = []
  for (const fragment of fragments) {
    for (const span of fragment.querySelectorAll("[data-editor-math-source]")) spans.push(span)
  }
  return spans
}

export interface MathEndPoint {
  fragment: Element
  node: Node
  offset: number
}

// Caret point immediately after the realized span for a source offset
// at a math END boundary, or null when no placement applies. The caret
// lands outside the span (the expression is complete, so it correctly
// deactivates back to its canonical render); the deactivation swap
// preserves the side explicitly.
export function mathEndPlacement(
  fragments: Element[],
  source: string,
  relativeOffset: number
): MathEndPoint | null {
  const pairs = pairMathSpans(collectMathSpans(fragments), source)
  if (!pairs) return null
  const pair = pairs.find((candidate) => candidate.match.end === relativeOffset) ?? null
  if (!pair) return null
  const fragment = fragments.find((candidate) => candidate === pair.span || candidate.contains(pair.span)) ?? null
  if (!fragment) return null
  const parent = pair.span.parentNode
  if (!parent) return null
  const index = Array.prototype.indexOf.call(parent.childNodes, pair.span)
  if (index === -1) return null
  return { fragment, node: parent, offset: index + 1 }
}

// Source match for a caret inside an active math span, or null when the
// block's spans do not pair cleanly. Callers add the in-span visible
// offset to the match start (the span shows literal source).
export function mathMatchForSpan(
  fragments: Element[],
  source: string,
  span: Element
): MathMatch | null {
  const pairs = pairMathSpans(collectMathSpans(fragments), source)
  if (!pairs) return null
  return pairs.find((pair) => pair.span === span)?.match ?? null
}

// Active display span containing both endpoints, or null. Edits fully
// inside one commit by identity from the verified match (the span
// shows literal, possibly multiline, source).
export function activeDisplayMathForNodes(anchorNode: Node | null, focusNode: Node | null): Element | null {
  const spanFor = (node: Node | null): Element | null => {
    if (!node) return null
    const element = node.nodeType === Node.ELEMENT_NODE ? (node as Element) : (node as ChildNode).parentElement
    return element?.closest?.(".editor-math-active.editor-live-math-display") ?? null
  }
  const anchorSpan = spanFor(anchorNode)
  if (!anchorSpan) return null
  return spanFor(focusNode) === anchorSpan ? anchorSpan : null
}
