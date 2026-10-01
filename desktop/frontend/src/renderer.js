import MarkdownIt from "markdown-it"
import hljs from "highlight.js/lib/common"
import katex from "katex"

const SAFE_LINK = /^(?:https?:|mailto:|tel:|#|\/|\.\.?\/|[^:]*$)/i
const themeNames = new Set(["light", "dark", "match"])
const typographyNames = new Set(["book", "modern", "technical"])

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
    const sourceExpression = state.src.slice(state.eMarks[startLine], state.bMarks[line])
    token.content = `<p>${renderMath(expression.trim(), true, openDelimiter, closeDelimiter, sourceExpression)}</p>\n`
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
  const frontMatter = readFrontMatter(source)
  const style = readStyle(frontMatter.text)
  const sourceName = String(title || "Untitled")
  const bodyStart = frontMatter.bodyStart
  const slideRanges = mode === "document"
    ? [{ start: bodyStart, end: source.length, delimiterRange: null }]
    : splitSlideRanges(source, bodyStart)
  const map = {
    version: 1,
    source_name: sourceName,
    mode,
    source_length: source.length,
    front_matter: frontMatter.bodyStart > 0 ? { range: { start: 0, end: bodyStart }, body_start: bodyStart } : null,
    slides: [],
    directives: [],
    editable_regions: []
  }
  const warnings = []
  const mediaUrl = mediaBaseUrl || `elefasset://localhost/${encodeURIComponent(deckId)}`
  const env = { mediaBaseUrl: mediaUrl, documentNodes }

  for (const [slideIndex, range] of slideRanges.entries()) {
    const parsed = splitBlocks(source, range.start, range.end, mode, slideIndex)
    warnings.push(...parsed.warnings)
    const blocks = parsed.blocks.map((block, blockIndex) => {
      const blockId = `slide-${slideIndex + 1}-block-${blockIndex + 1}`
      const regionId = `slide-${slideIndex + 1}-region-${blockIndex + 1}`
      const kindName = blockKind(block.markdown)
      const heading = headingContentRange(block.markdown)
      const contentRange = heading
        ? { start: block.start + heading.start, end: block.start + heading.end }
        : { start: block.start, end: block.start + block.markdown.length }
      const region = {
        id: regionId,
        block_id: blockId,
        role: heading && slideIndex === 0 && blockIndex === 0 ? "title" : heading ? "heading" : "block",
        kind: kindName,
        text: heading ? heading.text : block.markdown,
        range: { start: block.start, end: block.start + block.markdown.length },
        source_range: { start: block.start, end: block.start + block.markdown.length },
        content_range: contentRange,
        editable: true
      }
      const mapped = {
        id: blockId,
        index: blockIndex,
        kind: kindName,
        markdown: block.markdown,
        position: block.position,
        position_directive_id: block.positionDirectiveId,
        position_scope: block.positionDirectiveId ? "block" : null,
        range: { start: block.start, end: block.end },
        source_range: { start: block.start, end: block.end },
        content_range: contentRange,
        editable_region_id: regionId
      }
      parsed.regions.push(region)
      return mapped
    })
    const slideMap = {
      id: `slide-${slideIndex + 1}`,
      index: slideIndex,
      layout: "body",
      range: { start: range.start, end: range.end },
      source_range: { start: range.start, end: range.end },
      delimiter_range: range.delimiterRange,
      blocks,
      directives: parsed.directives,
      editable_regions: parsed.regions
    }
    map.slides.push(slideMap)
    map.directives.push(...parsed.directives)
    map.editable_regions.push(...parsed.regions)
  }

  const html = mode === "document"
    ? renderDocument(source, map.slides[0], style, env)
    : renderPresentation(source, map.slides, style, env)
  return { html, warnings, editor_map: map, style }
}

function renderDocument(source, slide, style, env) {
  const blocks = slide.blocks.map((block) => {
    const region = slide.editable_regions.find((candidate) => candidate.block_id === block.id)
    const markdownSource = block.markdown
    const rendered = renderMarkdownBlock(markdownSource, env)
    const classes = block.position ? positionClasses(block.position) : ""
    return `<div class="document-editor-block${classes ? ` ${classes}` : ""}" data-editor-region-id="${region.id}" data-editor-block-id="${block.id}" contenteditable="true" role="textbox" aria-label="Editable Markdown block" aria-multiline="true" spellcheck="true" data-action="input-&gt;visual-editor#projectionInput focus-&gt;visual-editor#blockFocus blur-&gt;visual-editor#blockBlur">${rendered}</div>`
  }).join("")
  return `<div class="document-reader document-theme-${style.theme} document-typography-${style.typography} work-theme-${style.theme} work-typography-${style.typography} document-editor-projection" data-controller="document-pages mermaid-diagrams"><div class="document-surface" data-document-pages-target="surface">${blocks}</div></div>`
}

function renderPresentation(source, slides, style, env) {
  const frames = slides.map((slide, index) => {
    const slideBlocks = slide.blocks.map((block) => {
      const region = slide.editable_regions.find((candidate) => candidate.block_id === block.id)
      const heading = /^\s{0,3}#\s+/.test(block.markdown)
      const content = renderMarkdownBlock(block.markdown, env)
      const className = heading ? "slide-title slide-block" : "slide-block"
      return `<div class="${className}" data-editor-block-id="${block.id}" data-editor-region-id="${region.id}" data-editor-source-editable="true" contenteditable="true" role="textbox" aria-label="${heading ? "Editable slide title" : "Editable slide block"}" aria-multiline="true" spellcheck="true" data-action="input-&gt;presentation-editor#blockInput focus-&gt;presentation-editor#blockFocus blur-&gt;presentation-editor#blockBlur">${content}</div><div class="presentation-editor-block-controls" aria-label="Block controls"><button type="button" data-presentation-editor-action="add-block-after" data-slide-index="${index}" data-block-index="${block.index}">Add block</button><button type="button" data-presentation-editor-action="delete-block" data-slide-index="${index}" data-block-index="${block.index}"${slide.blocks.length < 2 ? " disabled" : ""}>Delete</button></div>`
    }).join("") || `<div class="empty-slide"><p>Empty slide</p><button type="button" class="empty-slide-add-image" data-action="click-&gt;media#chooseForSlide" data-slide-index="${index}">Add image</button></div>`
    const toolbar = `<div class="presentation-editor-slide-toolbar" aria-label="Slide ${index + 1} controls"><span class="presentation-editor-slide-label">Slide ${index + 1}</span><button type="button" data-presentation-editor-action="add-slide-after" data-slide-index="${index}">Add slide</button><button type="button" data-presentation-editor-action="delete-slide" data-slide-index="${index}"${slides.length < 2 ? " disabled" : ""}>Delete slide</button><button type="button" data-presentation-editor-action="move-slide-up" data-slide-index="${index}"${index === 0 ? " disabled" : ""}>Move up</button><button type="button" data-presentation-editor-action="move-slide-down" data-slide-index="${index}"${index === slides.length - 1 ? " disabled" : ""}>Move down</button></div>`
    const title = headingForSlide(slide)
    return `<div class="slide-frame" data-controller="presentation-canvas"><section class="slide slide-body" data-presentation-canvas-target="canvas" aria-label="Slide ${index + 1}" data-editor-slide-id="slide-${index + 1}" data-slide-index="${index}">${toolbar}<div class="slide-content">${title}${slideBlocks}</div></section></div>`
  }).join("")
  return `<div class="presentation-surface work-surface slides slides-theme-${style.theme} slides-typography-${style.typography} work-theme-${style.theme} work-typography-${style.typography} presentation-editor-projection" data-controller="mermaid-diagrams">${frames}</div>`
}

function headingForSlide(slide) {
  const first = slide.blocks[0]
  if (!first || !/^\s{0,3}#\s+/.test(first.markdown)) return ""
  return ""
}

function splitSlideRanges(source, bodyStart) {
  const ranges = []
  let start = bodyStart
  let fence = null
  for (const line of sourceLines(source, bodyStart, source.length)) {
    const marker = fenceMarker(line.text)
    if (fence) {
      if (marker && marker.character === fence.character && marker.length >= fence.length && marker.closing) fence = null
      continue
    }
    if (marker) {
      fence = marker
      continue
    }
    if (/^[ \t]*---[ \t]*$/.test(line.text)) {
      ranges.push({ start, end: line.start, delimiterRange: { start: line.start, end: line.end } })
      start = line.end
    }
  }
  ranges.push({ start, end: source.length, delimiterRange: null })
  return ranges
}

function splitBlocks(source, start, end, mode, slideIndex) {
  const blocks = []
  const directives = []
  const regions = []
  let current = []
  let fence = null
  let pendingPosition = null
  let directiveCount = 0
  const flush = () => {
    if (!current.length) return
    const first = current[0]
    const last = current.at(-1)
    const raw = source.slice(first.start, last.end)
    const text = raw.replace(/(?:\r\n|\r|\n)$/, "")
    if (text.trim()) blocks.push({ start: first.start, end: last.end, markdown: text, position: pendingPosition?.value || null, positionDirectiveId: pendingPosition?.id || null })
    current = []
    pendingPosition = null
  }

  for (const line of sourceLines(source, start, end)) {
    const marker = fenceMarker(line.text)
    if (fence) {
      current.push(line)
      if (marker && marker.character === fence.character && marker.length >= fence.length && marker.closing) fence = null
      continue
    }
    if (marker) {
      current.push(line)
      fence = marker
      continue
    }
    if (!line.text.trim()) {
      flush()
      continue
    }
    if (/^\s*:::\w/.test(line.text)) {
      flush()
      const directive = line.text.trim()
      const id = `slide-${slideIndex + 1}-directive-${++directiveCount}`
      const position = /^:::(?:align|position)\s*\{([^}]*)\}/.exec(directive)
      directives.push({ id, type: position ? "position" : "unknown", value: position?.[1]?.trim() || null, text: directive, range: { start: line.start, end: line.end }, source_range: { start: line.start, end: line.end }, editable: Boolean(position), scope: mode === "document" ? "document" : "slide" })
      if (position) pendingPosition = { id, value: parsePosition(position[1]) }
      else if (directive !== ":::") pendingPosition = null
      continue
    }
    if (line.text.trim() === ":::") {
      flush()
      directives.push({ id: `slide-${slideIndex + 1}-directive-${++directiveCount}`, type: "position_close", value: null, text: ":::" , range: { start: line.start, end: line.end }, source_range: { start: line.start, end: line.end }, editable: false })
      pendingPosition = null
      continue
    }
    current.push(line)
  }
  flush()
  return { blocks, directives, regions, warnings: [] }
}

function sourceLines(source, start, end) {
  const lines = []
  let cursor = start
  while (cursor < end) {
    const newline = source.indexOf("\n", cursor)
    const lineEnd = newline < 0 || newline >= end ? end : newline + 1
    let textEnd = lineEnd
    if (source[textEnd - 1] === "\n") textEnd -= 1
    if (source[textEnd - 1] === "\r") textEnd -= 1
    lines.push({ start: cursor, end: lineEnd, text: source.slice(cursor, textEnd) })
    cursor = lineEnd
  }
  return lines
}

function readFrontMatter(source) {
  const bom = source.startsWith("\uFEFF") ? 1 : 0
  const firstEnd = source.indexOf("\n")
  if (firstEnd < 0 || !/^\uFEFF?---[ \t]*\r?$/.test(source.slice(0, firstEnd))) return { text: "", bodyStart: 0 }
  let cursor = firstEnd + 1
  while (cursor <= source.length) {
    const newline = source.indexOf("\n", cursor)
    const end = newline < 0 ? source.length : newline
    const line = source.slice(cursor, end).replace(/\r$/, "")
    if (/^---[ \t]*$/.test(line)) return { text: source.slice(firstEnd + 1, cursor), bodyStart: newline < 0 ? end : newline + 1 }
    if (newline < 0) break
    cursor = newline + 1
  }
  return { text: "", bodyStart: 0 }
}

function readStyle(frontMatter) {
  const value = (key, fallback, choices) => {
    const match = new RegExp(`^${key}:[ \\t]*["']?([^\\s"'#]+)`, "m").exec(frontMatter)
    return match && choices.has(match[1]) ? match[1] : fallback
  }
  return { theme: value("theme", "match", themeNames), typography: value("typography", "book", typographyNames) }
}

function blockKind(source) {
  if (/^\s{0,3}#{1,6}\s+/.test(source)) return "heading"
  if (/^\s*(`{3,}|~{3,})/.test(source) || /^ {4}/.test(source)) return "code"
  if (/^\s*(?:[-*+] |\d+[.)] )/.test(source)) return "list"
  if (/^\s*>/.test(source)) return "quote"
  if (/^\s*\|?.+\|[ \t]*\n\s*\|?[\s:|-]+\|/.test(source)) return "table"
  if (/^\s*!\[[^\]]*\]\([^)]+\)\s*$/.test(source)) return "image"
  return "paragraph"
}

function headingContentRange(source) {
  const match = /^([ \t]{0,3}#{1,6})[ \t]+(.+?)(?:[ \t]+#+[ \t]*)?$/.exec(source)
  if (!match) return null
  const leading = match[1].length + (match[0].slice(match[1].length).match(/^[ \t]+/)?.[0].length || 0)
  return { start: leading, end: leading + match[2].length, text: match[2] }
}

function positionClasses(position) {
  if (!position) return ""
  return [`position-${position.horizontal}`, `position-${position.vertical}`].join(" ")
}

function parsePosition(value) {
  const values = value.toLowerCase().trim().split(/\s+/)
  let horizontal = values.find((item) => ["left", "center", "right"].includes(item)) || "left"
  let vertical = values.find((item) => ["top", "middle", "bottom"].includes(item)) || "top"
  if (values.length === 2 && ["top", "center", "middle", "bottom"].includes(values[0]) && ["left", "center", "right"].includes(values[1])) {
    vertical = values[0] === "center" ? "middle" : values[0]
    horizontal = values[1]
  }
  return { horizontal, vertical, vertical_explicit: values.some((item) => ["top", "middle", "bottom"].includes(item)) }
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

function fenceMarker(line) {
  const match = /^\s{0,3}(`{3,}|~{3,})(.*)$/.exec(line)
  return match ? { character: match[1][0], length: match[1].length, closing: match[2].trim() === "" } : null
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
