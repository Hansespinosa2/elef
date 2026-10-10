/// <reference path="./types/markdown-it.d.ts" />
/// <reference path="./types/highlightjs-common.d.ts" />
import MarkdownIt from "markdown-it"
import hljs from "highlight.js/lib/common"
import katex from "katex"
import { buildEditorStructure, createDocumentLinkResolver, parseDocumentLinkAt } from "@elef/work-model"
import type {
  EditorMap,
  EditorStyle,
  LinkableDocument,
  MapBlock,
  MapDirective,
  MapRegion,
  MarginSettings,
  ParsedBlock,
  ResolvedDocument,
  SourcePosition,
  SourceRange
} from "@elef/work-model"

export interface MediaMapEntry {
  readonly src?: unknown
  readonly contentType?: unknown
}

export type MediaMap = Readonly<Record<string, MediaMapEntry>>

export type DocumentLinkResolver = (target: string) => ResolvedDocument | null

export interface RendererChrome {
  imageAttributes(): string
  mathAttributes(input: { source: string; open: string; close: string }): string
  mediaFigure(input: { rendered: string; alt: string }): string
  documentBlockAttributes(input: {
    valid: boolean
    mapped: MapBlock | null | undefined
    region: MapRegion | null | undefined
    positionClass: string
  }): string
  documentBlockShell(input: { attributes: string; rendered: string; positionControl: string }): string
  emptyDocumentBlock(input: { mapped: MapBlock }): string
  positionControl(input: { block: MapBlock }): string
  documentRoot(input: { style: EditorStyle; inner: string }): string
  presentationBlockAttributes(input: {
    valid: boolean
    mapped: MapBlock | null | undefined
    region: MapRegion | null | undefined
    label: string
  }): string
  presentationBlockControls(input: {
    slideIndex: number
    blockIndex: number
    blockCount: number
    position: SourcePosition | null
  }): string
  slideBlock(input: { className: string; attributes: string; content: string; controls: string }): string
  emptySlide(input: { index: number }): string
  slideToolbar(input: { index: number; slideCount: number }): string
  slideFrame(input: {
    index: number
    layout: string
    toolbar: string
    topMargin: string
    content: string
    bottomMargin: string
  }): string
  presentationRoot(input: { style: EditorStyle; inner: string }): string
}

export interface MarkdownBlockOptions {
  readonly mediaBaseUrl?: string
  readonly mediaMap?: MediaMap
  readonly allowRemoteMedia?: boolean
  readonly documentNodes?: readonly unknown[]
  readonly resolveDocumentLink?: DocumentLinkResolver
  readonly chrome?: RendererChrome
}

export interface PreviewStyleOverrides {
  readonly theme?: string
  readonly typography?: string
}

export interface RenderPreviewInput {
  readonly source?: string
  readonly kind?: string
  readonly title?: string
  readonly deckId?: string
  readonly mediaBaseUrl?: string
  readonly documentNodes?: readonly unknown[]
  readonly mediaMap?: MediaMap
  readonly allowRemoteMedia?: boolean
  readonly style?: PreviewStyleOverrides
  readonly marginSettings?: Partial<MarginSettings>
}

export interface RenderPreviewOutput {
  readonly html: string
  readonly warnings: string[]
  readonly editor_map: EditorMap
  readonly style: EditorStyle
}

// Client-flavored aliases (packages/client re-exports these names for card
// previews, which touch only html + style). Shapes mirror the seam the client
// declared while this package was untyped JS, so either resolution outcome
// compiles identically.
export interface ClientPreviewStyle {
  readonly theme: string
  readonly typography: string
}

export interface ClientPreviewOutput {
  readonly html: string
  readonly style: ClientPreviewStyle
}

export interface ClientPreviewInput {
  readonly source?: string
  readonly kind?: string
  readonly title?: string
  readonly deckId?: string
  readonly mediaBaseUrl?: string
  readonly documentNodes?: readonly unknown[]
  readonly allowRemoteMedia?: boolean
}

interface RenderEnv {
  mediaBaseUrl: string
  mediaMap: MediaMap
  allowRemoteMedia: boolean
  documentNodes: readonly unknown[]
  resolveDocumentLink: DocumentLinkResolver
  chrome: RendererChrome
}

interface ResolvedAsset {
  readonly src: string
  readonly contentType?: unknown
}

// One map slide joined with its parsed metadata, as renderPreviewCore builds
// it: map blocks stay in `blocks`, parsed blocks move to `parsed_blocks`.
interface RenderSlide {
  id: string
  index: number
  layout: string
  range: SourceRange
  source_range: SourceRange
  delimiter_range: SourceRange | null
  blocks: MapBlock[]
  directives: MapDirective[]
  editable_regions: MapRegion[]
  title: string | null
  regions: ParsedBlock[][]
  section: string | null
  subsection: string | null
  footnote: string | null
  warnings: string[]
  parsed_blocks: ParsedBlock[]
}

// Every markdown-it parse/render call below passes a complete RenderEnv, so
// rule callbacks narrow the untyped `env` back to it here.
function asRenderEnv(env: unknown): RenderEnv {
  return env as RenderEnv
}

const SAFE_LINK = /^(?:https?:|mailto:|tel:|#|\/|\.\.?\/|[^:]*$)/i

const markdown = new MarkdownIt({
  html: false,
  linkify: true,
  breaks: false,
  typographer: false,
  highlight(code, language) {
    if (language?.trim().toLowerCase() === "mermaid") {
      return `<pre class="mermaid">${MarkdownIt().utils.escapeHtml(code)}</pre>`
    }
    if (language && hljs.getLanguage(language)) {
      try {
        const highlighted = hljs.highlight(code, { language, ignoreIllegals: true }).value
        return `<pre><code class="highlight ${escapeAttribute(language)}">${highlighted}</code></pre>`
      } catch (_error) {
        // A lexer error should degrade to escaped code, not stop editing.
      }
    }
    return ""
  },
  validateLink(url) {
    const trimmed = url.trim()
    return /^(?:https?:|mailto:|tel:|elef-asset:)/i.test(trimmed) || (SAFE_LINK.test(trimmed) && !/^[a-z][a-z0-9+.-]*:/i.test(trimmed))
  }
})

markdown.block.ruler.before("fence", "elef_display_math", (state, startLine, endLine, silent) => {
  const opener = state.getLines(startLine, startLine + 1, state.blkIndent, false).trim()
  const openDelimiter = opener === "$$" ? "$$" : opener === "\\[" ? "\\[" : null
  if (!openDelimiter) return false
  const closeDelimiter = openDelimiter === "$$" ? "$$" : "\\]"
  for (let line = startLine + 1; line < endLine; line += 1) {
    const closer = state.getLines(line, line + 1, state.blkIndent, false).trim()
    if (closer !== closeDelimiter) continue
    if (silent) return true
    const env = asRenderEnv(state.env)
    const expression = state.getLines(startLine + 1, line, state.blkIndent, false)
    const token = state.push("html_block", "", 0)
    token.map = [startLine, line + 1]
    const startMark = state.eMarks[startLine]
    const endMark = state.bMarks[line]
    const sourceContent = startMark === undefined || endMark === undefined ? "" : state.src.slice(startMark, endMark)
    token.content = `<p>${renderMath(expression.trim(), true, openDelimiter, closeDelimiter, env.chrome, sourceContent)}</p>\n`
    state.line = line + 1
    return true
  }
  return false
})

markdown.inline.ruler.before("escape", "elef_bracket_math", (state, silent) => {
  const source = state.src
  const start = state.pos
  if (source[start] === "\\" && source[start + 1] === "$" && !isEscaped(source, start)) {
    if (silent) return true
    const token = state.push("text", "", 0)
    token.content = "\\$"
    state.pos += 2
    return true
  }
  if (source[start] !== "\\" || (source[start + 1] !== "(" && source[start + 1] !== "[")) return false
  if (isEscaped(source, start)) return false
  const open = source.slice(start, start + 2)
  const closeDelimiter = open === "\\(" ? "\\)" : "\\]"
  const close = findMathClose(source, start + 2, closeDelimiter)
  if (close < 0) return false
  const env = asRenderEnv(state.env)
  const expression = source.slice(start + 2, close)
  if (silent) return true
  const token = state.push("html_inline", "", 0)
  token.content = renderMath(expression, open === "\\[", open, closeDelimiter, env.chrome)
  state.pos = close + 2
  return true
})

markdown.inline.ruler.after("backticks", "elef_math", (state, silent) => {
  const source = state.src
  const start = state.pos
  const marker = source[start]
  if (marker !== "$" || isEscaped(source, start)) return false
  const display = source[start + 1] === "$"
  const delimiter = display ? "$$" : "$"
  if (!display && /\s/.test(source[start + 1] || "")) return false
  const close = findMathClose(source, start + delimiter.length, delimiter)
  if (close < 0) return false
  const env = asRenderEnv(state.env)
  const expression = source.slice(start + delimiter.length, close)
  if (!display && (!expression || /\s$/.test(expression))) return false
  if (silent) return true

  const token = state.push("html_inline", "", 0)
  token.content = renderMath(expression, display, delimiter, delimiter, env.chrome)
  state.pos = close + delimiter.length
  return true
})

markdown.inline.ruler.after("backticks", "elef_wiki_link", (state, silent) => {
  const start = state.pos
  const token = parseDocumentLinkAt(state.src, start)
  if (!token) return false
  const close = token.end - 2
  const raw = token.title.trim()
  const [targetText, displayText] = raw.split("|", 2)
  const target = (targetText || "").trim()
  if (!target || target.length > 200 || /[<>\u0000-\u001f]/.test(target)) return false
  if (silent) return true

  // collectMediaReferences parses with an empty env: link resolution is
  // optional there and every target stays unresolved, as in the retired JS.
  const resolveDocumentLink = (state.env as Partial<RenderEnv> | undefined)?.resolveDocumentLink
  const node = resolveDocumentLink?.(target) ?? null
  const nodeTitle = typeof node?.title === "string" ? node.title : ""
  const label = (displayText || nodeTitle || target).trim()
  if (!node) {
    const unresolved = state.push("html_inline", "", 0)
    unresolved.content = `<span class="document-link unresolved" aria-label="Unresolved document link">${escapeHtml(`[[${(displayText || target).trim()}]]`)}</span>`
    state.pos = close + 2
    return true
  }
  const href = String(node.href || `#deck/${encodeURIComponent(String(node.id))}`)
  const open = state.push("link_open", "a", 1)
  open.attrSet("href", href)
  open.attrSet("class", "document-link")
  if (typeof node.title === "string" && node.title) open.attrSet("data-document-link-title", node.title)
  if (typeof node.title === "string" && node.title) open.attrSet("aria-label", `Open document preview: ${node.title}`)
  const text = state.push("text", "", 0)
  text.content = label
  state.push("link_close", "a", -1)
  state.pos = close + 2
  return true
})

markdown.core.ruler.after("inline", "elef_strip_unsafe_link_text", (state) => {
  for (const token of state.tokens) {
    if (token.type !== "inline") continue
    for (const child of token.children || []) {
      if (child.type === "text") child.content = stripUnsafeMarkdownLinks(child.content)
    }
  }
})

markdown.renderer.rules.image = (tokens, index, _options, env) => {
  const token = tokens[index]
  if (!token) return ""
  const renderEnv = asRenderEnv(env)
  const source = token.attrGet("src") || ""
  const title = token.attrGet("title") || ""
  const fit = /^fit:(contain|cover)$/.exec(title)?.[1] || "contain"
  const alt = token.content || ""
  const resolved = resolveAssetSource(source, renderEnv)
  if (!resolved) return ""
  if (resolved.contentType === "video/mp4") {
    return `<video class="presentation-media presentation-media-${fit}" src="${escapeAttribute(resolved.src)}" controls playsinline preload="metadata" aria-label="${escapeAttribute(alt)}"></video>`
  }
  const titleAttribute = title && !/^fit:/.test(title) ? ` title="${escapeAttribute(title)}"` : ""
  const chrome = renderEnv.chrome
  return `<img class="presentation-media presentation-media-${fit}" src="${escapeAttribute(resolved.src)}" alt="${escapeAttribute(alt)}"${titleAttribute}${chrome.imageAttributes()}>`
}

markdown.renderer.rules.s_open = () => "<del>"
markdown.renderer.rules.s_close = () => "</del>"

export function collectMediaReferences(source = ""): string[] {
  if (typeof source !== "string") throw typedError("invalid_input", "Markdown source must be text.")
  const references: string[] = []
  for (const token of markdown.parse(source, {})) {
    for (const child of token.children || []) {
      if (child.type === "image") references.push(child.attrGet("src") || "")
    }
  }
  return [...new Set(references.filter(Boolean))]
}

export function renderMarkdownBlock(source = "", options: MarkdownBlockOptions = {}): string {
  if (typeof source !== "string") throw typedError("invalid_input", "Markdown source must be text.")
  if (source.length > 50 * 1024 * 1024) throw typedError("too_large", "This deck is too large to render.")
  const documentNodes = options.documentNodes || []
  return markdown.render(source, {
    mediaBaseUrl: options.mediaBaseUrl || "",
    mediaMap: options.mediaMap || {},
    allowRemoteMedia: options.allowRemoteMedia === true,
    documentNodes,
    resolveDocumentLink: options.resolveDocumentLink || createDocumentLinkResolver(documentNodes as readonly LinkableDocument[]),
    chrome: options.chrome ?? bareChrome
  })
}

export function renderPreviewCore({
  source = "",
  kind = "presentation",
  title = "Untitled",
  deckId = "",
  mediaBaseUrl = "",
  documentNodes = [],
  mediaMap = {},
  allowRemoteMedia = false,
  style: styleOverrides = {},
  marginSettings: marginOverrides = {}
}: RenderPreviewInput = {}, { chrome = bareChrome }: { chrome?: RendererChrome } = {}): RenderPreviewOutput {
  if (typeof source !== "string") throw typedError("invalid_input", "Markdown source must be text.")
  if (source.length > 50 * 1024 * 1024) throw typedError("too_large", "This deck is too large to preview.")
  const mode = kind === "document" ? "document" : "presentation"
  const sourceName = String(title || "Untitled")
  const structure = buildEditorStructure(source, { sourceName, mode })
  const map = structure.editorMap
  const slides: RenderSlide[] = structure.slides.map(({ map: slideMap, ...metadata }) => ({
    ...slideMap,
    ...metadata,
    parsed_blocks: metadata.blocks,
    blocks: slideMap.blocks,
    editable_regions: slideMap.editable_regions
  }))
  const { warnings } = structure
  const style: EditorStyle = {
    ...structure.style,
    ...(styleOverrides.theme ? { theme: styleOverrides.theme } : {}),
    ...(styleOverrides.typography ? { typography: styleOverrides.typography } : {})
  }
  const marginSettings: MarginSettings = { ...structure.marginSettings, ...marginOverrides }
  const env: RenderEnv = {
    mediaBaseUrl,
    mediaMap,
    allowRemoteMedia,
    documentNodes,
    resolveDocumentLink: createDocumentLinkResolver(documentNodes as readonly LinkableDocument[]),
    chrome
  }

  const html = mode === "document"
    ? renderDocument(source, slides[0], style, env, chrome)
    : renderPresentation(source, slides, style, marginSettings, env, chrome)
  return { html, warnings, editor_map: map, style }
}

function renderDocument(source: string, slide: RenderSlide | undefined, style: EditorStyle, env: RenderEnv, chrome: RendererChrome): string {
  if (!slide) return ""
  const mappedBlocks = slide.blocks.filter(block => !block.empty_placeholder)
  const emptyBlocks = slide.blocks.filter(block => block.empty_placeholder)
  const regions = new Map<string, MapRegion>(slide.editable_regions.map((region): [string, MapRegion] => [region.block_id, region]))
  const blocks: string[] = []
  let emptyIndex = 0
  const appendEmpty = (mapped: MapBlock): void => {
    const region = regions.get(mapped.id)
    if (!region?.editable) return
    blocks.push(chrome.emptyDocumentBlock({ mapped }))
  }
  for (const block of slide.parsed_blocks) {
    const mapped = mappedBlocks.shift()
    let empty = emptyBlocks[emptyIndex]
    while (empty && empty.range.start <= (mapped?.range.start ?? Number.POSITIVE_INFINITY)) {
      appendEmpty(empty)
      emptyIndex += 1
      empty = emptyBlocks[emptyIndex]
    }
    const region = mapped ? regions.get(mapped.id) : undefined
    const valid = mapped !== undefined && region !== undefined && region.editable && mapped.markdown === block.markdown && mapped.editable_region_id === region.id && region.block_id === mapped.id
    const positionClass = positionClasses(block.position)
    const attributes = chrome.documentBlockAttributes({ valid, mapped, region, positionClass })
    const structured = mapped !== undefined && valid && ["list", "quote"].includes(mapped.kind)
      ? editableStructuredSource(block.markdown, mapped.kind)
      : { source: block.markdown, caretToken: null }
    let rendered = region?.empty_heading ? "<h1><br></h1>" : renderMarkdownBlock(structured.source, env)
    if (mapped !== undefined && valid && structured.caretToken) {
      rendered = emptyStructuredLine(rendered, structured.caretToken, mapped.kind)
    }
    if (valid && mapped !== undefined && mapped.kind === "image") {
      const alt = /^\s*!\[([^\]]*)\]/.exec(block.markdown)?.[1] || ""
      rendered = chrome.mediaFigure({ rendered, alt })
    }
    const positionControl = mapped ? chrome.positionControl({ block: mapped }) : ""
    blocks.push(chrome.documentBlockShell({ attributes, rendered, positionControl }))
  }
  let tail = emptyBlocks[emptyIndex]
  while (tail) {
    appendEmpty(tail)
    emptyIndex += 1
    tail = emptyBlocks[emptyIndex]
  }
  return chrome.documentRoot({ style, inner: blocks.join("") })
}

function editableStructuredSource(markdown: string, kind: string): { source: string; caretToken: string | null } {
  const lines = markdown.split("\n")
  const lastLine = lines.at(-1) || ""
  const marker = kind === "list"
    ? /^[ \t]*(?:[-*+]|\d+[.)])[ \t]*$/.exec(lastLine)?.[0]
    : /^[ \t]*>[ \t]*$/.exec(lastLine)?.[0]
  if (!marker) return { source: markdown, caretToken: null }

  let caretToken = "ELEFCARETPLACEHOLDER"
  while (markdown.includes(caretToken)) caretToken += "_"
  const separator = /[ \t]$/.test(marker) ? "" : " "
  const formattedMarker = `${marker}${separator}`
  if (kind === "quote" && lines.length > 1) lines.splice(-1, 0, formattedMarker.trimEnd())
  lines[lines.length - 1] = `${formattedMarker}${caretToken}`
  return { source: lines.join("\n"), caretToken }
}

function emptyStructuredLine(rendered: string, caretToken: string, kind: string): string {
  const tokenIndex = rendered.lastIndexOf(caretToken)
  if (tokenIndex < 0) return rendered

  const listStart = kind === "list" ? rendered.lastIndexOf("<li", tokenIndex) : -1
  const quoteStart = kind === "quote"
    ? Math.max(rendered.lastIndexOf("<p", tokenIndex), rendered.lastIndexOf("<div", tokenIndex))
    : -1
  const startTag = kind === "list" ? listStart : quoteStart
  const tagEnd = rendered.indexOf(">", startTag)
  if (startTag < 0 || tagEnd < 0) return rendered.replace(caretToken, "<br>")

  const tagName = kind === "list" ? "li" : rendered.startsWith("<p", startTag) ? "p" : "div"
  const endTag = rendered.indexOf(`</${tagName}>`, tokenIndex)
  if (endTag < 0) return rendered.replace(caretToken, "<br>")

  return `${rendered.slice(0, tagEnd + 1)}<br>${rendered.slice(endTag)}`
}

function renderPresentation(source: string, slides: RenderSlide[], style: EditorStyle, margin: MarginSettings, env: RenderEnv, chrome: RendererChrome): string {
  const frames = slides.map((slide, index) => {
    const mappedBlocks = slide.blocks
    const regions = new Map<string, MapRegion>(slide.editable_regions.map((region): [string, MapRegion] => [region.block_id, region]))
    const blocks = slide.parsed_blocks
    const renderBlock = (block: ParsedBlock, blockIndex: number, title = false): string => {
      const mapped = mappedBlocks[blockIndex]
      const region = mapped ? regions.get(mapped.id) : undefined
      const valid = mapped !== undefined && region !== undefined && mapped.markdown === block.markdown && mapped.editable_region_id === region.id && region.block_id === mapped.id
      const className = [title ? "slide-title" : "", "slide-block", positionClasses(block.position)].filter(Boolean).join(" ")
      const label = title ? "Editable slide title" : "Editable slide block"
      const attributes = chrome.presentationBlockAttributes({ valid, mapped, region, label })
      const rendered = renderMarkdownBlock(block.markdown, env)
      const content = valid && mapped !== undefined && mapped.kind === "image"
        ? chrome.mediaFigure({ rendered, alt: /^\s*!\[([^\]]*)\]/.exec(block.markdown)?.[1] || "" })
        : rendered
      const controls = valid ? chrome.presentationBlockControls({ slideIndex: index, blockIndex, blockCount: blocks.length, position: block.position }) : ""
      return chrome.slideBlock({ className, attributes, content, controls })
    }
    const firstBlock = blocks[0]
    const titleMarkup = slide.title && firstBlock ? renderBlock(firstBlock, 0, true) : ""
    const contentBlocks = slide.title ? blocks.slice(1) : blocks
    const contentOffset = slide.title ? 1 : 0
    const slideContent = slide.title
      ? `<div class="slide-regions">${slide.regions.map(region => `<div class="slide-region">${region.map(block => renderBlock(block, blocks.indexOf(block))).join("")}</div>`).join("")}</div>`
      : contentBlocks.map((block, blockIndex) => renderBlock(block, blockIndex + contentOffset)).join("")
    const empty = blocks.length === 0 ? chrome.emptySlide({ index }) : ""
    const toolbar = chrome.slideToolbar({ index, slideCount: slides.length })
    const topMargin = margin.section || margin.subsection
      ? `<div class="slide-margin slide-margin-top" aria-hidden="true">${margin.subsection ? `<span class="slide-margin-subsection">${escapeHtml(slide.subsection || "")}</span>` : ""}${margin.section ? `<span class="slide-margin-section">${escapeHtml(slide.section || "")}</span>` : ""}</div>`
      : ""
    const bottomMargin = margin.slide_count || margin.footnote
      ? `<div class="slide-margin slide-margin-bottom" aria-hidden="true">${margin.slide_count ? `<span class="slide-margin-count">${index + 1} / ${slides.length}</span>` : ""}${margin.footnote && slide.footnote ? `<span class="slide-margin-footnote" aria-label="Footnote"><span class="slide-margin-footnote-marker">*</span><span class="slide-margin-footnote-text">${renderMarkdownBlock(slide.footnote, env)}</span></span>` : ""}</div>`
      : ""
    return chrome.slideFrame({ index, layout: slide.layout, toolbar, topMargin, content: `${titleMarkup}${slideContent}${empty}`, bottomMargin })
  }).join("")
  return chrome.presentationRoot({ style, inner: frames })
}

// Default chrome: plain structural wrappers with no editor controls, host
// framework hooks or editing affordances. Hosts compose richer chrome (see
// @elef/editor-runtime/editor-chrome) through the `chrome` option.
const bareChrome: RendererChrome = {
  imageAttributes: () => "",
  mathAttributes: () => "",
  mediaFigure: ({ rendered, alt }) => `<figure>${rendered}<figcaption>${escapeHtml(alt)}</figcaption></figure>`,
  documentBlockAttributes: ({ positionClass }) => `class="${["document-block", positionClass].filter(Boolean).join(" ")}"`,
  documentBlockShell: ({ attributes, rendered }) => `<div class="document-block"><div ${attributes}>${rendered}</div></div>`,
  emptyDocumentBlock: () => "",
  positionControl: () => "",
  documentRoot: ({ inner }) => `<div class="document">${inner}</div>`,
  presentationBlockAttributes: () => "",
  presentationBlockControls: () => "",
  slideBlock: ({ className, content }) => `<div class="${className}">${content}</div>`,
  emptySlide: () => "",
  slideToolbar: () => "",
  slideFrame: ({ layout, topMargin, content, bottomMargin }) => `<section class="slide slide-${layout}">${topMargin}${content}${bottomMargin}</section>`,
  presentationRoot: ({ inner }) => `<div class="presentation">${inner}</div>`
}

function positionClasses(position: SourcePosition | null | undefined): string {
  if (!position) return ""
  return [`position-${position.horizontal}`, `position-${position.vertical}`, position.vertical_explicit ? "position-vertical" : ""].filter(Boolean).join(" ")
}

function resolveAssetSource(source: string, env: RenderEnv): ResolvedAsset | null {
  const mapped = env.mediaMap[source]
  if (mapped && typeof mapped.src === "string") {
    return { src: mapped.src, contentType: mapped.contentType || "" }
  }
  const base = env.mediaBaseUrl
  const digest = /^elef-asset:([a-f0-9]{64})$/i.exec(source)
  if (digest) {
    const hash = digest[1]
    if (!hash) return null
    return base ? { src: `${base}/${hash.toLowerCase()}` } : null
  }
  if (source.startsWith("images/")) {
    if (source.includes("\\") || /[\u0000-\u001f\u007f]/.test(source)) return null
    const components = source.split("/")
    if (components[0] !== "images" || components.length < 2 || components.some((component) => !component || component === "." || component === "..")) return null
    return base
      ? { src: `${base}/path/${components.map(encodeURIComponent).join("/")}` }
      : env.allowRemoteMedia ? { src: source } : null
  }
  if (env.allowRemoteMedia && /^https?:\/\//i.test(source)) return { src: source }
  if (env.allowRemoteMedia && SAFE_LINK.test(source)) return { src: source }
  if (env.allowRemoteMedia && !base && SAFE_LINK.test(source) && !/^[a-z][a-z0-9+.-]*:/i.test(source)) return { src: source }
  return null
}

function renderMath(expression: string, display: boolean, openDelimiter: string, closeDelimiter: string, chrome: RendererChrome = bareChrome, sourceExpression: string = expression): string {
  let rendered: string
  try {
    rendered = katex.renderToString(expression, { displayMode: display, throwOnError: true, trust: false, strict: "ignore" })
  } catch (_error) {
    rendered = `<span class="math-error" title="Invalid TeX">${escapeHtml(expression)}</span>`
  }
  const attributes = chrome.mathAttributes({ source: sourceExpression, open: openDelimiter, close: closeDelimiter })
  return rendered.replace(/^<span\b/, (opening) => `${opening}${attributes}`)
}

function stripUnsafeMarkdownLinks(text: string): string {
  const pattern = /(!?)\[([^\]]*)\]\(\s*(?:<)?(?:javascript|data|vbscript):/ig
  let result = ""
  let cursor = 0
  let match: RegExpExecArray | null
  while ((match = pattern.exec(text))) {
    const fullMatch = match[0] ?? ""
    const openParen = text.indexOf("(", match.index + fullMatch.indexOf("]"))
    if (openParen < 0) continue
    let depth = 0
    let closeParen = -1
    for (let index = openParen; index < text.length; index += 1) {
      if (text[index] === "\\") { index += 1; continue }
      if (text[index] === "(") depth += 1
      if (text[index] === ")") {
        depth -= 1
        if (depth === 0) { closeParen = index; break }
      }
    }
    if (closeParen < 0) continue
    result += text.slice(cursor, match.index)
    result += match[1] ? "" : (match[2] ?? "")
    cursor = closeParen + 1
    pattern.lastIndex = cursor
  }
  return cursor === 0 ? text : result + text.slice(cursor)
}

function findMathClose(source: string, from: number, delimiter: string): number {
  let index = from
  while ((index = source.indexOf(delimiter, index)) >= 0) {
    if (!isEscaped(source, index) && (delimiter !== "$" || source[index + 1] !== "$" && source[index - 1] !== "$")) return index
    index += delimiter.length
  }
  return -1
}

function isEscaped(source: string, index: number): boolean {
  let slashes = 0
  for (let cursor = index - 1; cursor >= 0 && source[cursor] === "\\"; cursor -= 1) slashes += 1
  return slashes % 2 === 1
}

function escapeHtml(value: unknown): string {
  return String(value).replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;")
}

function escapeAttribute(value: unknown): string {
  return escapeHtml(value).replaceAll('"', "&quot;").replaceAll("'", "&#39;")
}

function typedError(code: string, message: string): Error & { code: string; retryable: boolean } {
  return Object.assign(new Error(message), { code, retryable: false })
}
