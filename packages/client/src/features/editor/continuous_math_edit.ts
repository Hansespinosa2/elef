import type { Transaction } from "@codemirror/state"
import { scanMathSource } from "@elef/work-model/math-source"

export interface LocalMathEdit {
  from: number
  to: number
  nextFrom: number
  nextTo: number
  interior: string
  display: boolean
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
