import type { Transaction } from "@codemirror/state"
import { syntaxTree } from "@codemirror/language"
import { scanDocumentMath } from "./continuous_math_edit.js"

export interface ParagraphEndEdit { from: number; to: number }
const cache = new WeakMap<Transaction, ParagraphEndEdit | null>()

// Inserting or removing an extra paragraph break after an isolated plain
// paragraph cannot change its contents or any later block. Other structural
// edits still take the complete projection path.
export function localParagraphEndEdit(transaction: Transaction): ParagraphEndEdit | null {
  if (cache.has(transaction)) return cache.get(transaction) ?? null
  let result: ParagraphEndEdit | null = null
  let count = 0
  transaction.changes.iterChangedRanges((from, to, newFrom, newTo) => {
    count++
    if (count !== 1) return
    const oldLine = transaction.startState.doc.lineAt(from)
    const newLine = transaction.newDoc.lineAt(newFrom)
    if (from !== oldLine.to || newFrom !== newLine.to || oldLine.text !== newLine.text ||
      !/^[\p{L}\p{N} ,.!?]+$/u.test(oldLine.text) || !oldLine.text.trim() || /^\s*\d+[.)]\s/.test(oldLine.text)) return
    const removed = transaction.startState.sliceDoc(from, to)
    const inserted = transaction.newDoc.sliceString(newFrom, newTo)
    if (!((removed === "" && inserted === "\n\n") || (removed === "\n\n" && inserted === ""))) return
    if (oldLine.number > 1 && transaction.startState.doc.line(oldLine.number - 1).text.trim()) return
    if (oldLine.number < transaction.startState.doc.lines && transaction.startState.doc.line(oldLine.number + 1).text.trim()) return
    if (newLine.number < transaction.newDoc.lines && transaction.newDoc.line(newLine.number + 1).text.trim()) return
    // A display equation may span blank lines, so a plain-looking line can
    // still be part of math even when both adjacent lines are empty.
    if (scanDocumentMath(transaction.startState.doc).some(span => span.start < oldLine.to && span.end > oldLine.from)) return
    let node = syntaxTree(transaction.startState).resolveInner(oldLine.from + 1, 1)
    while (node) {
      if (!["Document", "Paragraph"].includes(node.name)) return
      if (!node.parent) break
      node = node.parent
    }
    result = { from: oldLine.from, to: oldLine.to }
  })
  const safe = count === 1 ? result : null
  cache.set(transaction, safe)
  return safe
}
