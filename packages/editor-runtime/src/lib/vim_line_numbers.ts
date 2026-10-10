import type { EditorState } from "@codemirror/state";

export function formatLineNumber(number: number, state: EditorState, mode: string): string {
  if (mode !== "relative") return String(number)

  const activeLine = state.doc.lineAt(state.selection.main.head).number
  return String(Math.abs(activeLine - number))
}
