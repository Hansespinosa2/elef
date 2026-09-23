export function markdownForVisibleText(markdown, text, kind, element = null) {
  const source = markdown || ""
  const value = visibleText(text)

  if (kind === "heading") return value

  if (kind === "table") return markdownForTable(source, element, value)

  if (kind === "image") return markdownForImage(source, element, value)

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

  return value
}

function visibleText(text) {
  return (text || "").replace(/\u00a0/g, " ").replace(/\n+$/, "").trim()
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
