import { ART_DIAGNOSTICS, analyzeArtList, resolveArtBindings, type ArtBindings, type ArtBoundaryMap, type ArtDiagnostic, type ArtListAnalysis } from "./art_source.js"
import { parseAlignment } from "./document_transforms.js"
import { slidePositionLayout } from "./slide_position_layout.js"
import { POSITION_VOCABULARY, THEMES, TYPOGRAPHIES, initialFrontMatter, normalizeThemeValue, normalizeTypographyValue, sourceLines, type SourceLine } from "./style_vocab.js"

// Style vocabulary + front-matter read/write live in style_vocab.ts
// (dependency-free micro-entry); re-exported here so existing
// document-map importers keep working.
export {
  MARGIN_SETTING_KEYS,
  METADATA_BOOLEAN_VALUES,
  METADATA_TOP_LEVEL_KEYS,
  POSITION_VOCABULARY,
  PRESENTATION_THEMES,
  THEME_VALUES,
  TYPOGRAPHY_VALUES,
  buildNewWorkSource,
  frontMatterHasKey,
  initialFrontMatter,
  metadataValueChoices,
  normalizeThemeValue,
  normalizeTypographyValue,
  presentationTheme,
  withAppearanceValue,
  withFrontMatterValue
} from "./style_vocab.js"
export type { FrontMatter, PresentationTheme, SourceLine } from "./style_vocab.js"

export interface SourceRange {
  start: number;
  end: number;
}

export interface SourcePosition {
  horizontal: string;
  vertical: string;
  vertical_explicit: boolean;
}

export interface MapBlockArt {
  directive_id: string;
  source_range: SourceRange;
}

export interface MapBlock {
  id: string;
  index: number;
  kind: string;
  markdown: string;
  position?: SourcePosition | null;
  position_directive_id?: string | null;
  art?: MapBlockArt;
  reveal_event?: number;
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
  art_diagnostic?: string | null;
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

export interface MapArtDiagnostic extends ArtDiagnostic {
  slide_id: string;
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
  art_diagnostics?: MapArtDiagnostic[];
  reveal_event_count?: number;
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
  art_diagnostics?: MapArtDiagnostic[];
  editable_regions: MapRegion[];
}

export interface ParsedBlock {
  markdown: string;
  position: SourcePosition | null;
  art?: { directive_id: string } & Partial<ArtListAnalysis>;
  reveal_event?: number;
}

export interface SlideMetadata {
  layout: string;
  title: string | null;
  blocks: ParsedBlock[];
  reveal_event_count: number;
  art_diagnostics: ArtDiagnostic[];
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
    const sectionSource = source.slice(range.start, range.end)
    const normalizedSection = sectionSource.replace(/\r\n?/g, "\n")
    const idPrefix = `slide-${index + 1}-art`
    const artResolution = resolveArtBindings(sectionSource, { idPrefix })
    const boundaryMap = artResolution.boundary_map
    const metadata = slideMetadata(normalizedSection, context, mode, artResolution, boundaryMap)
    const result = editorBlocks(source, range.start, range.end, metadata, index, mode, artResolution, boundaryMap)
    let blocks = result.blocks
    let regions = result.regions
    // Both modes edit empty paragraphs (Enter opens one): placeholders
    // carry empty_placeholder so read-only surfaces can skip them.
    const empty = emptyEditorBlocks(source, index, blocks)
    blocks = [...blocks, ...empty.map(([block]) => block)].sort((left, right) => left.range.start - right.range.start)
    regions = [...regions, ...empty.map(([, region]) => region)]
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
      art_diagnostics: artResolution.diagnostics.map((diagnostic): MapArtDiagnostic => ({
        ...diagnostic,
        slide_id: `slide-${index + 1}`,
        source_range: {
          start: range.start + diagnostic.source_range.start,
          end: range.start + diagnostic.source_range.end
        }
      })),
      editable_regions: regions
    }
    if (metadata.reveal_event_count > 0) slideMap.reveal_event_count = metadata.reveal_event_count
    map.slides.push(slideMap)
    map.directives.push(...result.directives)
    if (slideMap.art_diagnostics?.length) {
      map.art_diagnostics = [...(map.art_diagnostics ?? []), ...slideMap.art_diagnostics]
    }
    map.editable_regions.push(...regions)
    parsedSlides.push({ ...metadata, map: slideMap })
    warnings.push(...metadata.warnings)
    for (const diagnostic of slideMap.art_diagnostics ?? []) warnings.push(artDiagnosticMessage(diagnostic.code))
    if (!slideMap.art_diagnostics?.length) delete slideMap.art_diagnostics
  })

  return {
    editorMap: map,
    slides: parsedSlides,
    warnings,
    style: readStyle(source),
    marginSettings: marginSettings(source)
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
      if (displayMathFenceCloser(line.text, mathFence)) mathFence = null
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
}

function editorBlocks(
  source: string,
  start: number,
  end: number,
  slide: SlideMetadata,
  slideIndex: number,
  mode: string,
  artResolution: ArtBindings,
  sourceBoundaryMap: ArtBoundaryMap
): { blocks: MapBlock[]; directives: MapDirective[]; regions: MapRegion[] } {
  const lines = sourceLines(source, start, end)
  const artBindings = indexArtBindings(artResolution.bindings, lines.length, start)
  const artDirectivesByLine = new Map(artResolution.directives.map((directive) => [directive.line, directive]))
  const boundaryMap = {
    blockStarts: new Set(sourceBoundaryMap.blockStarts),
    blockEnds: new Set(sourceBoundaryMap.blockEnds),
    directiveLines: new Set(sourceBoundaryMap.directiveLines),
    blankLines: new Set(sourceBoundaryMap.blankLines)
  }
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
      range,
      source_range: { ...range },
      content_range: contentRange
    }
    const revealEvent = slide.blocks[blockIndex]?.reveal_event
    if (revealEvent !== undefined) block.reveal_event = revealEvent
    const artBinding = artBindings.byTargetStart.get(blockStart)
    if (artBinding) {
      block.art = {
        directive_id: artBinding.directive_id,
        source_range: {
          start: start + artBinding.directive_range.start,
          end: start + artBinding.directive_range.end
        }
      }
    }
    const region = editableRegion(markdown, blockStart, id, slideIndex, blockIndex, kind, slide, mode)
    block.editable_region_id = region.id
    blocks.push(block)
    regions.push(region)
    current = []
    pendingPosition = null
  }

  lines.forEach((line, lineIndex) => {
    if (boundaryMap.blockStarts.has(lineIndex) && current.length) flush()
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
      if (displayMathFenceCloser(line.text, mathFence)) {
        mathFence = null
        if (boundaryMap.blockEnds.has(lineIndex + 1)) flush()
      }
      return
    }
    const openingMathFence = displayMathFenceOpener(line.text)
    if (openingMathFence) {
      current.push(line)
      mathFence = openingMathFence
      return
    }
    if (boundaryMap.blankLines.has(lineIndex)) {
      const artBinding = artBindings.byLine[lineIndex]
      if (artBinding && lineIndex + 1 < artBinding.target_lines.end) current.push(line)
      else flush()
      return
    }
    if (boundaryMap.directiveLines.has(lineIndex)) {
      flush()
      const text = line.text.trim()
      const artDirective = artDirectivesByLine.get(lineIndex)
      const directive = editorDirective(line, text, slideIndex, directives.length, mode)
      if (artDirective) {
        directive.id = artDirective.id
        directive.type = artDirective.type === "art" ? "art" : "art_invalid"
        directive.art_diagnostic = artDirective.type === "art_invalid" ? ART_DIAGNOSTICS.INVALID_SYNTAX : null
      }
      directives.push(directive)
      const position = positionFromBlock(text)
      if (position) {
        pendingPosition = {
          value: position,
          directiveId: directive.id
        }
      }
      return
    }
    current.push(line)
    if (boundaryMap.blockEnds.has(lineIndex + 1)) flush()
  })
  flush()
  if (mode === "document") directives.forEach(directive => { directive.scope = "document" })
  return { blocks, directives, regions }
}

function indexArtBindings(
  bindings: ArtBindings["bindings"],
  lineCount: number,
  sourceOffset = 0
): { byLine: Array<ArtBindings["bindings"][number] | undefined>; byTargetStart: Map<number, ArtBindings["bindings"][number]> } {
  const byLine: Array<ArtBindings["bindings"][number] | undefined> = new Array(lineCount)
  const byTargetStart = new Map<number, ArtBindings["bindings"][number]>()
  for (const binding of bindings) {
    byTargetStart.set(sourceOffset + binding.target_range.start, binding)
    const start = Math.max(0, binding.target_lines.start)
    const end = Math.min(lineCount, binding.target_lines.end)
    for (let line = start; line < end; line += 1) byLine[line] = binding
  }
  return { byLine, byTargetStart }
}

interface StepDirectiveResult {
  kind: "step" | "malformed" | "indented_code"
  label?: string | null
}

function editorDirective(line: SourceLine, text: string, slideIndex: number, directiveIndex: number, mode: string): MapDirective {
  const step = mode === "presentation" ? stepDirective(line.text) : null
  const position = /^:::(align|position)[ \t]*\{([^}]*)\}/.exec(text)
  const margin = /^:::(section|subsection|footnote)\{/.exec(text)
  const type = step?.kind === "step" ? "step" : step?.kind === "malformed" ? "malformed_step" : position ? "position" : margin?.[1] ?? "unknown"
  const range: SourceRange = { start: line.start, end: line.end }
  return {
    id: `slide-${slideIndex + 1}-directive-${directiveIndex + 1}`,
    type,
    value: step?.kind === "step" ? (step.label ?? null) : position?.[2]?.trim() ?? null,
    text,
    range,
    source_range: { ...range },
    editable: type === "position"
  }
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

function slideMetadata(
  markdown: string,
  context: MarginContext,
  mode: string,
  artResolution: ArtBindings,
  sourceBoundaryMap: ArtBoundaryMap
): SlideMetadata {
  let normalized = markdown.replace(/\r\n?/g, "\n")
  const reveals = resolveRevealGroups(normalized, mode, artResolution)
  const margin = mode === "presentation"
    ? parseMarginDirectives(normalized, context, sourceBoundaryMap)
    : { content: normalized, section: null, subsection: null, footnote: null, warnings: [] as string[] }
  normalized = margin.content
  const lines = normalized.split("\n")
  for (const directive of artResolution.directives) {
    if (directive.type === "art" || directive.type === "art_invalid") lines[directive.line] = ""
  }
  for (const line of reveals.directive_lines) lines[line] = ""
  const parsed = parseBlocks(lines.join("\n"), artResolution, sourceBoundaryMap, reveals)
  const layout = inferLayout(parsed.blocks)
  const title = ["two-column", "three-column"].includes(layout) ? parsed.blocks[0]?.markdown ?? null : null
  const regions = columnRegions(parsed.blocks, layout)
  const placementWarnings = mode === "presentation"
    ? (["two-column", "three-column"].includes(layout) ? regions : [parsed.blocks])
      .flatMap(blocks => slidePositionLayout(blocks).warnings)
    : []
  return {
    layout,
    title,
    blocks: parsed.blocks,
    reveal_event_count: parsed.reveal_event_count ?? 0,
    art_diagnostics: artResolution.diagnostics,
    regions,
    section: margin.section,
    subsection: margin.subsection,
    footnote: margin.footnote,
    warnings: [...margin.warnings, ...reveals.warnings, ...parsed.warnings, ...placementWarnings]
  }
}

type MarginKind = "section" | "subsection" | "footnote"

interface MarginDirectiveNote {
  type: MarginKind;
  malformed?: boolean;
  value?: string;
}

interface MarginParse {
  content: string;
  section: string | null;
  subsection: string | null;
  footnote: string | null;
  warnings: string[];
}

function parseMarginDirectives(markdown: string, context: MarginContext, sourceBoundaryMap: ArtBoundaryMap): MarginParse {
  const lines = markdown.split("\n")
  const directiveLines = new Set(sourceBoundaryMap.directiveLines)
  const blankLines = new Set(sourceBoundaryMap.blankLines)
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
      if (displayMathFenceCloser(line, mathFence)) mathFence = null
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
    const directive = directiveLines.has(index) ? marginDirective(line) : null
    if (directive) {
      content.push("")
      if (directive.malformed) {
        warnings.push(`Malformed ${directive.type} margin directive was removed.`)
      } else if (directive.type === "footnote") {
        if (lines.slice(index + 1).every((_following, offset) => blankLines.has(index + 1 + offset))) footnote = directive.value ?? null
        else warnings.push("Footnote margin directive must appear at the end of a slide.")
      } else if (leading) {
        context[directive.type] = directive.value ?? null
      } else {
        warnings.push(`${directive.type[0]?.toUpperCase() ?? ""}${directive.type.slice(1)} margin directive must appear at the beginning of a slide.`)
      }
      return
    }
    if (!blankLines.has(index)) leading = false
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
      if (next !== undefined) value.push(next)
      index += 1
    } else if (character === "{") {
      depth += 1
      value.push(character)
    } else if (character === "}") {
      depth -= 1
      if (depth === 0) {
        return chars.slice(index + 1).join("").trim()
          ? { type: kind, malformed: true }
          : { type: kind, value: value.join("").trim() }
      }
      value.push(character)
    } else {
      value.push(character)
    }
  }
  return { type: kind, malformed: true }
}

interface RawMarkdownBlock {
  markdown: string
  startLine: number
  endLine: number
}

interface RevealGroups {
  event_by_line: Record<number, number>
  event_count: number
  directive_lines: Array<number>
  warnings: Array<string>
  lines: Array<string>
}

function parseBlocks(
  markdown: string,
  artResolution: ArtBindings,
  sourceBoundaryMap: ArtBoundaryMap,
  reveals: RevealGroups
): { blocks: ParsedBlock[]; warnings: string[]; reveal_event_count: number } {
  const rawBlocks = markdownBlocks(markdown, artResolution, sourceBoundaryMap)
  if (reveals?.directive_lines.length) return parseBlocksWithReveals(rawBlocks, artResolution, reveals)

  return parseBlocksPlain(rawBlocks, artResolution)
}

function parseBlocksPlain(
  rawBlocks: Array<RawMarkdownBlock>,
  artResolution: ArtBindings
): { blocks: ParsedBlock[]; warnings: string[]; reveal_event_count: number } {
  const blocks: ParsedBlock[] = []
  const warnings: string[] = []
  const artBindingsByStartLine = new Map(artResolution.bindings.map((binding) => [binding.target_lines.start, binding]))
  for (let index = 0; index < rawBlocks.length;) {
    const record = rawBlocks[index] as RawMarkdownBlock
    const block = record.markdown
    const position = positionFromBlock(block)
    if (position) {
      if (rawBlocks[index + 1] !== undefined) {
        blocks.push(parsedBlock(rawBlocks[index + 1] as RawMarkdownBlock, position, artBindingsByStartLine, null))
        index += 2
      } else {
        warnings.push("Dangling directive: alignment has no following Markdown block.")
        index += 1
      }
    } else if (block === ":::" || block.startsWith(":::")) {
      warnings.push("Unknown or malformed presentation directive was removed.")
      index += 1
    } else {
      blocks.push(parsedBlock(record, null, artBindingsByStartLine, null))
      index += 1
    }
  }
  return { blocks, warnings, reveal_event_count: 0 }
}

function parseBlocksWithReveals(
  rawBlocks: Array<RawMarkdownBlock>,
  artResolution: ArtBindings,
  reveals: RevealGroups
): { blocks: ParsedBlock[]; warnings: string[]; reveal_event_count: number } {
  const blocks: ParsedBlock[] = []
  const warnings: string[] = []
  const artBindingsByStartLine = new Map(artResolution.bindings.map((binding) => [binding.target_lines.start, binding]))
  for (let index = 0; index < rawBlocks.length;) {
    const record = rawBlocks[index] as RawMarkdownBlock
    if (record.markdown === ":::") {
      warnings.push("Unknown or malformed presentation directive was removed.")
      index += 1
      continue
    }

    const position = positionFromBlock(record.markdown)
    if (position) {
      let selectedPosition = position
      index += 1
      while (index < rawBlocks.length) {
        const nextPosition = positionFromBlock((rawBlocks[index] as RawMarkdownBlock).markdown)
        if (!nextPosition) break
        selectedPosition = nextPosition
        index += 1
      }
      if (rawBlocks[index]) {
        blocks.push(parsedBlock(rawBlocks[index] as RawMarkdownBlock, selectedPosition, artBindingsByStartLine, reveals.event_by_line))
        index += 1
      } else {
        warnings.push("Dangling directive: alignment has no following Markdown block.")
      }
      continue
    }

    if (record.markdown.startsWith(":::")) {
      warnings.push("Unknown or malformed presentation directive was removed.")
      index += 1
      continue
    }

    blocks.push(parsedBlock(record, null, artBindingsByStartLine, reveals.event_by_line))
    index += 1
  }
  return { blocks, warnings, reveal_event_count: reveals.event_count }
}

function parsedBlock(
  record: RawMarkdownBlock,
  position: SourcePosition | null,
  artBindingsByStartLine: Map<number, ArtBindings["bindings"][number]>,
  eventByLine: Record<number, number> | null
): ParsedBlock {
  const block: ParsedBlock = { markdown: record.markdown, position }
  const binding = artBindingsByStartLine.get(record.startLine)
  if (binding) block.art = { directive_id: binding.directive_id, ...analyzeArtList(record.markdown) }
  const revealEvent = eventByLine?.[record.startLine]
  if (revealEvent !== undefined) block.reveal_event = revealEvent
  return block
}

function resolveRevealGroups(markdown: string, mode: string, artResolution: ArtBindings): RevealGroups {
  const lines = markdown.split("\n")
  const empty: RevealGroups = { event_by_line: {}, event_count: 0, directive_lines: [], warnings: [], lines }
  if (mode !== "presentation") return empty

  const directiveLines = new Set(artResolution.boundary_map.directiveLines)
  const blankLines = new Set(artResolution.boundary_map.blankLines)
  const artLines = new Set(artResolution.directives.map((directive) => directive.line))
  const eventByLine: Record<number, number> = {}
  const consumed: Array<number> = []
  const warnings: Array<string> = []
  const pending: Array<{ kind: string; label: string | null; sequence: number }> = []
  const current: Array<number> = []
  const eventOrdinals = new Map<string, number>()
  let stepSequence = 0

  const warnConflicts = (): void => {
    const labels = new Set(pending.map((step) => (step.label === null ? "plain" : `label:${canonicalStepLabel(step.label)}`)))
    if (labels.size > 1) warnings.push("Conflicting step directives in one stack; the last valid step directive takes effect.")
  }
  const orphan = (): void => {
    if (!pending.length) return
    warnConflicts()
    warnings.push("Step directive has no following contiguous Markdown group; place content immediately below it without a blank line.")
    pending.length = 0
  }
  const flush = (): void => {
    if (!current.length) return
    warnConflicts()
    const step = pending.at(-1)
    if (step) {
      const identity = step.label === null ? `plain:${step.sequence}` : `label:${canonicalStepLabel(step.label)}`
      if (!eventOrdinals.has(identity)) eventOrdinals.set(identity, eventOrdinals.size)
      const revealEvent = eventOrdinals.get(identity) as number
      for (const line of current) eventByLine[line] = revealEvent
    }
    current.length = 0
    pending.length = 0
  }

  lines.forEach((line, lineIndex) => {
    const step = directiveLines.has(lineIndex) ? stepDirective(line) : null
    if (step?.kind === "step") {
      flush()
      consumed.push(lineIndex)
      stepSequence += 1
      pending.push({ kind: step.kind, label: step.label ?? null, sequence: stepSequence })
      return
    }
    if (step?.kind === "malformed") {
      flush()
      consumed.push(lineIndex)
      warnings.push("Malformed step directive was removed; use :::step or :::step{N} on its own line.")
      return
    }
    if (step?.kind === "indented_code") {
      current.push(lineIndex)
      return
    }

    if (blankLines.has(lineIndex)) {
      flush()
      orphan()
      return
    }
    if (directiveLines.has(lineIndex)) {
      if (/^ {0,3}:::[ \t]*$/.test(line)) {
        flush()
        orphan()
        return
      }
      const compatible = positionFromBlock(line) || artLines.has(lineIndex) || /^\s*:::(?:section|subsection|footnote)\{/.test(line)
      if (!compatible) {
        flush()
        orphan()
      }
      return
    }
    current.push(lineIndex)
  })
  flush()
  orphan()

  return { event_by_line: eventByLine, event_count: eventOrdinals.size, directive_lines: consumed, warnings, lines }
}

function stepDirective(line: string): StepDirectiveResult | null {
  if (/^ {4,}:::step(?=$|[^A-Za-z0-9_-])/.test(line)) return { kind: "indented_code" }
  if (!/^[ \t]*:::step(?=$|[^A-Za-z0-9_-])/.test(line)) return null
  const valid = /^ {0,3}:::step(?:\{([0-9]+)\})?[ \t]*$/.exec(line)
  return valid ? { kind: "step", label: valid[1] ?? null } : { kind: "malformed" }
}

function canonicalStepLabel(label: string): string {
  return label.replace(/^0+/, "") || "0"
}

function markdownBlocks(markdown: string, artResolution: ArtBindings, sourceBoundaryMap: ArtBoundaryMap): Array<RawMarkdownBlock> {
  const blocks: Array<RawMarkdownBlock> = []
  const artBindings = indexArtBindings(artResolution.bindings, markdown.split("\n").length)
  const boundaryMap = {
    blockStarts: new Set(sourceBoundaryMap.blockStarts),
    blockEnds: new Set(sourceBoundaryMap.blockEnds),
    directiveLines: new Set(sourceBoundaryMap.directiveLines),
    blankLines: new Set(sourceBoundaryMap.blankLines)
  }
  let current: Array<string> = []
  let currentStartLine: number | null = null
  let currentEndLine: number | null = null
  const flush = (): void => {
    if (!current.length) return
    blocks.push({ markdown: current.join("\n"), startLine: currentStartLine as number, endLine: currentEndLine as number })
    current = []
    currentStartLine = null
    currentEndLine = null
  }
  const pushLine = (line: string, index: number): void => {
    if (!current.length) currentStartLine = index
    current.push(line)
    currentEndLine = index + 1
  }
  let fence: FenceState | null = null
  let mathFence: string | null = null
  for (const [index, line] of markdown.split("\n").entries()) {
    if (boundaryMap.blockStarts.has(index) && current.length) flush()
    const incoming = fenceMarker(line)
    if (fence) fence = toggleFence(fence, incoming)
    else if (incoming) fence = incoming
    if (!fence && mathFence) {
      current.push(line)
      if (displayMathFenceCloser(line, mathFence)) {
        mathFence = null
        if (boundaryMap.blockEnds.has(index + 1)) flush()
      }
      continue
    }
    if (!fence) {
      const opening = displayMathFenceOpener(line)
      if (opening) mathFence = opening
    }
    if ((line === "" || boundaryMap.blankLines.has(index)) && boundaryMap.directiveLines.has(index)) {
      // Source resolution has already consumed this directive as metadata.
      // Its blank placeholder preserves line ownership without creating an
      // empty rendered block or a second directive interpretation.
      flush()
    } else if (!fence && !mathFence && boundaryMap.directiveLines.has(index)) {
      flush()
      blocks.push({ markdown: line.trim(), startLine: index, endLine: index + 1 })
    } else if ((line === "" || boundaryMap.blankLines.has(index)) && !fence && !mathFence) {
      const artBinding = artBindings.byLine[index]
      if (artBinding && index + 1 < artBinding.target_lines.end) pushLine(line, index)
      else flush()
    } else {
      pushLine(line, index)
    }
    if (boundaryMap.blockEnds.has(index + 1)) flush()
  }
  flush()
  return blocks
}

function positionFromBlock(block: string): SourcePosition | null {
  const match = /^\s*:::(align|position)[ \t]*\{([^}]*)\}\s*$/.exec(block)
  if (!match) return null
  const raw = match[2] ?? ""
  const values = raw.toLowerCase().split(/\s+/).filter(Boolean)
  const horizontalFound = values.some(value => POSITION_VOCABULARY.horizontal.includes(value))
  const verticalFound = values.some(value => POSITION_VOCABULARY.vertical.includes(value))
  if (!horizontalFound && !verticalFound) return null
  // Single parser: horizontal/vertical come from parseAlignment; explicit keeps
  // the map's found-based formula so render output is unchanged.
  const parsed = parseAlignment(raw)
  return { horizontal: parsed.horizontal, vertical: parsed.vertical, vertical_explicit: verticalFound }
}

function artDiagnosticMessage(code: string): string {
  const messages: Record<string, string> = {
    [ART_DIAGNOSTICS.NO_LIST_TARGET]: "Art needs a root Markdown list immediately after its directive.",
    [ART_DIAGNOSTICS.INVALID_SYNTAX]: "Art directive syntax is invalid. Use :::art with no arguments.",
    [ART_DIAGNOSTICS.UNSUPPORTED_CONTENT]: "Art contains unsupported content; the complete Markdown list is shown.",
    [ART_DIAGNOSTICS.REVEAL_BOUNDARY]: "SmartArt list crosses a reveal boundary; split the Art list or remove the step marker inside it. The complete Markdown list is shown.",
    [ART_DIAGNOSTICS.NO_FIT]: "Art does not fit the fixed slide; all authored content remains available.",
    [ART_DIAGNOSTICS.ITEM_TOO_TALL]: "An Art item is taller than a document page and remains intact.",
    [ART_DIAGNOSTICS.INTERNAL_ERROR]: "Art could not be laid out; the complete Markdown list remains available."
  }
  return messages[code] || "Art reported an unknown diagnostic."
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
  if (marker === "$$") return "$$"
  if (marker === "\\[") return "\\]"
  const inlineDisplayOpener = /^[ \t]{0,3}\$\$[ \t]*(\S.*)$/.exec(line)
  return inlineDisplayOpener && !inlineDisplayOpener[1]?.includes("$$") ? "$$" : null
}

// Mirror the renderer's inline display-math rule: once a fence is open, the
// first unescaped closing delimiter ends the span, so `\end{aligned}$$`
// closers (and any trailing content before `$$`) close the fence instead of
// swallowing the rest of the document into one block.
function displayMathFenceCloser(line: string, fence: string): boolean {
  if (displayMathFenceMarker(line) === fence) return true
  let index = line.indexOf(fence)
  while (index >= 0) {
    let slashes = 0
    for (let cursor = index - 1; cursor >= 0 && line[cursor] === "\\"; cursor -= 1) slashes += 1
    if (slashes % 2 === 0) return true
    index = line.indexOf(fence, index + fence.length)
  }
  return false
}

function displayMathFenceSource(markdown: string): boolean {
  const lines = markdown.split(/\r\n|\r|\n/)
  const opener = displayMathFenceOpener(lines[0] ?? "")
  return Boolean(opener && (lines.length === 1 || displayMathFenceCloser(lines.at(-1) ?? "", opener)))
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
