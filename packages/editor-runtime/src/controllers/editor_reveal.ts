// Visual inline revelation (slices 1-2: emphasis, strong,
// strikethrough, code, links). Rendered inline constructs conceal
// their delimiters; when the caret enters one, the element swaps for an
// editable source-text span (mirroring the math-active pattern), and the
// differ projects the revealed source slice instead of the concealed
// content. Structural markers (heading/list/quote/fence) reveal through
// CSS pseudo-elements instead (slice 3) so they never enter text.
//
// Pairing between source tokens and DOM elements is positional
// (document order against token order) plus verification (element kind
// matches token kind, active delimiters match token delimiters). No
// offsets are persisted: pairing is stateless per call, so precise
// commits between activation and flush cannot strand stale positions.
// A mismatch with active spans present refuses the flush (the batch
// stays in the DOM and the next flush recovers it); the legacy
// concealed path never refuses.

export interface RevealToken {
  kind: "format" | "code" | "link" | "document_link";
  formatType?: "strong" | "emphasis" | "strike";
  start: number;
  end: number;
  open: string;
  close: string;
}

export interface RevealPair {
  token: RevealToken;
  element: Element;
  activeSpan: HTMLElement | null;
}

// Verified token-start -> active-span map for the differ. The differ
// stays dependency-free (its node harness inlines it dependency-free),
// so hosts resolve this and inject it through options.
export type RevealActives = Map<number, { span: HTMLElement; token: RevealToken }>

interface ActiveStash {
  original: Element;
  baseline: string;
}

const stashes = new WeakMap<HTMLElement, ActiveStash>()

const REVEALABLE_SELECTOR = "em, strong, del, s, code, a, span.document-link.unresolved"
const ACTIVE_SELECTOR = "[data-editor-inline-active='true']"
const ATOM_SELECTOR = "[data-editor-math-source], [data-editor-math-active], img, [data-editor-image-source]"
// DOM Node nodeType for elements (avoids the Node global so this module
// stays dependency-free and runnable wherever Elements exist).
const ELEMENT_NODE = 1

function elementKind(element: Element): RevealToken["kind"] | null {
  const tag = element.tagName.toUpperCase()
  if (tag === "EM" || tag === "STRONG" || tag === "DEL" || tag === "S") return "format"
  if (tag === "CODE" && !element.closest("pre")) return "code"
  if (tag === "A") {
    if (element.classList.contains("document-link")) return "document_link"
    // Autolinks have no explicit source syntax (text approximates the
    // href); excluding them keeps counts aligned for real links. A
    // miss or false positive only refuses revelation (never corrupts:
    // counts are the pairing guard).
    if (isAutolink(element)) return null
    return "link"
  }
  if (tag === "SPAN" && element.classList.contains("document-link")) return "document_link"
  return null
}

// Linkified URLs render as anchors with no source token. Their text
// is the URL itself, modulo the scheme linkify prepends.
function isAutolink(anchor: Element): boolean {
  const text = (anchor.textContent ?? "").trim()
  const href = anchor.getAttribute("href") ?? ""
  if (!text || !href) return false
  return href === text ||
    href === `http://${text}` ||
    href === `https://${text}` ||
    href === `ftp://${text}` ||
    href === `mailto:${text}`
}

function tokenizeRevealables(source: string): RevealToken[] {
  const tokens: RevealToken[] = []
  let index = 0
  while (index < source.length) {
    // Escaped characters are literal (an escaped delimiter never opens
    // a construct); images and math spans are opaque (their markers
    // never pair with revealable elements). Skip all three so markers
    // inside them cannot mint spurious tokens.
    if (source[index] === "\\") {
      index += 2
      continue
    }
    const skip = opaqueLengthAt(source, index)
    if (skip > 0) {
      index += skip
      continue
    }
    const token = revealTokenAt(source, index)
    if (!token) {
      index += 1
      continue
    }
    tokens.push(token)
    index = token.end
  }
  return tokens
}

// Length of the image or math construct opening at index (0 when
// none). Mirrors inlineTokenAt boundaries: images are atoms, math
// spans are opaque, and neither ever pairs with a revealable.
function opaqueLengthAt(source: string, index: number): number {
  const rest = source.slice(index)
  const image = rest.match(/^!\[([^\]]*)\]\(([^)\s]+)(?:\s+["'][^"']*["'])?\)/)
  if (image) return (image[0] ?? "").length
  const displayBracket = rest.match(/^\\\[([\s\S]+?)\\\]/)
  if (displayBracket) return (displayBracket[0] ?? "").length
  const inlineParen = rest.match(/^\\\(([^\\\r\n]+?)\\\)/)
  if (inlineParen) return (inlineParen[0] ?? "").length
  const displayDollar = rest.match(/^\$\$([\s\S]+?)\$\$(?!\$)/)
  if (displayDollar) return (displayDollar[0] ?? "").length
  if (source[index - 1] !== "$") {
    const inlineDollar = rest.match(/^\$(?!\$)(?!\s)([^$\r\n]+?)(?<!\s)\$(?!\$)/)
    if (inlineDollar) return (inlineDollar[0] ?? "").length
  }
  return 0
}

// Minimal tokenizer for revealable inline constructs. It must agree
// with inlineTokenAt on boundaries for well-formed input; malformed
// input yields no token and the construct simply never activates.
function revealTokenAt(source: string, index: number): RevealToken | null {
  const rest = source.slice(index)
  // Inline code: backtick runs (content is literal, may contain markers).
  // Mirrors inlineTokenAt exactly (non-empty, same-length close).
  const code = rest.match(/^(`+)([^`\r\n]+?)\1/)
  if (code?.[1] !== undefined) {
    return { kind: "code", start: index, end: index + code[0].length, open: code[1], close: code[1] }
  }
  // Strong / strikethrough before emphasis (longest delimiter wins, and
  // the choice must match the renderer's nesting for pairing to hold).
  for (const delimiter of ["**", "__", "~~"]) {
    if (!rest.startsWith(delimiter)) continue
    const end = rest.indexOf(delimiter, delimiter.length)
    if (end < 0) continue
    const content = rest.slice(delimiter.length, end)
    if (!content || /^\s|\s$/.test(content) || content.includes("\n")) continue
    const formatType = delimiter === "~~" ? "strike" as const : "strong" as const
    return { kind: "format", formatType, start: index, end: index + end + delimiter.length, open: delimiter, close: delimiter }
  }
  for (const delimiter of ["*", "_"]) {
    if (!rest.startsWith(delimiter)) continue
    if (rest[1] === delimiter) continue
    const end = rest.indexOf(delimiter, 1)
    if (end < 0) continue
    const content = rest.slice(1, end)
    if (!content || /^\s|\s$/.test(content) || content.includes("\n")) continue
    return { kind: "format", formatType: "emphasis", start: index, end: index + end + 1, open: delimiter, close: delimiter }
  }
  // Links mirror inlineTokenAt exactly (link before document link).
  const link = rest.match(/^(\[([^\]]+)\]\(([^\s)]+)(?:\s+["'][^"']*["'])?\))/)
  if (link) {
    return { kind: "link", start: index, end: index + (link[0] ?? "").length, open: "[", close: ")" }
  }
  const documentLink = rest.match(/^(\[\[([^\]|]+)(?:\|([^\]]*))?\]\])/)
  if (documentLink) {
    return { kind: "document_link", start: index, end: index + (documentLink[0] ?? "").length, open: "[[", close: "]]" }
  }
  return null
}

function outermostRevealables(root: Element): Element[] {
  // querySelectorAll returns document order without TreeWalker globals.
  const candidates = [...root.querySelectorAll(`${REVEALABLE_SELECTOR}, ${ACTIVE_SELECTOR}`)]
  const found: Element[] = []
  for (const element of candidates) {
    if (element.closest?.(ATOM_SELECTOR)) continue
    if (element.matches?.(ACTIVE_SELECTOR)) {
      found.push(element)
      continue
    }
    if (elementKind(element) === null) continue
    if (element.closest?.(ACTIVE_SELECTOR)) continue
    // Outermost only: a construct nested in another revealable is
    // covered by its ancestor's source slice when that activates.
    const ancestor = element.parentElement?.closest?.(REVEALABLE_SELECTOR)
    if (ancestor && root.contains(ancestor)) continue
    found.push(element)
  }
  return found
}

// Pair source tokens with DOM elements in order, verifying kinds.
// Returns null on any mismatch (caller refuses active projection).
export function pairRevealables(source: string, root: Element): RevealPair[] | null {
  const tokens = tokenizeRevealables(source)
  const elements = outermostRevealables(root)
  if (tokens.length !== elements.length) return null
  const pairs: RevealPair[] = []
  for (let i = 0; i < tokens.length; i += 1) {
    const token = tokens[i] as RevealToken
    const element = elements[i] as Element
    const activeSpan = (element.matches?.(ACTIVE_SELECTOR) ? element : null) as HTMLElement | null
    const kind = activeSpan ? (activeSpan.dataset.editorInlineKind as RevealToken["kind"]) : elementKind(element)
    if (!kind || kind !== token.kind) return null
    if (kind === "format" && activeSpan) {
      const formatType = activeSpan.dataset.editorInlineFormat as RevealToken["formatType"]
      if (formatType && formatType !== token.formatType) return null
    }
    pairs.push({ token, element, activeSpan })
  }
  return pairs
}

function delimitersMatch(token: RevealToken, text: string): boolean {
  return text.startsWith(token.open) && text.endsWith(token.close) &&
    text.length >= token.open.length + token.close.length
}

// Offset of a DOM point within an element's text (null when outside).
function offsetInElement(element: Element, node: Node, offset: number): number | null {
  let seen = 0
  let found: number | null = null
  const visit = (current: Node): void => {
    if (found !== null) return
    if (current === node) {
      if (current.nodeType === ELEMENT_NODE) {
        // Element endpoint: offset counts child nodes.
        let sum = 0
        const kids = [...(current.childNodes ?? [])]
        for (let i = 0; i < Math.min(offset, kids.length); i += 1) sum += ((kids[i] as Node).textContent ?? "").length
        found = seen + sum
      } else {
        found = seen + Math.min(offset, (current.textContent ?? "").length)
      }
      return
    }
    if (current.nodeType !== ELEMENT_NODE) {
      seen += (current.textContent ?? "").length
      return
    }
    for (const child of [...(current.childNodes ?? [])]) visit(child)
  }
  visit(element)
  return found
}

function intersects(element: Element, range: Range): boolean {
  try {
    return range.intersectsNode(element)
  } catch {
    return false
  }
}

function touchedPair(pairs: RevealPair[], root: Element, node: Node | null): RevealPair | null {
  if (!node) return null
  const element = node.nodeType === ELEMENT_NODE ? (node as Element) : node.parentElement
  const active = element?.closest?.(ACTIVE_SELECTOR) as HTMLElement | null
  if (active && root.contains(active)) {
    return pairs.find((pair) => pair.activeSpan === active) ?? null
  }
  const revealable = element?.closest?.(REVEALABLE_SELECTOR) as Element | null
  if (!revealable || !root.contains(revealable)) return null
  if (revealable.closest?.(ACTIVE_SELECTOR)) return null
  return pairs.find((pair) => pair.element === revealable || pair.element.contains(revealable)) ?? null
}

function activatePair(pair: RevealPair, source: string, selection: Selection | null): HTMLElement | null {
  const { token, element } = pair
  if (element.matches?.(ACTIVE_SELECTOR)) return element as HTMLElement
  // Unresolved document links already show literal [[syntax]]; only
  // anchors have concealed link syntax worth revealing.
  if ((token.kind === "link" || token.kind === "document_link") && element.tagName.toUpperCase() !== "A") return null
  // Atom-guard safety: an inline construct containing math or an image
  // would strand atoms the differ counts, so it never activates.
  if (element.querySelector?.(ATOM_SELECTOR)) return null
  const slice = source.slice(token.start, token.end)
  if (!delimitersMatch(token, slice)) return null
  // Remap selection endpoints inside the element across the swap: the
  // new span prefixes the opening delimiter before the old content.
  const doc = element.ownerDocument
  const remap = (node: Node | null, offset: number): number | null => {
    if (!node) return null
    const inner = offsetInElement(element, node, offset)
    return inner === null ? null : inner + token.open.length
  }
  const anchor = selection && selection.rangeCount > 0 ? remap(selection.anchorNode, selection.anchorOffset) : null
  const focus = selection && selection.rangeCount > 0 ? remap(selection.focusNode, selection.focusOffset) : null
  const span = doc.createElement("span")
  span.className = "editor-inline-active"
  span.dataset.editorInlineActive = "true"
  span.dataset.editorInlineKind = token.kind
  if (token.formatType) span.dataset.editorInlineFormat = token.formatType
  span.dataset.editorInlineSource = slice
  span.spellcheck = false
  const textNode = doc.createTextNode(slice)
  span.appendChild(textNode)
  stashes.set(span, { original: element, baseline: slice })
  element.parentNode?.replaceChild(span, element)
  // Only endpoints inside the swapped element remap; outside
  // endpoints (a range spanning several constructs) stay untouched so
  // the selection survives multi-activation.
  const liveAnchorNode = selection?.anchorNode ?? null
  const liveFocusNode = selection?.focusNode ?? null
  if (selection && liveAnchorNode && liveFocusNode && (anchor !== null || focus !== null)) {
    const end = textNode.textContent?.length ?? 0
    const clamp = (value: number): number => Math.max(0, Math.min(value, end))
    selection.setBaseAndExtent(
      anchor !== null ? textNode : liveAnchorNode, anchor !== null ? clamp(anchor) : selection.anchorOffset,
      focus !== null ? textNode : liveFocusNode, focus !== null ? clamp(focus) : selection.focusOffset
    )
  }
  return span
}

function deactivateSpan(span: HTMLElement, onFlush: (() => void) | null): void {
  const stash = stashes.get(span)
  const current = span.textContent ?? ""
  if (typeof onFlush === "function") onFlush()
  // Unedited exit restores the stashed render instantly (the selection
  // already left, so no caret work is needed). Edited text stays
  // visible (it is current source, never a stale render) until the
  // projection refresh replaces the block with canonical output.
  if (stash && current === stash.baseline && span.parentNode) {
    span.parentNode.replaceChild(stash.original, span)
  }
  stashes.delete(span)
}

// Structural markers (heading/list/quote prefixes, fence delimiters)
// reveal through CSS pseudo-elements driven by data attributes, so
// they never enter text, caret math, or the differ. Markers derive
// from source order and verify against rendered text; any mismatch
// (nested constructs, split fragments, lazy lines) hides the marker
// instead of showing a wrong one.
const MARKER_ATTR = "data-editor-reveal-prefix"
const FENCE_OPEN_ATTR = "data-editor-reveal-fence-open"
const FENCE_CLOSE_ATTR = "data-editor-reveal-fence-close"

type StructuralKind = "heading" | "list" | "quote" | "fence"

function collapseText(value: string): string {
  return value.replace(/[\s\u00a0]+/g, " ").trim()
}

function markerPattern(kind: StructuralKind): RegExp | null {
  if (kind === "heading") return /^(#{1,6}\s+)/
  if (kind === "list") return /^(\s*(?:[-+*]|\d+[.)])\s+)/
  if (kind === "quote") return /^(\s*>\s?)/
  return null
}

function lineSelector(kind: StructuralKind): string {
  if (kind === "heading") return "h1, h2, h3, h4, h5, h6"
  if (kind === "list") return "li"
  return "blockquote > p, blockquote > div"
}

// Marker for the index-th content line, verified against the rendered
// line text. Null when the line cannot be shown exactly.
export function structuralMarkerForLine(kind: StructuralKind, sourceLines: string[], index: number, lineText: string): string | null {
  const pattern = markerPattern(kind)
  if (!pattern) return null
  const contentLines = sourceLines.filter((line) => {
    const marker = line.match(pattern)
    return marker !== null && collapseText(line.slice((marker[1] ?? "").length)) !== ""
  })
  const raw = contentLines[index] ?? null
  if (raw === null) return null
  const marker = raw.match(pattern)?.[1] ?? null
  if (!marker) return null
  if (collapseText(raw.slice(marker.length)) !== collapseText(lineText)) return null
  return marker
}

export function fenceDelimiters(sourceLines: string[]): { open: string; close: string | null } | null {
  const open = sourceLines[0]?.match(/^([ \t]*(`{3,}|~{3,})[^\r\n]*)$/) ?? null
  if (!open) return null
  const fenceChar = (open[2] ?? "")[0] ?? ""
  const nonEmpty = sourceLines.filter((line) => line.trim() !== "")
  const last = nonEmpty[nonEmpty.length - 1] ?? ""
  const closeMatch = last.match(/^([ \t]*(`{3,}|~{3,})[ \t]*)$/)
  const close = closeMatch && (closeMatch[2] ?? "")[0] === fenceChar && nonEmpty.length > 1 ? closeMatch[1] ?? null : null
  return { open: open[1] ?? "", close }
}

function blockStructuralKind(block: Element): StructuralKind | null {
  const first = block.firstElementChild
  if (!first) return null
  if (/^H[1-6]$/.test(first.tagName)) return "heading"
  if (first.tagName === "UL" || first.tagName === "OL") return "list"
  if (first.tagName === "BLOCKQUOTE") return "quote"
  if (first.tagName === "PRE") return "fence"
  return null
}

function syncStructuralReveal(root: Element, blocks: Map<Element, string>, liveRange: Range | null): void {
  const marked = new Set<Element>()
  if (liveRange) {
    for (const [block, source] of blocks) {
      const kind = blockStructuralKind(block)
      if (!kind) continue
      const sourceLines = source.split("\n")
      if (kind === "fence") {
        if (!block.contains(liveRange.startContainer) && !block.contains(liveRange.endContainer)) continue
        const delimiters = fenceDelimiters(sourceLines)
        if (!delimiters) continue
        block.setAttribute(FENCE_OPEN_ATTR, delimiters.open)
        if (delimiters.close === null) block.removeAttribute(FENCE_CLOSE_ATTR)
        else block.setAttribute(FENCE_CLOSE_ATTR, delimiters.close)
        block.classList.add("editor-reveal-fence")
        marked.add(block)
        continue
      }
      const lines = [...block.querySelectorAll(lineSelector(kind))]
      lines.forEach((line, index) => {
        const touched = line.contains(liveRange.startContainer) ||
          line.contains(liveRange.endContainer) ||
          (!liveRange.collapsed && intersects(line, liveRange))
        if (!touched) return
        const marker = structuralMarkerForLine(kind, sourceLines, index, line.textContent ?? "")
        if (marker === null) return
        line.setAttribute(MARKER_ATTR, marker)
        line.classList.add("editor-reveal-marker")
        marked.add(line)
      })
    }
  }
  // Sweep stale markers across the root: marking derives from the
  // live range, so anything unmarked this pass is untouched.
  root.querySelectorAll(`[${MARKER_ATTR}]`).forEach((line) => {
    if (marked.has(line)) return
    line.removeAttribute(MARKER_ATTR)
    line.classList.remove("editor-reveal-marker")
  })
  root.querySelectorAll(".editor-reveal-fence").forEach((block) => {
    if (marked.has(block)) return
    block.removeAttribute(FENCE_OPEN_ATTR)
    block.removeAttribute(FENCE_CLOSE_ATTR)
    block.classList.remove("editor-reveal-fence")
  })
}

// Selection-driven sync over one projection root. Activation needs
// each touched block's source slice (getSource); deactivation sweeps
// the whole root so no span stays active behind the selection. Pure
// sync: inline content is transparent text, so native caret motion
// needs no key or click interception (unlike opaque math atoms).
// Structural markers ride the same pass through data attributes.
export function syncActiveInline(
  root: Element | null,
  getSource: ((block: Element) => string | null) | null,
  onFlush: (() => void) | null = null
): void {
  if (!root) return
  const selection = root.ownerDocument.getSelection?.() ?? null
  const range = selection && selection.rangeCount > 0 ? selection.getRangeAt(0) : null
  const endpoints = range ? [range.startContainer, range.endContainer] : []
  const blocks = new Map<Element, string>()
  for (const endpoint of endpoints) {
    const element = endpoint.nodeType === ELEMENT_NODE ? (endpoint as Element) : (endpoint as ChildNode).parentElement
    const block = element?.closest?.("[data-editor-block-id]") as Element | null
    if (!block || !root.contains(block) || blocks.has(block)) continue
    const source = getSource?.(block) ?? null
    if (source !== null) blocks.set(block, source)
  }
  for (const [block, source] of blocks) {
    const pairs = pairRevealables(source, block)
    if (!pairs) continue
    for (const endpoint of endpoints) {
      if (!block.contains(endpoint)) continue
      const pair = touchedPair(pairs, block, endpoint)
      if (pair && !pair.activeSpan) activatePair(pair, source, selection)
    }
    // A range reveals every construct it intersects, not just the ones
    // its endpoints touch: the selection is edited as source.
    if (range && !range.collapsed) {
      for (const pair of pairs) {
        if (pair.activeSpan) continue
        if (intersects(pair.element, range)) activatePair(pair, source, selection)
      }
    }
  }
  // Activation swaps the DOM and moves the live selection into the new
  // spans, so the range captured above points at detached nodes. The
  // sweep must test the live selection or it deactivates instantly (and
  // the browser then collapses the stranded caret to the removal point).
  // A range also keeps every span it intersects (endpoints alone miss
  // middle constructs); collapsed carets use strict containment so
  // leaving by one position restores the render.
  const liveRange = selection && selection.rangeCount > 0 ? selection.getRangeAt(0) : null
  syncStructuralReveal(root, blocks, liveRange)
  const actives = [...root.querySelectorAll(ACTIVE_SELECTOR)] as HTMLElement[]
  for (const span of actives) {
    if (liveRange && (span.contains(liveRange.startContainer) || span.contains(liveRange.endContainer))) continue
    if (liveRange && !liveRange.collapsed && intersects(span, liveRange)) continue
    deactivateSpan(span, onFlush)
  }
}

// Differ support: map token starts to their verified active spans.
// Null when pairing fails (caller refuses the flush) or no actives.
//
// Paired actives always map, even when the span text lost its
// delimiters: the projection holds the base slice so the diff reads
// delimiter deletions as source deletions (un-formatting commits).
export function activeInlineMap(source: string, root: Element | null): RevealActives | null {
  if (!root) return new Map()
  const pairs = pairRevealables(source, root)
  if (!pairs) {
    return root.querySelector(ACTIVE_SELECTOR) ? null : new Map()
  }
  const map = new Map<number, { span: HTMLElement; token: RevealToken }>()
  for (const pair of pairs) {
    if (!pair.activeSpan) continue
    map.set(pair.token.start, { span: pair.activeSpan, token: pair.token })
  }
  return map
}
