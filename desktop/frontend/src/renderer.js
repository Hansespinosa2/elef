import MarkdownIt from "markdown-it"
import hljs from "highlight.js/lib/common"
import katex from "katex"
import { buildEditorStructure } from "./document-map.js"

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
    const expression = state.getLines(startLine + 1, line, state.blkIndent, false)
    const token = state.push("html_block", "", 0)
    token.map = [startLine, line + 1]
    const sourceContent = state.src.slice(state.eMarks[startLine], state.bMarks[line])
    token.content = `<p>${renderMath(expression.trim(), true, openDelimiter, closeDelimiter, sourceContent)}</p>\n`
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
  const expression = source.slice(start + 2, close)
  if (silent) return true
  const token = state.push("html_inline", "", 0)
  token.content = renderMath(expression, open === "\\[", open, closeDelimiter)
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
  const expression = source.slice(start + delimiter.length, close)
  if (!display && (!expression || /\s$/.test(expression))) return false
  if (silent) return true

  const token = state.push("html_inline", "", 0)
  token.content = renderMath(expression, display, delimiter, delimiter)
  state.pos = close + delimiter.length
  return true
})

markdown.inline.ruler.after("backticks", "elef_wiki_link", (state, silent) => {
  const start = state.pos
  if (!state.src.startsWith("[[", start) || state.src.startsWith("[[[", start)) return false
  const close = state.src.indexOf("]]", start + 2)
  if (close < 0 || state.src.slice(start + 2, close).includes("\n")) return false
  const raw = state.src.slice(start + 2, close).trim()
  const [targetText, displayText] = raw.split("|", 2)
  const target = targetText.trim()
  if (!target || target.length > 200 || /[<>\u0000-\u001f]/.test(target)) return false
  if (silent) return true

  const node = (state.env?.documentNodes || []).find((entry) => entry.title === target || entry.id === target)
  const href = node ? `#deck/${encodeURIComponent(node.id)}` : "#"
  const open = state.push("link_open", "a", 1)
  open.attrSet("href", href)
  open.attrSet("class", node ? "document-link" : "document-link is-missing")
  const text = state.push("text", "", 0)
  text.content = (displayText || target).trim()
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
  const source = token.attrGet("src") || ""
  const title = token.attrGet("title") || ""
  const fit = /^fit:(contain|cover)$/.exec(title)?.[1] || "contain"
  const alt = token.content || ""
  const resolved = resolveAssetSource(source, env)
  if (!resolved) return ""
  if (resolved.contentType === "video/mp4") {
    return `<video class="presentation-media presentation-media-${fit}" src="${escapeAttribute(resolved.src)}" controls playsinline preload="metadata" aria-label="${escapeAttribute(alt)}"></video>`
  }
  const titleAttribute = title && !/^fit:/.test(title) ? ` title="${escapeAttribute(title)}"` : ""
  return `<img class="presentation-media presentation-media-${fit}" src="${escapeAttribute(resolved.src)}" alt="${escapeAttribute(alt)}"${titleAttribute} data-editor-image-source="true" contenteditable="false">`
}

markdown.renderer.rules.s_open = () => "<del>"
markdown.renderer.rules.s_close = () => "</del>"

export function collectMediaReferences(source = "") {
  if (typeof source !== "string") throw typedError("invalid_input", "Markdown source must be text.")
  const references = []
  for (const token of markdown.parse(source, {})) {
    for (const child of token.children || []) {
      if (child.type === "image") references.push(child.attrGet("src") || "")
    }
  }
  return [...new Set(references.filter(Boolean))]
}

export function renderMarkdownBlock(source = "", options = {}) {
  if (typeof source !== "string") throw typedError("invalid_input", "Markdown source must be text.")
  if (source.length > 50 * 1024 * 1024) throw typedError("too_large", "This deck is too large to render.")
  return markdown.render(source, {
    mediaBaseUrl: options.mediaBaseUrl || "",
    mediaMap: options.mediaMap || {},
    allowRemoteMedia: options.allowRemoteMedia === true,
    documentNodes: options.documentNodes || []
  })
}

export function renderPreview({
  source = "",
  kind = "presentation",
  title = "Untitled",
  deckId = "",
  mediaBaseUrl = "",
  documentNodes = []
} = {}) {
  if (typeof source !== "string") throw typedError("invalid_input", "Markdown source must be text.")
  if (source.length > 50 * 1024 * 1024) throw typedError("too_large", "This deck is too large to preview.")
  const mode = kind === "document" ? "document" : "presentation"
  const sourceName = String(title || "Untitled")
  const structure = buildEditorStructure(source, { sourceName, mode })
  const map = structure.editorMap
  const slides = structure.slides.map(({ map: slideMap, ...metadata }) => ({
    ...slideMap,
    ...metadata,
    parsed_blocks: metadata.blocks,
    blocks: slideMap.blocks,
    editable_regions: slideMap.editable_regions
  }))
  const { style, warnings, marginSettings } = structure
  const mediaUrl = mediaBaseUrl || `elefasset://localhost/${encodeURIComponent(deckId)}`
  const env = { mediaBaseUrl: mediaUrl, documentNodes }

  const html = mode === "document"
    ? renderDocument(source, slides[0], style, env)
    : renderPresentation(source, slides, style, marginSettings, env)
  return { html, warnings, editor_map: map, style }
}

function renderDocument(source, slide, style, env) {
  if (!slide) return ""
  const mappedBlocks = slide.blocks.filter(block => !block.empty_placeholder)
  const emptyBlocks = slide.blocks.filter(block => block.empty_placeholder)
  const regions = new Map(slide.editable_regions.map(region => [region.block_id, region]))
  const blocks = []
  let emptyIndex = 0
  const appendEmpty = mapped => {
    const region = regions.get(mapped.id)
    if (!region?.editable) return
    blocks.push(`<div class="document-editor-block-shell"><div class="document-editor-block" data-editor-region-id="${mapped.editable_region_id}" data-editor-block-id="${mapped.id}" data-editor-empty-block="true" contenteditable="true" role="textbox" aria-label="Editable Markdown block" aria-multiline="true" spellcheck="true" data-action="input-&gt;visual-editor#projectionInput focus-&gt;visual-editor#blockFocus blur-&gt;visual-editor#blockBlur"><p><br></p></div></div>`)
  }
  for (const block of slide.parsed_blocks) {
    const mapped = mappedBlocks.shift()
    while (emptyBlocks[emptyIndex] && emptyBlocks[emptyIndex].range.start <= (mapped?.range.start ?? Number.POSITIVE_INFINITY)) {
      appendEmpty(emptyBlocks[emptyIndex])
      emptyIndex += 1
    }
    const region = mapped && regions.get(mapped.id)
    const valid = Boolean(mapped && region?.editable && mapped.markdown === block.markdown && mapped.editable_region_id === region.id && region.block_id === mapped.id)
    const classes = ["document-editor-block", positionClasses(block.position)].filter(Boolean).join(" ")
    const attributes = valid
      ? `class="${classes}" data-editor-region-id="${mapped.editable_region_id}" data-editor-block-id="${mapped.id}" contenteditable="true" role="textbox" aria-label="Editable Markdown block" aria-multiline="true" spellcheck="true" data-action="input-&gt;visual-editor#projectionInput focus-&gt;visual-editor#blockFocus blur-&gt;visual-editor#blockBlur"`
      : `class="${classes}" contenteditable="false" aria-readonly="true"`
    let rendered = region?.empty_heading ? "<h1><br></h1>" : renderMarkdownBlock(block.markdown, env)
    if (valid && mapped.kind === "image") {
      const alt = /^\s*!\[([^\]]*)\]/.exec(block.markdown)?.[1] || ""
      rendered = `<figure class="editor-media">${rendered}<figcaption class="editor-media-caption" aria-label="Editable image alt text" title="Edit image alt text">${escapeHtml(alt)}</figcaption></figure>`
    }
    const positionControl = mapped ? renderPositionControl(mapped, "visual-editor") : ""
    blocks.push(`<div class="document-editor-block-shell"><div ${attributes}>${rendered}</div>${positionControl}</div>`)
  }
  while (emptyBlocks[emptyIndex]) {
    appendEmpty(emptyBlocks[emptyIndex])
    emptyIndex += 1
  }
  return `<div class="document-reader document-theme-${style.theme} document-typography-${style.typography} work-theme-${style.theme} work-typography-${style.typography} document-editor-projection" data-controller="document-pages mermaid-diagrams"><div class="document-surface" data-document-pages-target="surface">${blocks}</div></div>`
}

function renderPresentation(source, slides, style, margin, env) {
  const frames = slides.map((slide, index) => {
    const mappedBlocks = slide.blocks
    const regions = new Map(slide.editable_regions.map(region => [region.block_id, region]))
    const blocks = slide.parsed_blocks
    const renderBlock = (block, blockIndex, title = false) => {
      const mapped = mappedBlocks[blockIndex]
      const region = mapped && regions.get(mapped.id)
      const valid = Boolean(mapped && region && mapped.markdown === block.markdown && mapped.editable_region_id === region.id && region.block_id === mapped.id)
      const className = [title ? "slide-title" : "", "slide-block", positionClasses(block.position)].filter(Boolean).join(" ")
      const label = title ? "Editable slide title" : "Editable slide block"
      const attributes = valid
        ? `data-editor-block-id="${mapped.id}" data-editor-region-id="${region.id}" data-editor-source-editable="${region.editable}"${region.editable ? ` contenteditable="true" role="textbox" aria-label="${label}" aria-multiline="true" spellcheck="true" data-action="input-&gt;presentation-editor#blockInput focus-&gt;presentation-editor#blockFocus blur-&gt;presentation-editor#blockBlur"` : " contenteditable=\"false\" aria-readonly=\"true\""}`
        : "contenteditable=\"false\" aria-readonly=\"true\""
      const content = renderMarkdownBlock(block.markdown, env)
      const controls = valid ? renderPresentationBlockControls(index, blockIndex, blocks.length, block.position) : ""
      return `<div class="${className}" ${attributes}>${content}</div>${controls}`
    }
    const titleMarkup = slide.title ? renderBlock(blocks[0], 0, true) : ""
    const contentBlocks = slide.title ? blocks.slice(1) : blocks
    const contentOffset = slide.title ? 1 : 0
    const slideContent = slide.title
      ? `<div class="slide-regions">${slide.regions.map(region => `<div class="slide-region">${region.map(block => renderBlock(block, blocks.indexOf(block))).join("")}</div>`).join("")}</div>`
      : contentBlocks.map((block, blockIndex) => renderBlock(block, blockIndex + contentOffset)).join("")
    const empty = blocks.length === 0
      ? `<div class="empty-slide"><p>Empty slide</p><button type="button" class="button secondary empty-slide-add-image" data-action="click-&gt;media#chooseForSlide" data-slide-index="${index}">Add image</button></div>`
      : ""
    const toolbar = `<div class="presentation-editor-slide-toolbar" aria-label="Slide ${index + 1} controls"><span class="presentation-editor-slide-label">Slide ${index + 1}</span><button type="button" data-presentation-editor-action="add-slide-after" data-slide-index="${index}">Add slide</button><button type="button" class="presentation-editor-add-image" data-action="click-&gt;media#chooseForSlide" data-slide-index="${index}">Add image</button><button type="button" data-presentation-editor-action="delete-slide" data-slide-index="${index}"${slides.length === 1 ? " disabled" : ""}>Delete</button><button type="button" data-presentation-editor-action="move-slide-up" data-slide-index="${index}"${index === 0 ? " disabled" : ""}>Move up</button><button type="button" data-presentation-editor-action="move-slide-down" data-slide-index="${index}"${index === slides.length - 1 ? " disabled" : ""}>Move down</button></div>`
    const topMargin = margin.section || margin.subsection
      ? `<div class="slide-margin slide-margin-top" aria-hidden="true">${margin.subsection ? `<span class="slide-margin-subsection">${escapeHtml(slide.subsection || "")}</span>` : ""}${margin.section ? `<span class="slide-margin-section">${escapeHtml(slide.section || "")}</span>` : ""}</div>`
      : ""
    const bottomMargin = margin.slide_count || margin.footnote
      ? `<div class="slide-margin slide-margin-bottom" aria-hidden="true">${margin.slide_count ? `<span class="slide-margin-count">${index + 1} / ${slides.length}</span>` : ""}${margin.footnote && slide.footnote ? `<span class="slide-margin-footnote" aria-label="Footnote"><span class="slide-margin-footnote-marker">*</span><span class="slide-margin-footnote-text">${renderMarkdownBlock(slide.footnote, env)}</span></span>` : ""}</div>`
      : ""
    return `<div class="slide-frame" data-controller="presentation-canvas"><section class="slide slide-${slide.layout}" data-presentation-canvas-target="canvas" aria-label="Slide ${index + 1}" data-editor-slide-id="slide-${index + 1}" data-slide-index="${index}">${toolbar}${topMargin}<div class="slide-content">${titleMarkup}${slideContent}${empty}</div>${bottomMargin}</section></div>`
  }).join("")
  return `<div class="presentation-surface work-surface slides slides-theme-${style.theme} slides-typography-${style.typography} work-theme-${style.theme} work-typography-${style.typography} presentation-editor-projection" data-controller="mermaid-diagrams">${frames}</div>`
}

function renderPresentationBlockControls(slideIndex, blockIndex, blockCount, position) {
  const alignment = position ? (position.vertical === "top" ? position.horizontal : `${position.vertical === "middle" ? "center" : position.vertical} ${position.horizontal}`) : "left"
  const options = ["top", "middle", "bottom"].flatMap(vertical => ["left", "center", "right"].map(horizontal => {
    const value = vertical === "top" ? horizontal : `${vertical === "middle" ? "center" : vertical} ${horizontal}`
    return `<option value="${value}"${value === alignment ? " selected" : ""}>${value.split(" ").map(part => part[0].toUpperCase() + part.slice(1)).join(" ")}</option>`
  })).join("")
  return `<div class="presentation-editor-block-controls" aria-label="Block controls"><button type="button" data-presentation-editor-action="add-block-after" data-slide-index="${slideIndex}" data-block-index="${blockIndex}">Add block</button><button type="button" data-presentation-editor-action="delete-block" data-slide-index="${slideIndex}" data-block-index="${blockIndex}"${blockCount === 1 ? " disabled" : ""}>Delete</button><button type="button" aria-label="Move block up" data-presentation-editor-action="move-block-up" data-slide-index="${slideIndex}" data-block-index="${blockIndex}"${blockIndex === 0 ? " disabled" : ""}>↑</button><button type="button" aria-label="Move block down" data-presentation-editor-action="move-block-down" data-slide-index="${slideIndex}" data-block-index="${blockIndex}"${blockIndex === blockCount - 1 ? " disabled" : ""}>↓</button><label>Align <select aria-label="Block alignment" data-presentation-editor-align data-slide-index="${slideIndex}" data-block-index="${blockIndex}" data-action="change-&gt;presentation-editor#alignmentChanged">${options}</select></label></div>`
}

function renderPositionControl(block, controller) {
  const horizontal = block.position?.horizontal || "left"
  const options = ["left", "center", "right"].map(value => `<option value="${value}"${value === horizontal ? " selected" : ""}>${value[0].toUpperCase()}${value.slice(1)}</option>`).join("")
  return `<label class="document-block-position-control" data-action="pointerdown-&gt;visual-editor#positionControlOpened">Align <select aria-label="Block alignment" data-visual-editor-block-id="${block.id}" data-action="focus-&gt;${controller}#positionControlOpened keydown-&gt;${controller}#positionControlKeydown change-&gt;${controller}#alignmentChanged">${options}</select></label>`
}

function positionClasses(position) {
  if (!position) return ""
  return [`position-${position.horizontal}`, `position-${position.vertical}`, position.vertical_explicit ? "position-vertical" : ""].filter(Boolean).join(" ")
}

function resolveAssetSource(source, env = {}) {
  const mapped = env.mediaMap?.[source]
  if (mapped && typeof mapped.src === "string") {
    return { src: mapped.src, contentType: mapped.contentType || "" }
  }
  const base = env.mediaBaseUrl
  const digest = /^elef-asset:([a-f0-9]{64})$/i.exec(source)
  if (digest) return base ? { src: `${base}/${digest[1].toLowerCase()}` } : null
  if (source.startsWith("images/")) {
    if (source.includes("\\") || /[\u0000-\u001f\u007f]/.test(source)) return null
    const components = source.split("/")
    if (components[0] !== "images" || components.length < 2 || components.some((component) => !component || component === "." || component === "..")) return null
    return base
      ? { src: `${base}/path/${components.map(encodeURIComponent).join("/")}` }
      : env.allowRemoteMedia ? { src: source } : null
  }
  if (env.allowRemoteMedia && /^https?:\/\//i.test(source)) return { src: source }
  if (!base && SAFE_LINK.test(source) && !/^[a-z][a-z0-9+.-]*:/i.test(source)) return { src: source }
  return null
}

function renderMath(expression, display, openDelimiter, closeDelimiter, sourceExpression = expression) {
  let rendered
  try {
    rendered = katex.renderToString(expression, { displayMode: display, throwOnError: true, trust: false, strict: "ignore" })
  } catch (_error) {
    rendered = `<span class="math-error" title="Invalid TeX">${escapeHtml(expression)}</span>`
  }
  return rendered.replace(/^<span\b/, (opening) => `${opening} data-editor-math-source="${escapeAttribute(sourceExpression)}" data-editor-math-open="${escapeAttribute(openDelimiter)}" data-editor-math-close="${escapeAttribute(closeDelimiter)}" contenteditable="false"`)
}

function stripUnsafeMarkdownLinks(text) {
  const pattern = /(!?)\[([^\]]*)\]\(\s*(?:<)?(?:javascript|data|vbscript):/ig
  let result = ""
  let cursor = 0
  let match
  while ((match = pattern.exec(text))) {
    const openParen = text.indexOf("(", match.index + match[0].indexOf("]"))
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
    result += match[1] ? "" : match[2]
    cursor = closeParen + 1
    pattern.lastIndex = cursor
  }
  return cursor === 0 ? text : result + text.slice(cursor)
}

function findMathClose(source, from, delimiter) {
  let index = from
  while ((index = source.indexOf(delimiter, index)) >= 0) {
    if (!isEscaped(source, index) && (delimiter !== "$" || source[index + 1] !== "$" && source[index - 1] !== "$")) return index
    index += delimiter.length
  }
  return -1
}

function isEscaped(source, index) {
  let slashes = 0
  for (let cursor = index - 1; cursor >= 0 && source[cursor] === "\\"; cursor -= 1) slashes += 1
  return slashes % 2 === 1
}

function escapeHtml(value) {
  return String(value).replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;")
}

function escapeAttribute(value) {
  return escapeHtml(value).replaceAll('"', "&quot;").replaceAll("'", "&#39;")
}

function typedError(code, message) {
  return Object.assign(new Error(message), { code, retryable: false })
}
