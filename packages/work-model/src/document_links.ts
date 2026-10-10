export interface DocumentLinkToken {
  title: string;
  start: number;
  end: number;
}

export interface LinkableDocument {
  id?: unknown;
  title?: unknown;
  name?: unknown;
  source?: unknown;
  url?: unknown;
  href?: unknown;
  aliases?: unknown;
  documentKey?: unknown;
  document_key?: unknown;
}

export interface ResolvedDocument extends LinkableDocument {
  documentKey: string;
  aliases: string[];
}

export interface DocumentGraphNode {
  id: unknown;
  title: string;
  url: string;
  documentKey: string;
  aliases: string[];
  x: number;
  y: number;
}

export interface DocumentGraphEdge {
  source: unknown;
  target: unknown;
}

export interface DocumentGraph {
  nodes: DocumentGraphNode[];
  edges: DocumentGraphEdge[];
}

export interface PortableDocumentLinks {
  documentKey: string | null;
  aliases: string[];
}

export function parseDocumentLinkAt(source: string, start = 0): DocumentLinkToken | null {
  if (typeof source !== "string" || !source.startsWith("[[", start) || source.startsWith("[[[", start) ||
      (start > 0 && source[start - 1] === "[")) return null
  const close = source.indexOf("]]", start + 2)
  if (close < 0 || source.slice(start + 2, close).includes("\n")) return null
  return { title: source.slice(start + 2, close), start, end: close + 2 }
}

export function isLinkableDocumentTitle(title: unknown): boolean {
  const value = String(title ?? "")
  return value.length > 0 && !/[\]\r\n`]/.test(value)
}

export function linkableDocumentTitles(titles: readonly unknown[] = []): string[] {
  if (!Array.isArray(titles)) return []
  return titles.map(title => String(title ?? "")).filter(isLinkableDocumentTitle)
}

interface CodeFence {
  character: string;
  length: number;
}

export function extractDocumentLinkTokens(source: string = ""): DocumentLinkToken[] {
  if (typeof source !== "string") return []
  const links: DocumentLinkToken[] = []
  let fence: CodeFence | null = null
  let lineStart = 0

  while (lineStart <= source.length) {
    const newline = source.indexOf("\n", lineStart)
    let lineEnd = newline < 0 ? source.length : newline
    if (lineEnd > lineStart && source[lineEnd - 1] === "\r") lineEnd -= 1
    const line = source.slice(lineStart, lineEnd)
    const marker = line.match(/^ {0,3}(`{3,}|~{3,})(.*)$/)
    if (marker) {
      const run = marker[1] ?? ""
      const rest = marker[2] ?? ""
      if (!fence) fence = { character: run[0] ?? "", length: run.length }
      else if (run[0] === fence.character && run.length >= fence.length && !rest.trim()) fence = null
    } else if (!fence && !line.startsWith("    ") && !line.startsWith("\t")) {
      let cursor = 0
      while (cursor + 1 < line.length) {
        const start = line.indexOf("[[", cursor)
        if (start < 0) break
        const token = parseDocumentLinkAt(line, start)
        if (!token) {
          cursor = start + 2
          continue
        }
        if (!isEscaped(line, start) && !inlineCodeContains(line, start, token.end) &&
            isLinkableDocumentTitle(token.title)) {
          links.push({ ...token, start: lineStart + token.start, end: lineStart + token.end })
        }
        cursor = token.end
      }
    }

    if (newline < 0) break
    lineStart = newline + 1
  }

  return links
}

export function extractDocumentLinkTitles(source: string = ""): string[] {
  return extractDocumentLinkTokens(source).map(token => token.title)
}

export function extractFirstMarkdownHeading(source: string = ""): string | null {
  if (typeof source !== "string") return null
  const lines = source.split(/\r\n?|\n/)
  let firstBodyLine = 0

  if (lines[0]?.replace(/^\uFEFF/, "").trimEnd() === "---") {
    const closingLine = lines.findIndex((line, index) => index > 0 && line.trimEnd() === "---")
    if (closingLine > 0 && lines.slice(1, closingLine).some(line => /^[A-Za-z_][\w-]*\s*:/.test(line))) {
      firstBodyLine = closingLine + 1
    }
  }

  let fence: CodeFence | null = null
  for (const line of lines.slice(firstBodyLine)) {
    const marker = line.match(/^\s{0,3}(`{3,}|~{3,})(.*)$/)
    if (marker) {
      const run = marker[1] ?? ""
      const rest = marker[2] ?? ""
      if (!fence) fence = { character: run[0] ?? "", length: run.length }
      else if (run[0] === fence.character && run.length >= fence.length && !rest.trim()) fence = null
      continue
    }
    if (fence) continue

    const heading = line.match(/^\s{0,3}#(?!#)\s+(.+?)\s*#*\s*$/)
    if (heading) return (heading[1] ?? "").trim()
  }
  return null
}

export function parsePortableDocumentLinks(source: string = ""): PortableDocumentLinks {
  if (typeof source !== "string") return { documentKey: null, aliases: [] }
  const lines = source.split(/\r\n?|\n/)
  if (lines[0]?.replace(/^\uFEFF/, "").trimEnd() !== "---") return { documentKey: null, aliases: [] }

  const closingLine = lines.findIndex((line, index) => index > 0 && line.trimEnd() === "---")
  if (closingLine < 0) return { documentKey: null, aliases: [] }
  const values = new Map<string, string>()
  for (const line of lines.slice(1, closingLine)) {
    const match = line.match(/^(elef_document_key|elef_aliases)\s*:\s*(.*)$/)
    const key = match?.[1]
    const raw = match?.[2] ?? ""
    if (key && !values.has(key)) values.set(key, raw.trim())
  }

  let documentKey: string | null = null
  try {
    const value = values.get("elef_document_key")
    if (value) {
      const parsed: unknown = JSON.parse(value)
      if (typeof parsed === "string" && parsed.trim()) documentKey = parsed
    }
  } catch (_error) {
    // Invalid optional portable metadata behaves like an absent value.
  }

  let aliases: string[] = []
  try {
    const parsed: unknown = JSON.parse(values.get("elef_aliases") || "null")
    if (Array.isArray(parsed)) aliases = [...new Set(parsed.filter(value => typeof value === "string" && value.trim()).map(value => (value as string).trim()))]
  } catch (_error) {
    // Invalid optional portable metadata behaves like an absent value.
  }

  return { documentKey, aliases }
}

export function createDocumentLinkResolver(documents: readonly LinkableDocument[] = []): (value: unknown) => ResolvedDocument | null {
  const byTitle = new Map<string, ResolvedDocument>()
  const byAlias = new Map<string, ResolvedDocument>()
  const ambiguousAliases = new Set<string>()
  const byKey = new Map<string, ResolvedDocument>()
  const ambiguousKeys = new Set<string>()
  const byId = new Map<string, ResolvedDocument>()

  for (const input of documents) {
    const doc = withPortableDocumentLinks(input)
    if (!doc) continue
    if (doc.title != null) byTitle.set(String(doc.title), doc)
    if (doc.id != null) byId.set(String(doc.id), doc)
    const key = doc.documentKey ?? doc.document_key ?? doc.id
    if (key != null) addUniqueIndex(byKey, ambiguousKeys, key, doc)
    for (const alias of Array.isArray(doc.aliases) ? doc.aliases : []) {
      if (typeof alias === "string") addUniqueIndex(byAlias, ambiguousAliases, alias, doc)
    }
  }

  return value => {
    const tokenKey = String(value ?? "").split("|", 2)[0] ?? ""
    const explicitDocumentKey = tokenKey.match(/^document:(.*)$/)
    if (explicitDocumentKey) return byKey.get(explicitDocumentKey[1] ?? "") || null
    const explicitId = tokenKey.match(/^id:(.*)$/)
    if (explicitId) return byId.get(explicitId[1] ?? "") || null
    if (ambiguousAliases.has(tokenKey) || ambiguousKeys.has(tokenKey)) return null
    return byAlias.get(tokenKey) || byTitle.get(tokenKey) || byKey.get(tokenKey) || byId.get(tokenKey) || null
  }
}

export function buildDocumentGraph(documents: readonly LinkableDocument[] = []): DocumentGraph {
  if (!Array.isArray(documents)) throw new TypeError("Document graph input must be a list.")
  const entries = documents
    .filter(doc => doc && doc.id != null && (typeof doc.title === "string" || typeof doc.name === "string"))
    .map(doc => withPortableDocumentLinks({
      ...doc,
      title: doc.title || extractFirstMarkdownHeading(typeof doc.source === "string" ? doc.source : "") || doc.name
    }))
    .filter((doc): doc is ResolvedDocument => doc !== null)
  const resolve = createDocumentLinkResolver(entries)
  const nodes: DocumentGraphNode[] = entries.map((doc, index) => {
    const fallbackUrl = `#deck/${encodeURIComponent(String(doc.id))}`
    const rawUrl = doc.url || doc.href || fallbackUrl
    const rawTitle = doc.title
    return {
      id: doc.id,
      title: typeof rawTitle === "string" ? rawTitle : "",
      url: typeof rawUrl === "string" ? rawUrl : fallbackUrl,
      documentKey: doc.documentKey,
      aliases: doc.aliases,
      x: 120 + (index % 4) * 220,
      y: 100 + Math.floor(index / 4) * 150
    }
  })
  const edges: DocumentGraphEdge[] = []
  const seen = new Set<string>()

  for (const doc of entries) {
    for (const title of extractDocumentLinkTitles(typeof doc.source === "string" ? doc.source : "")) {
      const target = resolve(title)
      if (!target) continue
      const key = JSON.stringify([String(doc.id), String(target.id)])
      if (seen.has(key)) continue
      seen.add(key)
      edges.push({ source: doc.id, target: target.id })
    }
  }
  return { nodes, edges }
}

function withPortableDocumentLinks(doc: LinkableDocument | null | undefined): ResolvedDocument | null {
  if (!doc || typeof doc !== "object") return null
  const portable = parsePortableDocumentLinks(typeof doc.source === "string" ? doc.source : "")
  const aliases = Array.isArray(doc.aliases) ? doc.aliases : []
  const fallbackKey = String(doc.id ?? "")
  const rawKey = portable.documentKey || doc.documentKey || doc.document_key || fallbackKey
  return {
    ...doc,
    documentKey: typeof rawKey === "string" ? rawKey : fallbackKey,
    aliases: [...new Set([...aliases, ...portable.aliases])]
  }
}

function addUniqueIndex(index: Map<string, ResolvedDocument>, ambiguous: Set<string>, value: unknown, doc: ResolvedDocument): void {
  const key = String(value).trim()
  if (!key || ambiguous.has(key)) return
  const existing = index.get(key)
  if (existing && String(existing.id) !== String(doc.id)) {
    index.delete(key)
    ambiguous.add(key)
  } else if (!existing) {
    index.set(key, doc)
  }
}

function inlineCodeContains(line: string, start: number, end: number): boolean {
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

function isEscaped(line: string, position: number): boolean {
  let backslashes = 0
  for (let cursor = position - 1; cursor >= 0 && line[cursor] === "\\"; cursor -= 1) backslashes += 1
  return backslashes % 2 === 1
}
