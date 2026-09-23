export function markdownForVisibleText(markdown, text, kind, element = null) {
  const source = markdown || ""
  const value = visibleText(text)
  const rawValue = rawVisibleText(text)

  if (kind === "heading") return value

  if (kind === "table") return markdownForTable(source, element, value)

  if (kind === "image") return markdownForImage(source, element, value)

  if (kind === "code") return markdownForCode(source, rawValue)

  if (kind === "list") {
    const marker = source.match(/^(\s*(?:[-*+] |\d+[.)] ))/)?.[1] || "- "
    return value.split(/\r?\n/).map((line) => `${marker}${line.trim()}`).join("\n")
  }

  if (kind === "quote") {
    const marker = source.match(/^(\s*>\s?)/)?.[1] || "> "
    return value.split(/\r?\n/).map((line) => `${marker}${line.trim()}`).join("\n")
  }

  const strong = source.match(/^(\s*)(\*\*|__)([\s\S]*?)\2(\s*)$/)
  if (strong) return `${strong[1]}${strong[2]}${value}${strong[2]}${strong[4]}`

  const emphasis = source.match(/^(\s*)(\*|_)(?!\2)([\s\S]*?)\2(\s*)$/)
  if (emphasis) return `${emphasis[1]}${emphasis[2]}${value}${emphasis[2]}${emphasis[4]}`

  const strike = source.match(/^(\s*)~~([\s\S]*?)~~(\s*)$/)
  if (strike) return `${strike[1]}~~${value}~~${strike[3]}`

  const fencedCode = source.match(/^(\s*)(`{3,}|~{3,})([^\r\n]*?)\r?\n([\s\S]*?)\r?\n\2(\s*)$/)
  if (fencedCode) {
    return `${fencedCode[1]}${fencedCode[2]}${fencedCode[3]}\n${value}\n${fencedCode[2]}${fencedCode[5]}`
  }

  const code = source.match(/^(\s*)(`+)([\s\S]*?)\2(\s*)$/)
  if (code) return `${code[1]}${code[2]}${value}${code[2]}${code[4]}`

  const link = source.match(/^(\s*)\[[^\]]*\]\(([^)]+)\)(\s*)$/)
  if (link) return `${link[1]}[${value}](${link[2]})${link[3]}`

  const documentLink = source.match(/^(\s*)\[\[([^\]|]+)(?:\|[^\]]*)?\]\](\s*)$/)
  if (documentLink) {
    const title = documentLink[2].trim()
    return source.includes("|")
      ? `${documentLink[1]}[[${title}|${value}]]${documentLink[3]}`
      : `${documentLink[1]}[[${value}]]${documentLink[3]}`
  }

  const math = source.match(/^(\s*)(\${1,2})[\s\S]*?\2(\s*)$/)
  if (math) return `${math[1]}${math[2]}${value}${math[2]}${math[3]}`

  const preserved = preserveInlineMarkdown(source, value)
  if (preserved !== null) return preserved

  return value
}

function visibleText(text) {
  return (text || "").replace(/\u00a0/g, " ").replace(/\n+$/, "").trim()
}

function rawVisibleText(text) {
  return (text || "").replace(/\u00a0/g, " ").replace(/\n+$/, "")
}

function markdownForCode(source, value) {
  const fencedCode = source.match(/^(\s*)(`{3,}|~{3,})([^\r\n]*?)\r?\n([\s\S]*?)\r?\n\2(\s*)$/)
  if (!fencedCode) return value

  return `${fencedCode[1]}${fencedCode[2]}${fencedCode[3]}\n${value}\n${fencedCode[2]}${fencedCode[5]}`
}

function markdownForTable(source, element, fallback) {
  const rows = [...(element?.querySelectorAll?.("tr") || [])].map((row) =>
    [...row.querySelectorAll("th, td")].map((cell) => visibleText(cell.innerText || cell.textContent))
  )
  if (rows.length < 2) return fallback

  const sourceRows = source.split(/\r?\n/)
  const renderRow = (cells, sourceRow) => {
    const original = sourceRow || ""
    const leading = original.match(/^\s*/)?.[0] || ""
    const hasLeadingPipe = /^\s*\|/.test(original)
    const hasTrailingPipe = /\|\s*$/.test(original)
    const values = cells.map((cell) => cell.replace(/\|/g, "\\|"))
    const prefix = `${leading}${hasLeadingPipe ? "| " : ""}`
    const suffix = hasTrailingPipe ? " |" : ""
    return `${prefix}${values.join(" | ")}${suffix}`
  }
  const renderedRows = [renderRow(rows[0], sourceRows[0])]
  if (sourceRows[1]) renderedRows.push(sourceRows[1])
  rows.slice(1).forEach((cells, rowIndex) => renderedRows.push(renderRow(cells, sourceRows[rowIndex + 2])))
  return renderedRows.join("\n")
}

function markdownForImage(source, element, fallback) {
  const image = source.match(/^(\s*)!\[([^\]]*)\]\(([^)\s]+)(?:\s+([^)]*?))?\)(\s*)$/)
  if (!image) return fallback

  const caption = element?.querySelector?.(".editor-media-caption")
  const alt = visibleText(caption?.innerText || caption?.textContent || fallback)
  const title = image[4] ? ` ${image[4]}` : ""
  return `${image[1]}![${alt}](${image[3]}${title})${image[5]}`
}

function preserveInlineMarkdown(source, value) {
  const projection = inlineProjection(source)
  if (!projection.hasSyntax) return null

  const leading = projection.text.match(/^\s*/)?.[0].length || 0
  const trailing = projection.text.match(/\s*$/)?.[0].length || 0
  const end = projection.text.length - trailing
  const previous = projection.text.slice(leading, end)
  const boundaries = projection.boundaries.slice(leading, end + 1)
  const next = value
  if (previous === next) return source

  let prefix = 0
  while (prefix < previous.length && prefix < next.length && previous[prefix] === next[prefix]) prefix += 1

  let suffix = 0
  while (suffix < previous.length - prefix && suffix < next.length - prefix &&
    previous[previous.length - suffix - 1] === next[next.length - suffix - 1]) suffix += 1

  const from = boundaries[prefix]
  const to = boundaries[previous.length - suffix]
  if (from === undefined || to === undefined || from > to) return null

  return `${source.slice(0, from)}${next.slice(prefix, next.length - suffix)}${source.slice(to)}`
}

function inlineProjection(source, sourceOffset = 0) {
  let text = ""
  let boundaries = []
  let hasSyntax = false

  const appendPlain = (value, sourceStart) => {
    if (!value) return
    if (boundaries.length === 0) boundaries[0] = sourceStart
    for (let offset = 0; offset < value.length;) {
      const codePoint = value.codePointAt(offset)
      const width = codePoint > 0xffff ? 2 : 1
      text += value.slice(offset, offset + width)
      boundaries[text.length] = sourceStart + offset + width
      offset += width
    }
  }

  const appendProjection = (projection) => {
    if (!projection.text) return
    boundaries[text.length] = projection.boundaries[0]
    for (let offset = 0; offset < projection.text.length;) {
      const codePoint = projection.text.codePointAt(offset)
      const width = codePoint > 0xffff ? 2 : 1
      text += projection.text.slice(offset, offset + width)
      boundaries[text.length] = projection.boundaries[offset + width]
      offset += width
    }
  }

  for (let index = 0; index < source.length;) {
    const token = inlineTokenAt(source.slice(index))
    if (!token) {
      const codePoint = source.codePointAt(index)
      const width = codePoint > 0xffff ? 2 : 1
      appendPlain(source.slice(index, index + width), sourceOffset + index)
      index += width
      continue
    }

    hasSyntax = true
    appendProjection(inlineProjection(token.content, sourceOffset + index + token.contentOffset))
    index += token.length
  }

  return { text, boundaries, hasSyntax }
}

function inlineTokenAt(source) {
  let match = source.match(/^(\[([^\]]+)\]\(([^\s)]+)(?:\s+["'][^"']*["'])?\))/)
  if (match) return { length: match[0].length, content: match[2], contentOffset: 1 }

  match = source.match(/^(\[\[([^\]|]+)(?:\|([^\]]*))?\]\])/)
  if (match) {
    const content = match[3] === undefined ? match[2] : match[3]
    const contentOffset = match[3] === undefined ? 2 : 2 + match[2].length + 1
    return { length: match[0].length, content, contentOffset }
  }

  match = source.match(/^(`+)([^`\r\n]+?)\1/)
  if (match) return { length: match[0].length, content: match[2], contentOffset: match[1].length }

  match = source.match(/^(\*\*|__)(?=\S)(.+?)(?<=\S)\1/)
  if (match) return { length: match[0].length, content: match[2], contentOffset: match[1].length }

  match = source.match(/^(~~)(?=\S)(.+?)(?<=\S)\1/)
  if (match) return { length: match[0].length, content: match[2], contentOffset: match[1].length }

  match = source.match(/^(?<!\*)(\*)(?!\s)(.+?)(?<!\s)\1(?!\*)/)
  if (match) return { length: match[0].length, content: match[2], contentOffset: 1 }

  match = source.match(/^(?<!_)(_)(?!\s)(.+?)(?<!\s)\1(?!_)/)
  if (match) return { length: match[0].length, content: match[2], contentOffset: 1 }

  return null
}
