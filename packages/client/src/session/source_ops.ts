// Portable source/range arithmetic for the editor session (Phase 08).
//
// Client-owned, framework-free: pure string and offset math with no
// CodeMirror, DOM, or host dependency. The CodeMirror-backed adapter
// applies the computed ranges; the controller keeps only the dispatch
// shells. Every function here is pinned by packages/client/test/session.test.ts.

export function normalizeLineEndings(value: string): string {
  return value.replace(/\r\n|\r/g, "\n")
}

export function detectLineSeparator(source: string): string {
  return source.match(/\r\n|\r|\n/)?.[0] || "\n"
}

export function toEditorLineEndings(value: string, lineSeparator: string): string {
  const normalized = normalizeLineEndings(value)
  return lineSeparator === "\n" ? normalized : normalized.replace(/\n/g, lineSeparator)
}

export interface SourceSelection {
  anchor: number
  head: number
}

export function clampSelection(anchor: number, head: number, length: number): SourceSelection {
  const safe = (offset: number): number => Math.max(0, Math.min(offset, length))
  return { anchor: safe(anchor), head: safe(head) }
}

export interface SourceChange {
  from: number
  to: number
  insert: string
}

// Minimal single-range diff from the current document text to a new source
// (shared prefix/suffix scan). Returns null when the normalized source is
// identical, so the adapter can skip the dispatch. The insert is converted
// to the document's line separator, ready to apply.
export function diffSource(current: string, source: string, lineSeparator: string): SourceChange | null {
  const normalizedSource = normalizeLineEndings(source)
  if (normalizedSource === current) return null
  let from = 0
  const sharedLength = Math.min(current.length, normalizedSource.length)
  while (from < sharedLength && current.charCodeAt(from) === normalizedSource.charCodeAt(from)) from += 1
  let currentEnd = current.length
  let sourceEnd = normalizedSource.length
  while (currentEnd > from && sourceEnd > from && current.charCodeAt(currentEnd - 1) === normalizedSource.charCodeAt(sourceEnd - 1)) {
    currentEnd -= 1
    sourceEnd -= 1
  }
  return { from, to: currentEnd, insert: toEditorLineEndings(normalizedSource.slice(from, sourceEnd), lineSeparator) }
}

// Caret offset after inserting text at `from`: the end of the inserted
// text measured in normalized (separator-independent) length.
export function caretAfterInsert(from: number, insert: string): number {
  return from + normalizeLineEndings(insert).length
}

// Selection for a ranged replacement, expressed relative to the range start.
export function offsetSelection(from: number, selection: { from: number; to: number }): SourceSelection {
  return { anchor: from + selection.from, head: from + selection.to }
}

const FRONTMATTER_PATTERN = /^---\r?\n[\s\S]*?\r?\n---(?=\r?\n|$)/

// Range of the leading `---` frontmatter block, or null when absent.
// Length-only (`{ from: 0, to }`); folding itself stays adapter-bound.
export function frontmatterRangeFor(source: string): { from: number; to: number } | null {
  const match = source.match(FRONTMATTER_PATTERN)
  return match && match[0].length > 4 ? { from: 0, to: match[0].length } : null
}
