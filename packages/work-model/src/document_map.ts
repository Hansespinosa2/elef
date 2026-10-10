export interface SourceRange {
  start: number;
  end: number;
}

export interface SourcePosition {
  horizontal: string;
  vertical: string;
  vertical_explicit: boolean;
}

// Canonical align position vocabulary (F7): the host authoring-registry
// merge derives its directive grammar from this export instead of
// restating the word lists, and positionFromBlock below parses from it.
export const POSITION_VOCABULARY: {
  readonly horizontal: readonly string[];
  readonly vertical: readonly string[];
} = {
  horizontal: ["left", "center", "right"],
  vertical: ["top", "middle", "bottom"]
};

export interface SourceLine {
  start: number;
  end: number;
  text: string;
}

export interface FrontMatter {
  lines: SourceLine[];
  closingLine: number;
  bodyStart: number;
}

export interface MapBlock {
  id: string;
  index: number;
  kind: string;
  markdown: string;
  position?: SourcePosition | null;
  position_directive_id?: string | null;
  position_scope?: string | null;
  range: SourceRange;
  source_range: SourceRange;
  content_range: SourceRange;
  editable_region_id?: string;
  empty_placeholder?: boolean;
}

export interface MapDirective {
  id: string;
  type: string;
  value: string | null;
  text: string;
  range: SourceRange;
  source_range: SourceRange;
  editable: boolean;
  scope?: string;
}

export interface MapRegion {
  id: string;
  block_id: string;
  role: string;
  kind: string;
  text: string;
  range: SourceRange;
  source_range: SourceRange;
  content_range: SourceRange;
  editable: boolean;
  empty_heading?: boolean;
  empty_placeholder?: boolean;
}

export interface MapSlide {
  id: string;
  index: number;
  layout: string;
  range: SourceRange;
  source_range: SourceRange;
  delimiter_range: SourceRange | null;
  blocks: MapBlock[];
  directives: MapDirective[];
  editable_regions: MapRegion[];
}

export interface EditorMap {
  version: number;
  source_name: string;
  mode: string;
  source_length: number;
  front_matter: { range: SourceRange; body_start: number } | null;
  slides: MapSlide[];
  directives: MapDirective[];
  editable_regions: MapRegion[];
}

export interface ParsedBlock {
  markdown: string;
  position: SourcePosition | null;
}

export interface SlideMetadata {
  layout: string;
  title: string | null;
  blocks: ParsedBlock[];
  regions: ParsedBlock[][];
  section: string | null;
  subsection: string | null;
  footnote: string | null;
  warnings: string[];
}

export interface ParsedSlide extends SlideMetadata {
  map: MapSlide;
}

export interface EditorStyle {
  theme: string;
  typography: string;
}

export interface MarginSettings {
  section: boolean;
  subsection: boolean;
  footnote: boolean;
  slide_count: boolean;
}

export interface EditorStructure {
  editorMap: EditorMap;
  slides: ParsedSlide[];
  warnings: string[];
  style: EditorStyle;
  marginSettings: MarginSettings;
}

interface SlideSourceRange {
  start: number;
  end: number;
  delimiterStart: number | null;
  delimiterEnd: number | null;
}

interface MarginContext {
  section: string | null;
  subsection: string | null;
}

interface FenceState {
  marker: string;
  length: number;
  closing: boolean;
}

const THEMES = new Set(["light", "dark", "match"])
const TYPOGRAPHIES = new Set(["book", "modern", "technical"])

export function buildEditorMap(
  source: unknown,
  { sourceName = "Untitled presentation", mode = "presentation" }: { sourceName?: string; mode?: string } = {}
): EditorMap {
  return buildEditorStructure(source, { sourceName, mode }).editorMap
}

export function buildEditorStructure(
  source: unknown,
  { sourceName = "Untitled presentation", mode = "presentation" }: { sourceName?: string; mode?: string } = {}
): EditorStructure {
  if (typeof source !== "string") throw new TypeError("The selected file did not contain readable text.")
  if (mode !== "presentation" && mode !== "document") throw new TypeError("Unsupported document mode")

  const frontMatter = initialFrontMatter(source)
  const bodyStart = frontMatter?.bodyStart ?? 0
  const ranges: SlideSourceRange[] = mode === "document"
    ? [{ start: bodyStart, end: source.length, delimiterStart: null, delimiterEnd: null }]
    : slideSourceRanges(source, bodyStart)
  const context: MarginContext = { section: null, subsection: null }
  const map: EditorMap = {
    version: 1,
    source_name: String(sourceName),
    mode,
    source_length: source.length,
    front_matter: frontMatter ? {
      range: { start: 0, end: frontMatter.bodyStart },
      body_start: frontMatter.bodyStart
    } : null,
    slides: [],
    directives: [],
    editable_regions: []
  }
  const parsedSlides: ParsedSlide[] = []
  const warnings: string[] = []

  ranges.forEach((range, index) => {
    const normalizedSection = normalizeSection(source.slice(range.start, range.end).replace(/\r\n?/g, "\n"))
    const metadata = slideMetadata(normalizedSection, context, mode)
    const result = editorBlocks(source, range.start, range.end, metadata, index, mode)
    let blocks = result.blocks
    let regions = result.regions
    if (mode === "document") {
      const empty = emptyEditorBlocks(source, index, blocks)
      blocks = [...blocks, ...empty.map(([block]) => block)].sort((left, right) => left.range.start - right.range.start)
      regions = [...regions, ...empty.map(([, region]) => region)]
    }
    const slideMap: MapSlide = {
      id: `slide-${index + 1}`,
      index,
      layout: metadata.layout,
      range: { start: range.start, end: range.end },
      source_range: { start: range.start, end: range.end },
      delimiter_range: range.delimiterStart === null || range.delimiterEnd === null
        ? null
        : { start: range.delimiterStart, end: range.delimiterEnd },
      blocks,
      directives: result.directives,
      editable_regions: regions
    }
    map.slides.push(slideMap)
    map.directives.push(...result.directives)
    map.editable_regions.push(...regions)
    parsedSlides.push({ ...metadata, map: slideMap })
    warnings.push(...metadata.warnings)
  })

  return {
    editorMap: map,
    slides: parsedSlides,
    warnings,
    style: readStyle(source),
    marginSettings: marginSettings(source)
  }
}

export function initialFrontMatter(source: string): FrontMatter | null {
  const lines = sourceLines(source)
  const first = lines[0]
  if (!first || first.text.replace(/^\uFEFF/, "").replace(/[ \t]+$/, "") !== "---") return null
  const closingIndex = lines.findIndex((line, index) => index > 0 && line.text.replace(/[ \t]+$/, "") === "---")
  if (closingIndex < 0) return null
  const metadataLines = lines.slice(1, closingIndex)
  if (!metadataLines.some(line => /^[A-Za-z_][\w-]*\s*:/.test(line.text))) return null
  const closing = lines[closingIndex]
  if (!closing) return null
  return {
    lines,
    closingLine: closingIndex,
    bodyStart: closing.end
  }
}

export function readStyle(source: string): EditorStyle {
  const frontMatter = initialFrontMatter(source)
  const read = (key: string, fallback: string, vocabulary: Set<string>): string => {
    if (!frontMatter) return fallback
    for (const line of frontMatter.lines.slice(1, frontMatter.closingLine)) {
      const match = new RegExp(`^${key}\\s*:\\s*(.*)$`).exec(line.text)
      if (!match) continue
      const cleaned = (match[1] ?? "").trim().replace(/\s+#.*$/, "").trim()
      const unquoted = cleaned.match(/^(['"])(.*)\1$/)?.[2] ?? cleaned
      return vocabulary.has(unquoted) ? unquoted : fallback
    }
    return fallback
  }
  return {
    theme: read("theme", "match", THEMES),
    typography: read("typography", "book", TYPOGRAPHIES)
  }
}

// The native appearance adapter persists the same flat metadata fields as
// Rails. Retain unrelated metadata, body bytes, and the file's line endings.
export function withAppearanceValue(source: unknown, key: string, value: string): string {
  const vocabulary = key === "theme" ? THEMES : key === "typography" ? TYPOGRAPHIES : null
  if (typeof source !== "string" || !vocabulary || (value !== "" && !vocabulary.has(value))) {
    throw new TypeError("Unsupported appearance value")
  }
  return withFrontMatterValue(source, key, value === "" ? null : value)
}

export function withFrontMatterValue(source: unknown, key: string, value: string | null | undefined): string {
  if (typeof source !== "string" || typeof key !== "string" || !key) {
    throw new TypeError("Front matter updates need source text and a key.")
  }
  const remove = value === null || value === undefined
  const front = initialFrontMatter(source)
  const ending = (line: SourceLine): string => source.slice(line.start + line.text.length, line.end)
  const eol = front?.lines.map(ending).find(Boolean) || (source.includes("\r\n") ? "\r\n" : "\n")
  if (!front) return remove ? source : `---${eol}${key}: ${value}${eol}---${eol}${source}`
  const escapedKey = key.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
  const matching = front.lines.slice(1, front.closingLine).find(line => new RegExp(`^\\s*${escapedKey}\\s*:`).test(line.text))
  if (matching) {
    const replacement = remove ? "" : `${key}: ${value}${ending(matching)}`
    const updated = source.slice(0, matching.start) + replacement + source.slice(matching.end)
    if (remove && front.closingLine === 2) {
      return source.slice(front.bodyStart).replace(/^\r?\n/, "")
    }
    return updated
  }
  if (remove) return source
  const closing = front.lines[front.closingLine]
  if (!closing) return source
  return source.slice(0, closing.start) + `${key}: ${value}${eol}` + source.slice(closing.start)
}

export function normalizeThemeValue(value: unknown): string {
  return normalizeStyleValue(value, THEMES, "match")
}

export function normalizeTypographyValue(value: unknown): string {
  return normalizeStyleValue(value, TYPOGRAPHIES, "book")
}

function normalizeStyleValue(value: unknown, vocabulary: Set<string>, fallback: string): string {
  const withoutComment = String(value ?? "").trim().replace(/\s+#.*$/, "").trim()
  const unquoted = withoutComment.match(/^(['"])(.*)\1$/)?.[2] ?? withoutComment
  return vocabulary.has(unquoted) ? unquoted : fallback
}

export function frontMatterHasKey(source: unknown, key: string): boolean | null {
  if (typeof source !== "string" || typeof key !== "string" || !key) {
    throw new TypeError("Front matter key lookup needs source text and a key.")
  }
  const front = initialFrontMatter(source)
  if (!front) return null
  const pattern = new RegExp(`^\\s*${key.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\s*:`)
  return front.lines.slice(1, front.closingLine).some(line => pattern.test(line.text))
}

export function readStyleOverrides(source: string): { theme: string | null; typography: string | null } {
  const frontMatter = initialFrontMatter(source)
  const read = (key: string, normalizer: (value: unknown) => string): string | null => {
    if (!frontMatter) return null
    for (const line of frontMatter.lines.slice(1, frontMatter.closingLine)) {
      const match = new RegExp(`^${key}\\s*:\\s*(.*)$`).exec(line.text)
      if (!match) continue
      const raw = match[1] ?? ""
      const normalized = normalizer(raw)
      const cleaned = raw.trim().replace(/\s+#.*$/, "").trim().replace(/^(['"])(.*)\1$/, "$2")
      return normalized === cleaned ? normalized : null
    }
    return null
  }
  return {
    theme: read("theme", normalizeThemeValue),
    typography: read("typography", normalizeTypographyValue)
  }
}

export function replaceFirstHeading(source: unknown, title: unknown): string {
  if (typeof source !== "string") throw new TypeError("The selected file did not contain readable text.")
  const normalizedTitle = String(title ?? "").replace(/[\r\n]/g, " ").trim().replace(/\s+/g, " ")
  const front = initialFrontMatter(source)
  const bodyStart = front?.bodyStart ?? 0
  let fence: FenceState | null = null
  for (const line of sourceLines(source)) {
    if (line.end <= bodyStart) continue
    const incoming = fenceMarker(line.text)
    if (fence) {
      if (incoming) fence = toggleFence(fence, incoming)
      continue
    }
    if (incoming) {
      fence = incoming
      continue
    }
    const heading = /^([ \t]{0,3}#)(?:[ \t]+|$)/.exec(line.text)
    if (!heading) continue
    const marker = heading[1] ?? ""
    const ending = source.slice(line.start + line.text.length, line.end)
    return source.slice(0, line.start) + `${marker} ${normalizedTitle}${ending}` + source.slice(line.end)
  }
  const body = source.slice(bodyStart)
  const prefix = source.slice(0, bodyStart)
  const eol = source.includes("\r\n") ? "\r\n" : source.includes("\r") ? "\r" : "\n"
  const separator = body.trim() ? eol + eol : ""
  return `${prefix}# ${normalizedTitle}${separator}${body}`
}

export function sourceAnchorLines(source: unknown): number[] {
  if (typeof source !== "string") throw new TypeError("The selected file did not contain readable text.")
  const front = initialFrontMatter(source)
  const bodyLine = front ? source.slice(0, front.bodyStart).split("\n").length : 1
  const rawLines = source.match(/[^\n]*\n?/g) ?? []
  const anchors: number[] = []
  rawLines.filter(part => part !== "").forEach((raw, index) => {
    const text = raw.replace(/[\r\n]+$/, "")
    if (index + 1 < bodyLine || !text.trim() || /^\s*:::/.test(raw)) return
    anchors.push(index + 1)
  })
  return anchors.length ? anchors : [bodyLine]
}

function isMarginSettingsKey(key: string): key is keyof MarginSettings {
  return key === "section" || key === "subsection" || key === "footnote" || key === "slide_count"
}

function marginSettings(source: string): MarginSettings {
  const settings: MarginSettings = { section: true, subsection: true, footnote: true, slide_count: true }
  const frontMatter = initialFrontMatter(source)
  if (!frontMatter) return settings
  let inSettings = false
  for (const line of frontMatter.lines.slice(1, frontMatter.closingLine).map(entry => entry.text)) {
    if (/^show-in-margin\s*:\s*$/.test(line)) {
      inSettings = true
    } else if (inSettings && /^\s+([A-Za-z][\w-]*)\s*:\s*(true|false)\s*$/.test(line)) {
      const match = /^\s+([A-Za-z][\w-]*)\s*:\s*(true|false)\s*$/.exec(line)
      const name = match?.[1] ?? ""
      const flag = match?.[2] ?? ""
      const key = name.replace(/-([a-z])/g, (_, letter: string) => `_${letter}`).replace(/[A-Z]/g, letter => `_${letter.toLowerCase()}`).replace(/^_/, "")
      if (isMarginSettingsKey(key)) settings[key] = flag === "true"
    } else if (/^\S/.test(line)) {
      inSettings = false
    }
  }
  return settings
}

function slideSourceRanges(source: string, bodyStart: number): SlideSourceRange[] {
  const ranges: SlideSourceRange[] = []
  let start = bodyStart
  let fence: FenceState | null = null
  let mathFence: string | null = null
  for (const line of sourceLines(source, bodyStart)) {
    const incomingFence = fenceMarker(line.text)
    if (fence) {
      fence = toggleFence(fence, incomingFence)
      continue
    }
    if (incomingFence) {
      fence = incomingFence
      continue
    }
    if (mathFence) {
      if (displayMathFenceMarker(line.text) === mathFence) mathFence = null
      continue
    }
    const openingMathFence = displayMathFenceOpener(line.text)
    if (openingMathFence) {
      mathFence = openingMathFence
      continue
    }
    if (/^---[ \t]*$/.test(line.text)) {
      ranges.push({ start, end: line.start, delimiterStart: line.start, delimiterEnd: line.end })
      start = line.end
    }
  }
  ranges.push({ start, end: source.length, delimiterStart: null, delimiterEnd: null })
  return ranges
}

interface PendingPosition {
  value: SourcePosition;
  directiveId: string;
  scoped: boolean;
}

function editorBlocks(
  source: string,
  start: number,
  end: number,
  slide: SlideMetadata,
  slideIndex: number,
  mode: string
): { blocks: MapBlock[]; directives: MapDirective[]; regions: MapRegion[] } {
  const lines = sourceLines(source, start, end)
  const blocks: MapBlock[] = []
  const directives: MapDirective[] = []
  const regions: MapRegion[] = []
  let current: SourceLine[] = []
  let pendingPosition: PendingPosition | null = null
  let fence: FenceState | null = null
  let mathFence: string | null = null

  const flush = (): void => {
    if (!current.length) return
    const first = current[0]
    const last = current.at(-1)
    if (!first || !last) return
    const blockStart = first.start
    const blockEnd = last.end
    const markdown = source.slice(blockStart, blockEnd).replace(/(?:\r\n|\r|\n)$/, "")
    const blockIndex = blocks.length
    const id = `slide-${slideIndex + 1}-block-${blockIndex + 1}`
    const kind = editableBlockKind(markdown)
    const range: SourceRange = { start: blockStart, end: blockEnd }
    const contentRange: SourceRange = { start: blockStart, end: blockStart + markdown.length }
    const block: MapBlock = {
      id,
      index: blockIndex,
      kind,
      markdown,
      position: pendingPosition?.value ?? null,
      position_directive_id: pendingPosition?.directiveId ?? null,
      position_scope: pendingPosition ? (pendingPosition.scoped ? "group" : "block") : null,
      range,
      source_range: { ...range },
      content_range: contentRange
    }
    const region = editableRegion(markdown, blockStart, id, slideIndex, blockIndex, kind, slide, mode)
    block.editable_region_id = region.id
    blocks.push(block)
    regions.push(region)
    current = []
    if (pendingPosition && !pendingPosition.scoped) pendingPosition = null
  }

  lines.forEach((line, lineIndex) => {
    const incomingFence = fenceMarker(line.text)
    if (fence) {
      current.push(line)
      fence = toggleFence(fence, incomingFence)
      return
    }
    if (incomingFence) {
      current.push(line)
      fence = incomingFence
      return
    }
    if (mathFence) {
      current.push(line)
      if (displayMathFenceMarker(line.text) === mathFence) mathFence = null
      return
    }
    const openingMathFence = displayMathFenceOpener(line.text)
    if (openingMathFence) {
      current.push(line)
      mathFence = openingMathFence
      return
    }
    if (!line.text.trim()) {
      flush()
      return
    }
    if (/^\s*:::/.test(line.text)) {
      flush()
      const text = line.text.trim()
      const directive = editorDirective(line, text, slideIndex, directives.length)
      directives.push(directive)
      const position = positionFromBlock(text)
      if (position) {
        pendingPosition = {
          value: position,
          directiveId: directive.id,
          scoped: positionScopeCloses(lines, lineIndex)
        }
      } else if (text === ":::" && pendingPosition) {
        pendingPosition = null
      }
      return
    }
    current.push(line)
  })
  flush()
  if (mode === "document") directives.forEach(directive => { directive.scope = "document" })
  return { blocks, directives, regions }
}

function editorDirective(line: SourceLine, text: string, slideIndex: number, directiveIndex: number): MapDirective {
  const position = /^:::(align|position)[ \t]*\{([^}]*)\}/.exec(text)
  const margin = /^:::(section|subsection|footnote)\{/.exec(text)
  const type = text === ":::" ? "position_close" : position ? "position" : margin?.[1] ?? "unknown"
  const range: SourceRange = { start: line.start, end: line.end }
  return {
    id: `slide-${slideIndex + 1}-directive-${directiveIndex + 1}`,
    type,
    value: position?.[2]?.trim() ?? null,
    text,
    range,
    source_range: { ...range },
    editable: type === "position"
  }
}

function positionScopeCloses(lines: SourceLine[], startIndex: number): boolean {
  let fence: FenceState | null = null
  for (const line of lines.slice(startIndex + 1)) {
    const incoming = fenceMarker(line.text)
    if (fence) {
      fence = toggleFence(fence, incoming)
      continue
    }
    if (incoming) {
      fence = incoming
      continue
    }
    if (line.text.trim() === ":::") return true
    if (/^\s*:::(?:align|position)[ \t]*\{/.test(line.text)) return false
  }
  return false
}

function editableRegion(
  markdown: string,
  blockStart: number,
  blockId: string,
  slideIndex: number,
  blockIndex: number,
  kind: string,
  slide: SlideMetadata,
  mode: string
): MapRegion {
  const id = `slide-${slideIndex + 1}-region-${blockIndex + 1}`
  const editable = clientCanRoundTrip(markdown, kind)
  const heading = /^(\s{0,3})(#+)(\s+)(.+?)(\s*#*\s*)$/s.exec(markdown)
  if (heading) {
    const contentStart = blockStart + (heading[1] ?? "").length + (heading[2] ?? "").length + (heading[3] ?? "").length
    const contentEnd = contentStart + (heading[4] ?? "").length
    const range: SourceRange = { start: blockStart, end: blockStart + markdown.length }
    return {
      id,
      block_id: blockId,
      role: (mode === "document" && blockIndex === 0) || slide.title === markdown ? "title" : "heading",
      kind: "heading",
      text: (heading[4] ?? "").trim(),
      range,
      source_range: { ...range },
      content_range: { start: contentStart, end: contentEnd },
      editable
    }
  }
  const emptyHeading = /^(\s{0,3}#)[ \t]*$/.exec(markdown)
  if (emptyHeading) {
    const offset = blockStart + (emptyHeading[0] ?? "").length
    const range: SourceRange = { start: blockStart, end: blockStart + markdown.length }
    return {
      id,
      block_id: blockId,
      role: "title",
      kind: "heading",
      text: "",
      range,
      source_range: { ...range },
      content_range: { start: offset, end: offset },
      editable,
      empty_heading: true
    }
  }
  const range: SourceRange = { start: blockStart, end: blockStart + markdown.length }
  return {
    id,
    block_id: blockId,
    role: "block",
    kind,
    text: markdown,
    range,
    source_range: { ...range },
    content_range: { ...range },
    editable
  }
}

function emptyEditorBlocks(source: string, slideIndex: number, blocks: MapBlock[]): Array<[MapBlock, MapRegion]> {
  const placeholders: Array<[MapBlock, MapRegion]> = []
  let sequence = 0
  for (const [index, previous] of blocks.slice(0, -1).entries()) {
    const following = blocks[index + 1]
    if (!following) continue
    const start = previous.content_range.end
    const end = following.range.start
    const separator = source.slice(start, end)
    if (!/^[ \t]*(?:(?:\r\n|\r|\n)[ \t]*)*$/.test(separator)) continue
    const endings = separator.match(/\r\n|\r|\n/g) || []
    const emptyCount = Math.max(Math.floor(endings.length / 2) - 1, 0)
    let offset = start
    for (let emptyIndex = 1; emptyIndex <= emptyCount; emptyIndex += 1) {
      offset = start + endings.slice(0, emptyIndex * 2).join("").length
      sequence += 1
      placeholders.push(emptyEditorBlock(slideIndex, sequence, offset))
    }
  }
  const trailing = source.match(/(?:\r\n|\r|\n)+$/)?.[0] ?? ""
  const endings = trailing.match(/\r\n|\r|\n/g) || []
  const trailingCount = Math.floor(endings.length / 2)
  const trailingStart = source.length - trailing.length
  for (let emptyIndex = 1; emptyIndex <= trailingCount; emptyIndex += 1) {
    const offset = trailingStart + endings.slice(0, emptyIndex * 2).join("").length
    sequence += 1
    placeholders.push(emptyEditorBlock(slideIndex, sequence, offset))
  }
  return placeholders
}

function emptyEditorBlock(slideIndex: number, sequence: number, offset: number): [MapBlock, MapRegion] {
  const blockId = `slide-${slideIndex + 1}-empty-${sequence}`
  const regionId = `slide-${slideIndex + 1}-empty-region-${sequence}`
  const range: SourceRange = { start: offset, end: offset }
  return [{
    id: blockId,
    index: sequence,
    kind: "paragraph",
    markdown: "",
    range: { ...range },
    source_range: { ...range },
    content_range: { ...range },
    editable_region_id: regionId,
    empty_placeholder: true
  }, {
    id: regionId,
    block_id: blockId,
    role: "block",
    kind: "paragraph",
    text: "",
    range: { ...range },
    source_range: { ...range },
    content_range: { ...range },
    editable: true,
    empty_placeholder: true
  }]
}

function editableBlockKind(markdown: string): string {
  if (headingFor(markdown) || /^\s{0,3}#[ \t]*$/.test(markdown)) return "heading"
  if (fencedCodeSource(markdown) || /^ {4}|^\t/.test(markdown)) return "code"
  if (imageBlock(markdown)) return "image"
  if (tableBlock(markdown)) return "table"
  if (/^\s*(?:[-*+] |\d+[.)] )/.test(markdown)) return "list"
  if (/^\s*>/.test(markdown)) return "quote"
  if (/^\s*(?:-{3,}|\*{3,}|_{3,})\s*$/.test(markdown)) return "rule"
  return "paragraph"
}

function clientCanRoundTrip(markdown: string, kind: string): boolean {
  if (kind === "code" && /^\s{0,3}(?:`{3,}|~{3,})[ \t]*mermaid\b/i.test(markdown)) return false
  if (kind === "code" && fencedCodeSource(markdown)) return supportedFencedCode(markdown)
  if (kind === "code" || kind === "rule") return false
  if (kind === "heading" && sourceLines(markdown).length !== 1) return false
  if (kind === "table" && !supportedTable(markdown)) return false
  if (kind === "quote" && sourceLines(markdown).some(line => /^[ \t]*>[ \t]*>/.test(line.text))) return false
  if (kind !== "image" && /!\[[^\]]*\]\(elef-asset:[0-9a-f]{64}(?:\s+[^)]*)?\)/.test(markdown)) return false
  if (/^[^\r\n]+\r?\n[=-]{3,}[ \t]*$/.test(markdown)) return false
  return !unsupportedBlockSyntax(markdown)
}

function supportedFencedCode(markdown: string): boolean {
  const match = /^([ \t]*)(`{3,}|~{3,})([^\r\n]*?)(\r\n|\n|\r)([\s\S]*?)(\r\n|\n|\r)([`~]{3,})([ \t]*)$/.exec(markdown)
  if (!match) return false
  const opener = match[2] ?? ""
  const closer = match[7] ?? ""
  return opener.length > 0 && closer.length >= opener.length && closer[0] === opener[0] &&
    [...closer].every(char => char === opener[0])
}

function supportedTable(markdown: string): boolean {
  const lines = markdown.split(/\r?\n/)
  const second = lines[1] ?? ""
  if (lines.length < 3 || !/^\s*\|?\s*:?-{3,}:?\s*(?:\|\s*:?-{3,}:?\s*)*\|?\s*$/.test(second)) return false
  const columns = tableCellCount(lines[0] ?? "")
  return columns > 0 && tableCellCount(second) === columns && lines.slice(2).every(line => Boolean(line.trim()) && tableCellCount(line) === columns)
}

function tableCellCount(line: string): number {
  const value = line.trim()
  const pipes: number[] = []
  let escaped = false
  for (let index = 0; index < value.length; index += 1) {
    if (value[index] === "\\" && !escaped) {
      escaped = true
      continue
    }
    if (value[index] === "|" && !escaped) pipes.push(index)
    escaped = false
  }
  const leading = pipes[0] === 0 ? 1 : 0
  const trailing = pipes.at(-1) === value.length - 1 ? 1 : 0
  return Math.max(pipes.length - leading - trailing + 1, 0)
}

function unsupportedBlockSyntax(markdown: string): boolean {
  if (/<\s*!--|--\s*>|<\/?[A-Za-z][^>]*>/.test(markdown)) return true
  if (/<\s*(?:https?:\/\/|mailto:)[^>]+>|<\s*[^<>\s@]+@[^<>\s@]+\s*>/i.test(markdown)) return true
  if (/\[[^\]]+\]\s*\[[^\]]*\]|^\s*\[[^\]]+\]:|\[\^[^\]]+\]/m.test(markdown)) return true
  if (/&(?:[A-Za-z][A-Za-z0-9]+|#\d+|#x[0-9A-Fa-f]+);/.test(markdown)) return true
  if (/\]\([^)]*\(/.test(markdown)) return true
  if (/[A-Za-z0-9][_*]{1,2}[^\s*_]+?[*_]{1,2}[A-Za-z0-9]/.test(markdown)) return true
  if (sourceLines(markdown).some(line => /(?: {2,}|\\)\r?$/.test(line.text))) return true
  return unsupportedEscapedPunctuation(markdown)
}

function unsupportedEscapedPunctuation(markdown: string): boolean {
  const withoutMath = displayMathFenceSource(markdown)
    ? ""
    : markdown.replace(/(?<!\\)\$\$[\s\S]+?\$\$(?!\$)|(?<![\\$])\$(?!\$|\s)[^$\r\n]+?(?<!\s)\$(?!\$)/g, "")
  for (let index = 0; index < withoutMath.length; index += 1) {
    if (withoutMath[index] !== "\\") continue
    const next = withoutMath[index + 1]
    if (next === undefined || next === "$" || /[A-Za-z0-9_\s]/.test(next)) continue
    return true
  }
  return false
}

function slideMetadata(markdown: string, context: MarginContext, mode: string): SlideMetadata {
  let normalized = markdown.replace(/\r\n?/g, "\n")
  const margin = mode === "presentation"
    ? parseMarginDirectives(normalized, context)
    : { content: normalized, section: null, subsection: null, footnote: null, warnings: [] as string[] }
  normalized = margin.content
  const parsed = parseBlocks(normalized)
  const layout = inferLayout(parsed.blocks)
  const title = ["two-column", "three-column"].includes(layout) ? parsed.blocks[0]?.markdown ?? null : null
  const regions = columnRegions(parsed.blocks, layout)
  return {
    layout,
    title,
    blocks: parsed.blocks,
    regions,
    section: margin.section,
    subsection: margin.subsection,
    footnote: margin.footnote,
    warnings: [...margin.warnings, ...parsed.warnings]
  }
}

type MarginKind = "section" | "subsection" | "footnote"

interface MarginDirectiveNote {
  type: MarginKind;
  malformed: boolean;
  value: string;
}

interface MarginParse {
  content: string;
  section: string | null;
  subsection: string | null;
  footnote: string | null;
  warnings: string[];
}

function parseMarginDirectives(markdown: string, context: MarginContext): MarginParse {
  const lines = markdown.split("\n")
  const content: string[] = []
  const warnings: string[] = []
  let leading = true
  let fence: FenceState | null = null
  let mathFence: string | null = null
  let footnote: string | null = null
  lines.forEach((line, index) => {
    const incoming = fenceMarker(line)
    if (fence) {
      content.push(line)
      fence = toggleFence(fence, incoming)
      return
    }
    if (incoming) {
      content.push(line)
      fence = incoming
      leading = false
      return
    }
    if (mathFence) {
      if (displayMathFenceMarker(line) === mathFence) mathFence = null
      content.push(line)
      return
    }
    const opening = displayMathFenceOpener(line)
    if (opening) {
      mathFence = opening
      content.push(line)
      leading = false
      return
    }
    const directive = marginDirective(line)
    if (directive) {
      if (directive.malformed) {
        warnings.push(`Malformed ${directive.type} margin directive was removed.`)
      } else if (directive.type === "footnote") {
        if (lines.slice(index + 1).every(following => !following.trim())) footnote = directive.value
        else warnings.push("Footnote margin directive must appear at the end of a slide.")
      } else if (leading) {
        context[directive.type] = directive.value
      } else {
        warnings.push(`${directive.type[0]?.toUpperCase() ?? ""}${directive.type.slice(1)} margin directive must appear at the beginning of a slide.`)
      }
      return
    }
    if (line.trim()) leading = false
    content.push(line)
  })
  return { content: content.join("\n"), section: context.section, subsection: context.subsection, footnote, warnings }
}

function isMarginKind(value: string): value is MarginKind {
  return value === "section" || value === "subsection" || value === "footnote"
}

function marginDirective(line: string): MarginDirectiveNote | null {
  const match = /^\s*:::(section|subsection|footnote)\{/.exec(line)
  if (!match) return null
  const kind = match[1] ?? ""
  if (!isMarginKind(kind)) return null
  const chars = [...line.slice(match[0].length)]
  const value: string[] = []
  let depth = 1
  for (let index = 0; index < chars.length; index += 1) {
    const character = chars[index]
    if (character === undefined) continue
    const next = chars[index + 1]
    if (character === "\\" && (next === "{" || next === "}" || next === "\\")) {
      value.push(next)
      index += 1
    } else if (character === "{") {
      depth += 1
      value.push(character)
    } else if (character === "}") {
      depth -= 1
      if (depth === 0) {
        return chars.slice(index + 1).join("").trim()
          ? { type: kind, malformed: true, value: "" }
          : { type: kind, malformed: false, value: value.join("").trim() }
      }
      value.push(character)
    } else {
      value.push(character)
    }
  }
  return { type: kind, malformed: true, value: "" }
}

function parseBlocks(markdown: string): { blocks: ParsedBlock[]; warnings: string[] } {
  const rawBlocks = markdownBlocks(markdown)
  const blocks: ParsedBlock[] = []
  const warnings: string[] = []
  for (let index = 0; index < rawBlocks.length;) {
    const block = rawBlocks[index]
    if (block === undefined) {
      index += 1
      continue
    }
    const position = positionFromBlock(block)
    const following = rawBlocks[index + 1]
    if (position) {
      const closingOffset = rawBlocks.slice(index + 1).indexOf(":::")
      if (closingOffset >= 0) {
        const closing = index + 1 + closingOffset
        for (const grouped of rawBlocks.slice(index + 1, closing)) if (grouped) blocks.push({ markdown: grouped, position })
        index = closing + 1
      } else if (following !== undefined) {
        blocks.push({ markdown: following, position })
        index += 2
      } else {
        warnings.push("Alignment directive has no following Markdown block.")
        index += 1
      }
    } else if (block === ":::" || block.startsWith(":::")) {
      warnings.push("Unknown or malformed presentation directive was removed.")
      index += 1
    } else {
      blocks.push({ markdown: block, position: null })
      index += 1
    }
  }
  return { blocks, warnings }
}

function markdownBlocks(markdown: string): string[] {
  const blocks: string[] = []
  let current: string[] = []
  let fence: FenceState | null = null
  let mathFence: string | null = null
  for (const line of markdown.split("\n")) {
    const incoming = fenceMarker(line)
    if (fence) fence = toggleFence(fence, incoming)
    else if (incoming) fence = incoming
    if (!fence && mathFence) {
      if (displayMathFenceMarker(line) === mathFence) mathFence = null
      current.push(line)
      continue
    }
    if (!fence) {
      const opening = displayMathFenceOpener(line)
      if (opening) mathFence = opening
    }
    if (!fence && !mathFence && /^\s*:::/.test(line)) {
      if (current.length) blocks.push(current.join("\n"))
      blocks.push(line.trim())
      current = []
    } else if (!line.trim() && !fence && !mathFence) {
      if (current.length) blocks.push(current.join("\n"))
      current = []
    } else {
      current.push(line)
    }
  }
  if (current.length) blocks.push(current.join("\n"))
  return blocks
}

function positionFromBlock(block: string): SourcePosition | null {
  const match = /^\s*:::(align|position)[ \t]*\{([^}]*)\}\s*$/.exec(block)
  if (!match) return null
  const kind = match[1] ?? ""
  const values = (match[2] ?? "").split(/\s+/).filter(Boolean).map(value => value.toLowerCase())
  const horizontalWords = POSITION_VOCABULARY.horizontal
  const verticalWords = POSITION_VOCABULARY.vertical
  let horizontal = values.find(value => horizontalWords.includes(value))
  let vertical = values.find(value => verticalWords.includes(value))
  const first = values[0]
  const second = values[1]
  if (kind === "align" && values.length === 2 && first !== undefined && second !== undefined &&
    (first === "center" || verticalWords.includes(first)) && horizontalWords.includes(second)) {
    horizontal = second
    vertical = first === "center" ? "middle" : first
  }
  if (!horizontal && !vertical) return null
  return { horizontal: horizontal || "left", vertical: vertical || "top", vertical_explicit: Boolean(vertical) }
}

function inferLayout(blocks: ParsedBlock[]): string {
  const meaningful = blocks.filter(block => block.markdown.trim())
  if (!meaningful.length) return "body"
  const first = meaningful[0]
  if (!first) return "body"
  if (meaningful.length === 1 && imageBlock(first.markdown)) return "image"
  if (headingFor(first.markdown)?.level === 1) {
    const following = meaningful.slice(1)
    const headings = following.map(block => headingFor(block.markdown)).filter((heading): heading is { level: number; text: string } => heading !== null)
    const firstHeadingIndex = following.findIndex(block => headingFor(block.markdown))
    const levels = headings.map(heading => heading.level)
    if (headings.length >= 2 && headings.length <= 3 && firstHeadingIndex === 0 && new Set(levels).size === 1 && (levels[0] ?? 0) > 1) {
      return headings.length === 2 ? "two-column" : "three-column"
    }
  }
  const contentBlocks = headingFor(first.markdown)?.level === 1 ? meaningful.slice(1) : null
  if (contentBlocks?.length === 1) {
    const only = contentBlocks[0]
    if (!only) return "body"
    const content = only.markdown
    if (imageBlock(content)) return "image"
    if (tableBlock(content)) return "table"
    if (codeBlock(content)) return "code"
    if (!/^\s*(?:[-*+] |\d+[.)] |> |!\[|\||`{3,}|~{3,})/.test(content)) return "statement"
  }
  return "body"
}

function columnRegions(blocks: ParsedBlock[], layout: string): ParsedBlock[][] {
  if (!["two-column", "three-column"].includes(layout)) return [blocks]
  const regions: ParsedBlock[][] = []
  for (const block of blocks.slice(1)) {
    if (headingFor(block.markdown)) regions.push([])
    if (regions.length) {
      const current = regions.at(-1)
      if (current) current.push(block)
    }
  }
  return regions
}

function headingFor(markdown: string): { level: number; text: string } | null {
  const first = sourceLines(markdown)[0]?.text ?? ""
  const match = /^\s{0,3}(#+)\s+(.+?)\s*#*\s*$/.exec(first)
  if (!match) return null
  return { level: (match[1] ?? "").length, text: (match[2] ?? "").trim() }
}

function imageBlock(markdown: string): boolean {
  return /^\s*!\[[^\]]*\]\([^\)]+\)\s*$/s.test(markdown)
}

function tableBlock(markdown: string): boolean {
  const lines = sourceLines(markdown).map(line => line.text)
  return lines.length >= 2 && (lines[0] ?? "").includes("|") && /^\s*\|?\s*:?-{3,}/.test(lines[1] ?? "")
}

function codeBlock(markdown: string): boolean {
  const lines = sourceLines(markdown).map(line => line.text)
  const opening = /^\s*([`~]{3,})/.exec(lines[0] ?? "")
  const closing = /^\s*([`~]{3,})\s*$/.exec(lines.at(-1) ?? "")
  const openMark = opening?.[1] ?? ""
  const closeMark = closing?.[1] ?? ""
  return openMark.length > 0 && closeMark.length >= openMark.length && openMark[0] === closeMark[0]
}

function fencedCodeSource(markdown: string): boolean {
  return Boolean(fenceMarker(sourceLines(markdown)[0]?.text ?? ""))
}

function displayMathFenceMarker(line: string): string | null {
  return /^[ \t]{0,3}(\$\$|\\\[|\\\])[ \t]*$/.exec(line)?.[1] ?? null
}

function displayMathFenceOpener(line: string): string | null {
  const marker = displayMathFenceMarker(line)
  return marker === "$$" ? "$$" : marker === "\\[" ? "\\]" : null
}

function displayMathFenceSource(markdown: string): boolean {
  const lines = markdown.split(/\r\n|\r|\n/)
  const opener = displayMathFenceOpener(lines[0] ?? "")
  return Boolean(opener && (lines.length === 1 || displayMathFenceMarker(lines.at(-1) ?? "") === opener))
}

function fenceMarker(line: string): FenceState | null {
  const match = /^\s{0,3}(`{3,}|~{3,})(.*)$/.exec(line)
  if (!match) return null
  const run = match[1] ?? ""
  const rest = match[2] ?? ""
  return { marker: run[0] ?? "", length: run.length, closing: /^[ \t]*$/.test(rest) }
}

function toggleFence(current: FenceState | null, incoming: FenceState | null): FenceState | null {
  if (!current) return incoming
  if (incoming && incoming.marker === current.marker && incoming.length >= current.length && incoming.closing) return null
  return current
}

function normalizeSection(value: string): string {
  return value.replace(/^\n/, "").replace(/\n$/, "")
}

function sourceLines(source: string, start = 0, end = source.length): SourceLine[] {
  const lines: SourceLine[] = []
  let cursor = start
  while (cursor < end) {
    let newline = cursor
    while (newline < end && source[newline] !== "\n" && source[newline] !== "\r") newline += 1
    let lineEnd = newline
    if (newline < end) lineEnd += source[newline] === "\r" && source[newline + 1] === "\n" ? 2 : 1
    lines.push({ start: cursor, end: lineEnd, text: source.slice(cursor, newline) })
    cursor = lineEnd
  }
  return lines
}
