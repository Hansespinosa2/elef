import { StateEffect, StateField } from "@codemirror/state"
import type { EditorState, Range } from "@codemirror/state"
import { syntaxTree } from "@codemirror/language"
import { Decoration, EditorView, WidgetType } from "@codemirror/view"
import type { DecorationSet } from "@codemirror/view"
import { MERMAID_ERROR_CLASS, renderMermaidSvg } from "./mermaid_runtime.js"
import { scanMathSource } from "@elef/work-model/math-source"

export const livePreviewMode = StateEffect.define<boolean>()

// KaTeX (262K vendored ESM) stays out of the open path: math widgets render a
// TeX-source placeholder synchronously and swap in MathML once KaTeX
// arrives (same placeholder/swap shape as mermaid widgets below).
// Failures to LOAD retry on the next widget; failures to RENDER mark the
// widget exactly like today's synchronous error path.
type KatexApi = {
  renderToString: (tex: string, options?: Record<string, unknown>) => string
}

let katexPromise: Promise<KatexApi> | null = null

function loadKatex(): Promise<KatexApi> {
  katexPromise ??= (import("katex") as Promise<unknown>).then(
    (module) => {
      const holder = module as { default?: KatexApi }
      return holder.default ?? (module as KatexApi)
    },
    (error: unknown) => {
      katexPromise = null
      throw error
    }
  )
  return katexPromise
}

function idlePreloadKatex(): void {
  const idle = typeof requestIdleCallback === "function"
    ? (callback: () => void) => requestIdleCallback(() => callback(), { timeout: 5000 })
    : (callback: () => void) => setTimeout(callback, 500)
  idle(() => {
    loadKatex().catch(() => {
      // Retry on first actual math render; never fail the open path.
    })
  })
}

// Preload once the open settles (never during it: KaTeX eval on the main
// thread must not collide with pagination). The timeout covers hosts and
// modes without a document settle event. Browser-only: importing KaTeX in
// node test runs would only delay process exit.
if (typeof document !== "undefined") {
  document.addEventListener("elef:document-pages-settled", () => idlePreloadKatex(), { once: true })
  setTimeout(() => idlePreloadKatex(), 8000)
}

function renderLiveMath(element: HTMLElement, value: string, displayMode: boolean): void {
  loadKatex().then(
    (katex) => {
      if (!element.isConnected) return
      try {
        element.innerHTML = katex.renderToString(value, {
          displayMode,
          throwOnError: true,
          output: "mathml"
        })
      } catch (_error) {
        element.classList.add("math-error")
        element.textContent = value
      }
    },
    () => {
      if (!element.isConnected) return
      element.classList.add("math-error")
      element.textContent = value
    }
  )
}

class PreviewWidget extends WidgetType {
  kind: string;
  value: string;
  attributes: Record<string, string>;

  constructor(kind: string, value: string, attributes: Record<string, string> = {}) {
    super()
    this.kind = kind
    this.value = value
    this.attributes = attributes
  }

  eq(other: PreviewWidget) {
    return other.kind === this.kind && other.value === this.value && JSON.stringify(other.attributes) === JSON.stringify(this.attributes)
  }

  toDOM() {
    if (this.kind === "rule") {
      const rule = document.createElement("hr")
      rule.className = "cm-live-rule"
      return rule
    }

    if (this.kind === "image") {
      const image = document.createElement("img")
      image.className = "cm-live-image"
      image.alt = this.attributes.alt || ""
      const source = this.attributes.src || ""
      const assetDigest = source.match(/^elef-asset:([0-9a-f]{64})$/)?.[1]
      const mediaForm = document.querySelector<HTMLElement>("form[data-media-upload-url-value]")
      const assetBaseUrl = mediaForm?.dataset.mediaAssetBaseUrlValue
      const uploadUrl = mediaForm?.dataset.mediaUploadUrlValue
      if (assetDigest && assetBaseUrl) image.src = `${assetBaseUrl}/${assetDigest}`
      else if (assetDigest && uploadUrl) image.src = `${uploadUrl}/${assetDigest}`
      else if (assetBaseUrl && source.startsWith("images/")) {
        image.src = `${assetBaseUrl}/path/${source.split("/").map(encodeURIComponent).join("/")}`
      } else if (uploadUrl && !/^(?:[a-z][a-z0-9+.-]*:|\/|#)/i.test(source)) {
        // The supplied attachment endpoint can resolve original filenames;
        // do not resolve a relative path against the current edit URL.
        const filename = source.split("/").filter(Boolean).pop()
        if (filename && filename !== "." && filename !== "..") image.src = `${uploadUrl}/${encodeURIComponent(filename)}`
      } else image.src = source
      image.title = this.attributes.alt || ""
      return image
    }

    if (this.kind === "syntax") {
      const marker = document.createElement("span")
      marker.className = "cm-live-syntax-marker"
      marker.textContent = this.value
      marker.setAttribute("aria-hidden", "true")
      return marker
    }

    if (this.kind === "mermaid") {
      // Mermaid resolves asynchronously, so the placeholder renders
      // synchronously and the SVG is swapped in once it arrives.
      const diagram = document.createElement("div")
      diagram.className = "cm-live-widget cm-live-widget-mermaid"
      diagram.setAttribute("aria-label", this.value)
      renderMermaidSvg(this.value, diagram).then(
        (svg) => {
          if (diagram.isConnected) diagram.innerHTML = svg
        },
        () => {
          if (!diagram.isConnected) return
          diagram.classList.add(MERMAID_ERROR_CLASS)
          diagram.setAttribute("title", "Invalid Mermaid diagram")
          diagram.textContent = this.value
        }
      )
      return diagram
    }

    const element = document.createElement("span")
    element.className = `cm-live-widget cm-live-widget-${this.kind}${this.kind === "quote-marker" ? " cm-live-syntax-marker" : ""}`
    if (this.kind === "math" || this.kind === "math-display") {
      // Synchronous TeX placeholder; MathML swaps in once KaTeX arrives
      // (preloaded at idle after open, so no flash in practice).
      element.setAttribute("aria-label", this.value)
      element.textContent = this.value
      renderLiveMath(element, this.value, this.kind === "math-display")
      return element
    }
    element.textContent = this.value
    return element
  }

  ignoreEvent() {
    return false
  }
}

const replaceDecoration = (widget: WidgetType | null = null) => Decoration.replace({ ...(widget ? { widget } : {}), inclusive: false })
const markDecoration = (className: string) => Decoration.mark({ class: className })
const lineDecoration = (className: string) => Decoration.line({ class: className })

interface DynamicPreviewRange {
  readonly from: number
  readonly to: number
  readonly active: readonly Range<Decoration>[]
  readonly inactive: readonly Range<Decoration>[]
}

// Compile source-dependent decorations once. Caret movement only swaps the
// ranges whose reveal context changed; it never reparses Markdown or math.
class DecorationPlan {
  readonly ranges: Range<Decoration>[] = []
  readonly dynamic: DynamicPreviewRange[] = []
  push(...ranges: Range<Decoration>[]): void { this.ranges.push(...ranges) }
  conditional(state: EditorState, from: number, to: number,
    active: readonly Range<Decoration>[], inactive: readonly Range<Decoration>[]): void {
    this.dynamic.push({ from, to, active, inactive })
    this.push(...(activeRange(state, from, to) ? active : inactive))
  }
}

function activeRange(state: EditorState, from: number, to: number): boolean {
  return state.selection.ranges.some((range) => {
    const cursor = range.from === range.to
      ? range.from >= from && range.from <= to
      : range.from < to && range.to > from
    return cursor
  })
}

function safeUrl(url: string): boolean {
  return /^(?:https?:|mailto:|tel:|#|\/|\.\.?\/|[^:]*$)/i.test(url)
}

function addHidden(decorations: DecorationPlan, state: EditorState, from: number, to: number, widget: WidgetType | null = null, context: [number, number] | null = null): void {
  if (from >= to) return
  const [activeFrom = from, activeTo = to] = context || [from, to]
  decorations.conditional(state, activeFrom, activeTo,
    [markDecoration("cm-live-active-syntax").range(from, to)],
    [markDecoration("cm-live-syntax-marker").range(from, to),
      replaceDecoration(widget || new PreviewWidget("syntax", state.sliceDoc(from, to))).range(from, to)])
}

function addContextMark(decorations: DecorationPlan, state: EditorState, from: number, to: number, contextFrom: number, contextTo: number): void {
  if (from >= to) return
  decorations.conditional(state, contextFrom, contextTo,
    [markDecoration("cm-live-active-syntax").range(from, to)],
    [markDecoration("cm-live-syntax-marker").range(from, to)])
}

function addMark(decorations: DecorationPlan, state: EditorState, from: number, to: number, className: string): void {
  if (from >= to) return
  decorations.push(markDecoration(className).range(from, to))
}

function inlineRangesOutsideFences(source: string): Array<{ from: number; to: number }> {
  const ranges: Array<{ from: number; to: number }> = []
  let offset = 0
  let rangeStart = 0
  let fence: { marker: string; length: number } | null = null

  source.split("\n").forEach((line) => {
    const lineStart = offset
    const lineEnd = lineStart + line.length
    const match = line.match(/^(\s{0,3})(`{3,}|~{3,})(.*)$/)

    if (fence) {
      const closer = match?.[2] ?? ""
      const info = match?.[3] ?? ""
      if (match && fence.marker === closer[0] && closer.length >= fence.length && info.trim() === "") {
        fence = null
        rangeStart = lineEnd + (lineEnd < source.length ? 1 : 0)
      }
    } else if (match) {
      if (rangeStart < lineStart) ranges.push({ from: rangeStart, to: lineStart })
      fence = { marker: match[2]?.[0] ?? "", length: (match[2] ?? "").length }
    }

    offset = lineEnd + 1
  })

  if (rangeStart < source.length) ranges.push({ from: rangeStart, to: source.length })
  return ranges
}

function addInlineMarkup(decorations: DecorationPlan, state: EditorState, source: string, ranges: Array<{ from: number; to: number }>): void {
  for (const range of ranges) {
    const segment = source.slice(range.from, range.to)
    const absolute = (offset: number): number => range.from + offset
    const codeRanges: Array<[number, number]> = []
    const codePattern = /(`+)([^`\r\n]+?)\1/g

    for (const match of segment.matchAll(codePattern)) {
      const from = absolute(match.index ?? 0)
      const to = from + (match[0] ?? "").length
      const contentStart = from + (match[1] ?? "").length
      const contentEnd = contentStart + (match[2] ?? "").length
      codeRanges.push([from, to])
      addHidden(decorations, state, from, contentStart, null, [from, to])
      addHidden(decorations, state, contentEnd, to, null, [from, to])
      addMark(decorations, state, contentStart, contentEnd, "cm-live-inline-code")
    }

    const overlapsCode = (from: number, to: number): boolean => codeRanges.some(([codeFrom, codeTo]) => from < codeTo && to > codeFrom)

    // Images are widgets only when their destination is safe. Unknown or
    // malformed media stays as editable Markdown instead of disappearing.
    const imagePattern = /!\[([^\]]*)\]\(([^\s)]+)(?:\s+["']([^"']*)["'])?\)/g
    for (const match of segment.matchAll(imagePattern)) {
      const from = absolute(match.index ?? 0)
      const to = from + (match[0] ?? "").length
      if (!overlapsCode(from, to) && (safeUrl(match[2] ?? "") || /^elef-asset:[0-9a-f]{64}$/.test(match[2] ?? ""))) {
        addHidden(decorations, state, from, to, new PreviewWidget("image", "", { alt: match[1] ?? "", src: match[2] ?? "" }), [from, to])
      }
    }

    const linkPattern = /\[([^\]]+)\]\(([^\s)]+)(?:\s+["']([^"']*)["'])?\)/g
    for (const match of segment.matchAll(linkPattern)) {
      const from = absolute(match.index ?? 0)
      const labelStart = from + 1
      const labelEnd = labelStart + (match[1] ?? "").length
      const destinationEnd = from + match[0].length
      if (overlapsCode(from, destinationEnd) || !safeUrl(match[2] ?? "") || segment[(match.index ?? 0) - 1] === "!") continue
      addHidden(decorations, state, from, labelStart, null, [from, destinationEnd])
      addHidden(decorations, state, labelEnd, destinationEnd, null, [from, destinationEnd])
      addMark(decorations, state, labelStart, labelEnd, "cm-live-link")
    }

    const documentLinkPattern = /\[\[([^\]\r\n]+)\]\]/g
    for (const match of segment.matchAll(documentLinkPattern)) {
      const from = absolute(match.index ?? 0)
      const labelStart = from + 2
      const labelEnd = labelStart + (match[1] ?? "").length
      const to = from + (match[0] ?? "").length
      if (overlapsCode(from, to)) continue
      addHidden(decorations, state, from, labelStart, null, [from, to])
      addHidden(decorations, state, labelEnd, to, null, [from, to])
      addMark(decorations, state, labelStart, labelEnd, "cm-live-document-link")
    }

    for (const match of scanMathSource(segment)) {
      const from = absolute(match.start)
      const to = absolute(match.end)
      if (overlapsCode(from, to)) continue
      const widget = new PreviewWidget(match.display ? "math-display" : "math", match.interior.trim())
      addHidden(decorations, state, from, to, widget, [from, to])
    }

    const strongPattern = /(\*\*|__)(?=\S)(.+?)(?<=\S)\1/g
    for (const match of segment.matchAll(strongPattern)) {
      const from = absolute(match.index ?? 0)
      const to = from + (match[0] ?? "").length
      if (overlapsCode(from, to)) continue
      const contentStart = from + (match[1] ?? "").length
      const contentEnd = contentStart + (match[2] ?? "").length
      addHidden(decorations, state, from, contentStart, null, [from, to])
      addHidden(decorations, state, contentEnd, to, null, [from, to])
      addMark(decorations, state, contentStart, contentEnd, "cm-live-strong")
    }

    const emphasisPattern = /(?<!\*)\*(?!\s)(.+?)(?<!\s)\*(?!\*)|(?<!_)_(?!\s)(.+?)(?<!\s)_(?!_)/g
    for (const match of segment.matchAll(emphasisPattern)) {
      const from = absolute(match.index ?? 0)
      const to = from + (match[0] ?? "").length
      if (overlapsCode(from, to)) continue
      const text = match[1] || match[2] || ""
      const contentStart = from + 1
      const contentEnd = contentStart + text.length
      addHidden(decorations, state, from, contentStart, null, [from, to])
      addHidden(decorations, state, contentEnd, to, null, [from, to])
      addMark(decorations, state, contentStart, contentEnd, "cm-live-emphasis")
    }
  }
}

function fenceLanguage(info: string): string {
  return (info.trim().split(/[\s{]/)[0] ?? "").toLowerCase()
}

function fencedDiagramSource(fencedSource: string): string {
  return fencedSource.split("\n").slice(1, -1).join("\n")
}

function addMermaidFence(decorations: DecorationPlan, state: EditorState, from: number, to: number, fencedSource: string): void {
  const diagramSource = fencedDiagramSource(fencedSource)
  if (from >= to || !diagramSource.trim()) return
  decorations.conditional(state, from, to,
    [markDecoration("cm-live-active-syntax").range(from, to)],
    [markDecoration("cm-live-syntax-marker").range(from, to),
      Decoration.replace({ widget: new PreviewWidget("mermaid", diagramSource), block: true }).range(from, to)])
}

function addBlockMarkup(decorations: DecorationPlan, state: EditorState, source: string): void {
  const lines = source.split("\n")
  let offset = 0
  let fence: { marker: string; length: number; start: number; language: string } | null = null

  lines.forEach((line, index) => {
    const lineStart = offset
    const lineEnd = lineStart + line.length
    const fenceMatch = line.match(/^(\s{0,3})(`{3,}|~{3,})(.*)$/)
    if (fenceMatch) {
      if (!fence) {
        fence = {
          marker: fenceMatch[2]?.[0] ?? "",
          length: (fenceMatch[2] ?? "").length,
          start: lineStart,
          language: fenceLanguage(fenceMatch[3] ?? "")
        }
        // A Mermaid fence becomes a single diagram widget once its closing
        // fence arrives, so nothing inside it is decorated line by line.
        if (fence.language === "mermaid") {
          offset = lineEnd + 1
          return
        }
        addHidden(
          decorations,
          state,
          lineStart + (fenceMatch[1] ?? "").length,
          lineStart + (fenceMatch[1] ?? "").length + (fenceMatch[2] ?? "").length,
          null,
          [lineStart, lineEnd]
        )
        if ((fenceMatch[3] ?? "").trim()) addHidden(decorations, state, lineStart + line.length - (fenceMatch[3] ?? "").length, lineEnd, null, [lineStart, lineEnd])
        decorations.push(lineDecoration("cm-live-code-fence").range(lineStart))
      } else if (fence.marker === fenceMatch[2]?.[0] && (fenceMatch[2] ?? "").length >= fence.length && (fenceMatch[3] ?? "").trim() === "") {
        if (fence.language === "mermaid") {
          addMermaidFence(decorations, state, fence.start, lineEnd, source.slice(fence.start, lineEnd))
          fence = null
          offset = lineEnd + 1
          return
        }
        addHidden(decorations, state, lineStart + (fenceMatch[1] ?? "").length, lineStart + line.length, null, [lineStart, lineEnd])
        decorations.push(lineDecoration("cm-live-code-fence").range(lineStart))
        fence = null
      }
      offset = lineEnd + 1
      return
    }

    if (fence) {
      if (fence.language !== "mermaid") decorations.push(lineDecoration("cm-live-code-line").range(lineStart))
      offset = lineEnd + 1
      return
    }

    const heading = line.match(/^(\s{0,3})(#{1,6})(\s+)(.*)$/)
    if (heading) {
      const markerStart = lineStart + (heading[1] ?? "").length
      addContextMark(decorations, state, markerStart, markerStart + (heading[2] ?? "").length, lineStart, lineEnd)
      addHidden(decorations, state, markerStart, markerStart + (heading[2] ?? "").length + (heading[3] ?? "").length, null, [lineStart, lineEnd])
      const headingTextStart = markerStart + (heading[2] ?? "").length + (heading[3] ?? "").length
      decorations.push(lineDecoration(`cm-live-heading cm-live-heading-${(heading[2] ?? "").length}`).range(lineStart))
      addMark(decorations, state, headingTextStart, lineEnd, `cm-live-heading-text cm-live-heading-text-${(heading[2] ?? "").length}`)
      offset = lineEnd + 1
      return
    }

    const list = line.match(/^(\s*)([-+*]|\d+[.)])(\s+)/)
    if (list) {
      const markerStart = lineStart + (list[1] ?? "").length
      addHidden(
        decorations,
        state,
        markerStart,
        markerStart + (list[2] ?? "").length + (list[3] ?? "").length,
        new PreviewWidget("list-marker", (list[2] ?? "").match(/\d/) ? "1." : "•"),
        [lineStart, lineEnd]
      )
      decorations.push(lineDecoration("cm-live-list-item").range(lineStart))
    }

    const quote = line.match(/^(\s*>\s?)/)
    if (quote) {
      const markerStart = lineStart + (quote[1] ?? "").indexOf(">")
      addContextMark(decorations, state, markerStart, markerStart + 1, lineStart, lineEnd)
      addHidden(decorations, state, markerStart, markerStart + 1, new PreviewWidget("quote-marker", ">"), [lineStart, lineEnd])
      decorations.push(lineDecoration("cm-live-quote").range(lineStart))
    }

    if (line.match(/^\s{0,3}([-*_])(?:\s*\1){2,}\s*$/)) {
      addHidden(decorations, state, lineStart, lineEnd, new PreviewWidget("rule", ""), [lineStart, lineEnd])
    }

    if (index < lines.length - 1) offset = lineEnd + 1
  })
}

// Invisible-directive line shapes, mirrored from the work-model owners
// (document_map align/step parsing, art_source). Only these conceal when
// inactive; unknown or malformed ::: lines stay visible so broken syntax is
// never hidden from its author.
function invisibleDirectiveLine(line: string): boolean {
  if (/^:::art[ \t]*$/.test(line)) return true
  if (/^ {0,3}:::step(?:\{[0-9]+\})?[ \t]*$/.test(line)) return true
  if (/^ {0,3}:::(align|position)[ \t]*\{[^}]*\}[ \t]*$/.test(line)) return true
  return /^ {0,3}:::[ \t]*$/.test(line)
}

function addSyntaxTreeHints(decorations: DecorationPlan, state: EditorState): void {
  // The Markdown parser is the authority for fenced regions and inline node
  // boundaries. Regex projections above are intentionally conservative; this
  // traversal adds the same styling to parser-recognized nodes without
  // hiding unknown syntax.
  const tree = syntaxTree(state)
  tree.iterate({
    enter(node) {
      if (node.name === "Blockquote") {
        decorations.push(lineDecoration("cm-live-quote").range(node.from))
      } else if (node.name === "ElefMetadata") {
        if (!invisibleDirectiveLine(state.sliceDoc(node.from, node.to))) {
          addContextMark(decorations, state, node.from, node.to, node.from, node.to)
          return
        }
        // Invisible directives occupy no reader output, so inactive lines
        // collapse entirely (including their line break); entering the line
        // reveals the source in place.
        let to = node.to
        const breakAfter = state.sliceDoc(to, to + 2)
        if (breakAfter.startsWith("\r\n")) to += 2
        else if (breakAfter.startsWith("\n")) to += 1
        decorations.conditional(state, node.from, to,
          [markDecoration("cm-live-active-syntax").range(node.from, node.to)],
          [Decoration.replace({}).range(node.from, to)])
      }
    }
  })
}

function buildDecorations(state: EditorState, enabled: boolean): Omit<LivePreviewValue, "enabled"> {
  if (!enabled) return { decorations: Decoration.none, atomic: Decoration.none, error: null, dynamic: [] }

  try {
    const source = state.doc.toString()
    const decorations = new DecorationPlan()
    addBlockMarkup(decorations, state, source)
    addInlineMarkup(decorations, state, source, inlineRangesOutsideFences(source))
    addSyntaxTreeHints(decorations, state)
    const set = Decoration.set(decorations.ranges, true)
    const atomic = Decoration.set(decorations.ranges.filter((range) => range.value.spec.widget), true)
    return { decorations: set, atomic, error: null, dynamic: decorations.dynamic }
  } catch (error) {
    return {
      decorations: Decoration.none,
      atomic: Decoration.none,
      dynamic: [],
      error: error instanceof Error ? error.message : String(error)
    }
  }
}

export interface LivePreviewValue {
  readonly dynamic: readonly DynamicPreviewRange[];
  enabled: boolean;
  decorations: DecorationSet;
  atomic: DecorationSet;
  error: string | null;
}

export const livePreviewField = StateField.define<LivePreviewValue>({
  create(state) {
    return { enabled: true, ...buildDecorations(state, true) }
  },
  update(value, transaction) {
    let enabled = value.enabled
    for (const effect of transaction.effects) {
      if (effect.is(livePreviewMode)) enabled = Boolean(effect.value)
    }
    if (transaction.docChanged || enabled !== value.enabled) {
      return { enabled, ...buildDecorations(transaction.state, enabled) }
    }
    if (!transaction.selection || !enabled) return value
    const removed = new Set<Decoration>()
    const added: Range<Decoration>[] = []
    for (const context of value.dynamic) {
      const before = activeRange(transaction.startState, context.from, context.to)
      const after = activeRange(transaction.state, context.from, context.to)
      if (before === after) continue
      for (const range of before ? context.active : context.inactive) removed.add(range.value)
      added.push(...(after ? context.active : context.inactive))
    }
    if (removed.size === 0 && added.length === 0) return value
    return { ...value,
      decorations: value.decorations.update({ filter: (_from, _to, decoration) => !removed.has(decoration), add: added, sort: true }),
      atomic: value.atomic.update({ filter: (_from, _to, decoration) => !removed.has(decoration),
        add: added.filter(range => range.value.spec.widget), sort: true }),
    }
  },
  provide: (field) => [
    EditorView.decorations.from(field, (value) => value.decorations),
    EditorView.atomicRanges.of((view) => view.state.field(field).atomic)
  ]
})
