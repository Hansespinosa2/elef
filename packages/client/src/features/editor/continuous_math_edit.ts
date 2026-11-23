import type { Text, Transaction } from "@codemirror/state"
import { syntaxTree } from "@codemirror/language"
import { scanMathSource } from "@elef/work-model/math-source"

export interface LocalMathEdit {
  from: number
  to: number
  nextFrom: number
  nextTo: number
  interior: string
  display: boolean
}

export interface InlineMathLineEdit { from: number; oldTo: number; to: number }

const inlineMathLineCache = new WeakMap<Transaction, InlineMathLineEdit | null>()
const documentMathCache = new WeakMap<Text, ReturnType<typeof scanMathSource>>()

// Transactions share their immutable document with the next transaction's
// starting state. Reuse that scan rather than scanning the same long source
// twice for each character of a new equation.
export function scanDocumentMath(doc: Text): ReturnType<typeof scanMathSource> {
  let spans = documentMathCache.get(doc)
  if (!spans) {
    spans = scanMathSource(doc.toString())
    documentMathCache.set(doc, spans)
  }
  return spans
}

// Edits in a standalone prose line may temporarily make an auto-paired
// equation invalid (an empty pair, trailing space, or escaped closing $).
// Reparse that line only after verifying that no math span crosses into it
// and all surrounding equations remain unchanged. Ambiguous changes take the full
// path. The result is cached for the preview, flow and table fields.
export function localInlineMathLineEdit(transaction: Transaction): InlineMathLineEdit | null {
  if (inlineMathLineCache.has(transaction)) return inlineMathLineCache.get(transaction) ?? null
  let result: InlineMathLineEdit | null = null
  let count = 0
  transaction.changes.iterChangedRanges((from, to, newFrom, newTo) => {
    count++
    if (count !== 1) return
    const removed = transaction.startState.sliceDoc(from, to)
    const inserted = transaction.newDoc.sliceString(newFrom, newTo)
    if (!/^[\p{L}\p{N} \t\\{}^_+=(),.:$-]*$/u.test(removed + inserted)) return
    const line = transaction.startState.doc.lineAt(from), next = transaction.newDoc.lineAt(newFrom)
    if (to > line.to || newTo > next.to) return
    const plainMathLine = /^[ \t]{0,3}[\p{L}\p{N}][\p{L}\p{N} \t\\{}^_+=(),.:!?$-]*$/u
    if (!plainMathLine.test(line.text) || !plainMathLine.test(next.text)) return
    const firstDollar = line.text.indexOf("$")
    const nextDollar = next.text.indexOf("$")
    const firstMarker = firstDollar < 0 ? nextDollar : firstDollar
    if (firstMarker < 0 || from < line.from + firstMarker) return
    if (line.number > 1 && transaction.startState.doc.line(line.number - 1).text.trim()) return
    if (line.number < transaction.startState.doc.lines && transaction.startState.doc.line(line.number + 1).text.trim()) return
    let node = syntaxTree(transaction.startState).resolveInner(line.from + 1, 1)
    while (node) {
      if (!["Document", "Paragraph"].includes(node.name)) return
      if (!node.parent) break
      node = node.parent
    }
    const before = scanDocumentMath(transaction.startState.doc)
    const after = scanDocumentMath(transaction.newDoc)
    const crosses = (span: { start: number; end: number }, start: number, end: number) =>
      span.start < start && span.end > start || span.start < end && span.end > end
    if (before.some(span => crosses(span, line.from, line.to)) || after.some(span => crosses(span, next.from, next.to))) return
    const outsideBefore = before.filter(span => span.end <= line.from || span.start >= line.to)
    const outsideAfter = after.filter(span => span.end <= next.from || span.start >= next.to)
    if (outsideBefore.length !== outsideAfter.length || !outsideBefore.every((span, index) =>
      outsideAfter[index]?.start === transaction.changes.mapPos(span.start, 1) &&
      outsideAfter[index]?.end === transaction.changes.mapPos(span.end, -1))) return
    result = { from: line.from, oldTo: line.to, to: next.to }
  })
  const safe = count === 1 ? result : null
  inlineMathLineCache.set(transaction, safe)
  return safe
}

// An edit wholly inside one still-closed, single-line equation cannot
// change its surrounding block or a distant table. Reject ambiguous
// Markdown and delimiter changes: those must take the full parse path.
export function localMathEdit(transaction: Transaction): LocalMathEdit | null {
  let result: LocalMathEdit | null = null
  let changes = 0
  transaction.changes.iterChangedRanges((from, to, newFrom, newTo) => {
    changes++
    if (changes !== 1) { result = null; return }
    const oldLine = transaction.startState.doc.lineAt(from)
    const newLine = transaction.newDoc.lineAt(newFrom)
    if (to > oldLine.to || newTo > newLine.to) return
    const removed = transaction.startState.sliceDoc(from, to)
    const inserted = transaction.newDoc.sliceString(newFrom, newTo)
    if (!/^[\p{L}\p{N} \t\\{}^_+=(),.:-]*$/u.test(removed + inserted)) return
    const old = scanMathSource(oldLine.text).find(span =>
      from >= oldLine.from + span.start + span.open.length && to <= oldLine.from + span.end - span.close.length)
    if (!old) return
    const nextFrom = transaction.changes.mapPos(oldLine.from + old.start, -1)
    const nextTo = transaction.changes.mapPos(oldLine.from + old.end, 1)
    const next = scanMathSource(newLine.text).find(span =>
      newLine.from + span.start === nextFrom && newLine.from + span.end === nextTo && span.open === old.open && span.close === old.close)
    if (!next) return
    // A possible Markdown span crossing the equation still takes the
    // conservative path. Subscripts wholly inside this or another equation
    // are opaque to inline Markdown and do not require a rebuild.
    const unsafe = (line: string, span: { start: number; end: number }) => {
      if (/[*`\[\]]/.test(line)) return true
      for (const pattern of [/__(?=\S)(.+?)(?<=\S)__/g, /(?<!_)_(?!\s)(.+?)(?<!\s)_(?!_)/g]) {
        for (const match of line.matchAll(pattern)) {
          const start = match.index ?? 0
          const end = start + match[0].length
          if (start < span.end && end > span.start && !(start >= span.start && end <= span.end)) return true
        }
      }
      return false
    }
    if (unsafe(oldLine.text, old) || unsafe(newLine.text, next)) return
    result = { from: oldLine.from + old.start, to: oldLine.from + old.end, nextFrom, nextTo,
      interior: next.interior.trim(), display: next.display }
  })
  return changes === 1 ? result : null
}
