// Tiny style vocabulary shared without the 179K document map: position
// words, theme/typography normalization, metadata assist choices, the
// presentation theme derivation, and pure front-matter read/write (line
// scan, parse, value update, appearance commit). Pure values and functions
// only — this module must stay dependency-free so open-path importers
// (authoring merge, metadata assist, presentation chrome, appearance
// controller) skip the map parser. Moved here verbatim from document_map;
// the map re-exports every moved name so both entries keep one surface.

// Canonical align position vocabulary (F7): the host authoring-registry
// merge derives its directive grammar from this export instead of
// restating the word lists, and positionFromBlock in the map parses from it.
export const POSITION_VOCABULARY: {
  readonly horizontal: readonly string[];
  readonly vertical: readonly string[];
} = {
  horizontal: ["left", "center", "right"],
  vertical: ["top", "middle", "bottom"]
};

// Live shared Sets (exported for the map parser only): the value lists and
// the parser must read the same Sets. Never mutate; the frozen snapshots
// below are the public values.
export const THEMES = new Set(["light", "dark", "match"])
export const TYPOGRAPHIES = new Set(["book", "modern", "technical"])

// Canonical front-matter vocabulary for the metadata assist. The value lists
// derive from the same Sets the parser/validator reads, so suggestions can
// never drift from accepted values. Top-level keys are the user-facing
// fields (theme, typography, show-in-margin); portable document keys
// (elef_document_key, elef_aliases) stay system-managed and unsuggested.
// Margin subkeys accept kebab, snake, and camel spellings at parse time;
// the assist suggests the kebab and snake forms.
export const THEME_VALUES: readonly string[] = [...THEMES]
export const TYPOGRAPHY_VALUES: readonly string[] = [...TYPOGRAPHIES]
export const METADATA_TOP_LEVEL_KEYS: readonly string[] = ["theme", "typography", "show-in-margin"]
export const MARGIN_SETTING_KEYS: readonly string[] = ["section", "subsection", "footnote", "slide-count", "slide_count"]
export const METADATA_BOOLEAN_VALUES: readonly string[] = ["true", "false"]

export function metadataValueChoices(key: string): readonly string[] | null {
  const normalized = String(key ?? "").trim().toLowerCase()
  if (normalized === "theme") return THEME_VALUES
  if (normalized === "typography") return TYPOGRAPHY_VALUES
  const marginKey = normalized.replace(/-([a-z])/g, (_, letter: string) => `_${letter}`).replace(/[A-Z]/g, letter => `_${letter.toLowerCase()}`).replace(/^_/, "")
  if (marginKey === "section" || marginKey === "subsection" || marginKey === "footnote" || marginKey === "slide_count") {
    return METADATA_BOOLEAN_VALUES
  }
  return null
}

// Canonical presentation themes: each pairs one color mode with one font, so
// slides render three genuinely distinct looks. Legacy front-matter/workspace
// theme/typography values keep parsing unchanged (no migration, no rejects);
// the slide surface derives one of these at render time. Explicit dark always
// stays dark; otherwise typography selects the theme. Exactly 2 of the 9
// legacy (theme, typography) pairs render pixel-identical — (match, book)
// (the preserved Book Light default) and (dark, modern). The technical
// pairs render the mid-tone treatment (neither legacy light nor match), and
// dark now always pairs with the modern face. Body copy keeps legacy metrics
// by design: hybrid pairs such as (dark, technical) render modern-dark
// headings over technical-density (0.96em) body. Mirrored by
// Work#presentation_theme.
export const PRESENTATION_THEMES = ["book-light", "modern-dark", "technical-light"] as const
export type PresentationTheme = (typeof PRESENTATION_THEMES)[number]

export function presentationTheme(theme: unknown, typography: unknown): PresentationTheme {
  if (normalizeThemeValue(theme) === "dark") return "modern-dark"
  if (normalizeTypographyValue(typography) === "technical") return "technical-light"
  return "book-light"
}

export function normalizeThemeValue(value: unknown): string {
  return normalizeStyleValue(value, THEMES, "match")
}

// Shared new-work seed: visible YAML front matter carrying the workspace
// theme default, mirroring Document.available_default_source and
// Presentation.available_default_source on Rails. The web host passes its
// workspace default; hosts without a workspace style setting (desktop)
// omit it for the canonical "match" default. Unknown themes fall back to
// "match" exactly like Workspace#default_theme; only kind/title misuse
// throws.
export function buildNewWorkSource(input: { kind: unknown; title: unknown; theme?: unknown }): string {
  const kind = (input as { kind?: unknown } | null)?.kind
  if (kind !== "document" && kind !== "presentation") {
    throw new TypeError("New works need kind \"document\" or \"presentation\".")
  }
  const title = String((input as { title?: unknown } | null)?.title ?? "")
    .replace(/[\r\n]/g, " ")
    .trim()
    .replace(/\s+/g, " ")
  if (title === "") throw new TypeError("New works need a title.")
  const provided = (input as { theme?: unknown } | null)?.theme
  const theme = provided === undefined ? "match" : normalizeThemeValue(provided)
  return `---\ntheme: ${theme}\n---\n# ${title}\n\n`
}

export function normalizeTypographyValue(value: unknown): string {
  return normalizeStyleValue(value, TYPOGRAPHIES, "book")
}

function normalizeStyleValue(value: unknown, vocabulary: Set<string>, fallback: string): string {
  const withoutComment = String(value ?? "").trim().replace(/\s+#.*$/, "").trim()
  const unquoted = withoutComment.match(/^(['"])(.*)\1$/)?.[2] ?? withoutComment
  return vocabulary.has(unquoted) ? unquoted : fallback
}

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

export function sourceLines(source: string, start = 0, end = source.length): SourceLine[] {
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

export function frontMatterHasKey(source: unknown, key: string): boolean | null {
  if (typeof source !== "string" || typeof key !== "string" || !key) {
    throw new TypeError("Front matter key lookup needs source text and a key.")
  }
  const front = initialFrontMatter(source)
  if (!front) return null
  const pattern = new RegExp(`^\\s*${key.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\s*:`)
  return front.lines.slice(1, front.closingLine).some(line => pattern.test(line.text))
}
