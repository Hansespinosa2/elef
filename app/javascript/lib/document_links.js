export function parseDocumentLinkAt(source, start = 0) {
  if (typeof source !== "string" || !source.startsWith("[[", start) || source.startsWith("[[[", start) ||
      (start > 0 && source[start - 1] === "[")) return null
  const close = source.indexOf("]]", start + 2)
  if (close < 0 || source.slice(start + 2, close).includes("\n")) return null
  return { title: source.slice(start + 2, close), start, end: close + 2 }
}

export function extractDocumentLinkTitles(source = "") {
  if (typeof source !== "string") return []
  const links = []
  let fence = null

  for (const line of source.split(/\r?\n/)) {
    const marker = line.match(/^ {0,3}(`{3,}|~{3,})(.*)$/)
    if (marker) {
      if (!fence) fence = { character: marker[1][0], length: marker[1].length }
      else if (marker[1][0] === fence.character && marker[1].length >= fence.length && !marker[2].trim()) fence = null
      continue
    }
    if (fence || line.startsWith("    ") || line.startsWith("\t")) continue

    let cursor = 0
    while (cursor + 1 < line.length) {
      const start = line.indexOf("[[", cursor)
      if (start < 0) break
      const token = parseDocumentLinkAt(line, start)
      if (!token) {
        cursor = start + 2
        continue
      }
      const end = token.end
      if (!isEscaped(line, start) && !inlineCodeContains(line, start, end) &&
          token.title.length > 0 && !/[\]`]/.test(token.title)) {
        links.push(token.title)
      }
      cursor = end
    }
  }
  return links
}

export function extractFirstMarkdownHeading(source = "") {
  if (typeof source !== "string") return null
  const lines = source.split(/\r\n?|\n/)
  let firstBodyLine = 0

  if (lines[0]?.replace(/^\uFEFF/, "").trimEnd() === "---") {
    const closingLine = lines.findIndex((line, index) => index > 0 && line.trimEnd() === "---")
    if (closingLine > 0 && lines.slice(1, closingLine).some(line => /^[A-Za-z_][\w-]*\s*:/.test(line))) {
      firstBodyLine = closingLine + 1
    }
  }

  let fence = null
  for (const line of lines.slice(firstBodyLine)) {
    const marker = line.match(/^\s{0,3}(`{3,}|~{3,})(.*)$/)
    if (marker) {
      if (!fence) fence = { character: marker[1][0], length: marker[1].length }
      else if (marker[1][0] === fence.character && marker[1].length >= fence.length && !marker[2].trim()) fence = null
      continue
    }
    if (fence) continue

    const heading = line.match(/^\s{0,3}#(?!#)\s+(.+?)\s*#*\s*$/)
    if (heading) return heading[1].trim()
  }
  return null
}

export function parsePortableDocumentLinks(source = "") {
  if (typeof source !== "string") return { documentKey: null, aliases: [] }
  const lines = source.split(/\r\n?|\n/)
  if (lines[0]?.replace(/^\uFEFF/, "").trimEnd() !== "---") return { documentKey: null, aliases: [] }

  const closingLine = lines.findIndex((line, index) => index > 0 && line.trimEnd() === "---")
  if (closingLine < 0) return { documentKey: null, aliases: [] }
  const values = new Map()
  for (const line of lines.slice(1, closingLine)) {
    const match = line.match(/^(elef_document_key|elef_aliases)\s*:\s*(.*)$/)
    if (match && !values.has(match[1])) values.set(match[1], match[2].trim())
  }

  let documentKey = null
  try {
    const value = values.get("elef_document_key")
    if (value) {
      const parsed = JSON.parse(value)
      if (typeof parsed === "string" && parsed.trim()) documentKey = parsed.trim()
    }
  } catch (_error) {
    // Invalid optional portable metadata behaves like an absent value.
  }

  let aliases = []
  try {
    const parsed = JSON.parse(values.get("elef_aliases") || "null")
    if (Array.isArray(parsed)) aliases = [...new Set(parsed.filter(value => typeof value === "string" && value.trim()).map(value => value.trim()))]
  } catch (_error) {
    // Invalid optional portable metadata behaves like an absent value.
  }

  return { documentKey, aliases }
}

export function createDocumentLinkResolver(documents = []) {
  const byTitle = new Map()
  const byAlias = new Map()
  const ambiguousAliases = new Set()
  const byKey = new Map()
  const ambiguousKeys = new Set()
  const byId = new Map()

  for (const input of documents) {
    const document = withPortableDocumentLinks(input)
    if (document?.title != null) byTitle.set(String(document.title), document)
    if (document?.id != null) byId.set(String(document.id), document)
    const key = document?.documentKey ?? document?.document_key ?? document?.id
    if (key != null) addUniqueIndex(byKey, ambiguousKeys, key, document)
    for (const alias of Array.isArray(document?.aliases) ? document.aliases : []) {
      if (typeof alias === "string") addUniqueIndex(byAlias, ambiguousAliases, alias, document)
    }
  }

  return value => {
    const tokenKey = String(value ?? "").split("|", 2)[0]
    const explicitDocumentKey = tokenKey.match(/^document:(.*)$/)
    if (explicitDocumentKey) return byKey.get(explicitDocumentKey[1]) || null
    const explicitId = tokenKey.match(/^id:(.*)$/)
    if (explicitId) return byId.get(explicitId[1]) || null
    if (ambiguousAliases.has(tokenKey) || ambiguousKeys.has(tokenKey)) return null
    return byAlias.get(tokenKey) || byTitle.get(tokenKey) || byKey.get(tokenKey) || byId.get(tokenKey) || null
  }
}

export function buildDocumentGraph(documents = []) {
  if (!Array.isArray(documents)) throw new TypeError("Document graph input must be a list.")
  const entries = documents
    .filter(document => document && document.id != null && (typeof document.title === "string" || typeof document.name === "string"))
    .map(document => withPortableDocumentLinks({
      ...document,
      title: document.title || extractFirstMarkdownHeading(document.source || "") || document.name
    }))
  const resolve = createDocumentLinkResolver(entries)
  const nodes = entries.map((document, index) => ({
    id: document.id,
    title: document.title,
    url: document.url || document.href || `#deck/${encodeURIComponent(String(document.id))}`,
    documentKey: document.documentKey,
    aliases: document.aliases,
    x: 120 + (index % 4) * 220,
    y: 100 + Math.floor(index / 4) * 150
  }))
  const edges = []
  const seen = new Set()

  for (const document of entries) {
    for (const title of extractDocumentLinkTitles(document.source || "")) {
      const target = resolve(title)
      if (!target) continue
      const key = JSON.stringify([String(document.id), String(target.id)])
      if (seen.has(key)) continue
      seen.add(key)
      edges.push({ source: document.id, target: target.id })
    }
  }
  return { nodes, edges }
}

function withPortableDocumentLinks(document) {
  if (!document || typeof document !== "object") return document
  const portable = parsePortableDocumentLinks(document.source || "")
  const aliases = Array.isArray(document.aliases) ? document.aliases : []
  return {
    ...document,
    documentKey: portable.documentKey || document.documentKey || document.document_key || String(document.id ?? ""),
    aliases: [...new Set([...aliases, ...portable.aliases])]
  }
}

function addUniqueIndex(index, ambiguous, value, document) {
  const key = String(value).trim()
  if (!key || ambiguous.has(key)) return
  const existing = index.get(key)
  if (existing && String(existing.id) !== String(document.id)) {
    index.delete(key)
    ambiguous.add(key)
  } else if (!existing) {
    index.set(key, document)
  }
}

function inlineCodeContains(line, start, end) {
  let cursor = 0
  while (cursor < line.length) {
    if (line[cursor] !== "`") {
      cursor += 1
      continue
    }
    const runStart = cursor
    while (line[cursor] === "`") cursor += 1
    const runLength = cursor - runStart
    let search = cursor
    while (search < line.length) {
      const closingStart = line.indexOf("`", search)
      if (closingStart < 0) break
      let closingEnd = closingStart
      while (line[closingEnd] === "`") closingEnd += 1
      if (closingEnd - closingStart === runLength) {
        if (start < closingEnd && end > runStart) return true
        cursor = closingEnd
        break
      }
      search = closingEnd
    }
  }
  return false
}

function isEscaped(line, position) {
  let backslashes = 0
  for (let cursor = position - 1; cursor >= 0 && line[cursor] === "\\"; cursor -= 1) backslashes += 1
  return backslashes % 2 === 1
}
