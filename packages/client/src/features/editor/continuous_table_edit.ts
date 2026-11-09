import { Facet } from "@codemirror/state"
import type { Transaction } from "@codemirror/state"

// Installed only by continuous document authoring. Other editor surfaces keep
// their existing full-parse behavior when no table provider is present.
export const continuousPlainTableEdit = Facet.define<(transaction: Transaction) => boolean>()

export function isContinuousPlainTableEdit(transaction: Transaction): boolean {
  return transaction.startState.facet(continuousPlainTableEdit).some(accepts => accepts(transaction))
}
