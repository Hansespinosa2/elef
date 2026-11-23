import type { EditorView } from "@codemirror/view"

interface Position { line: number; ch: number }
interface VimEditor {
  cm6: EditorView
  indexFromPos(position: Position): number
  getRange(from: Position, to: Position): string
  getSelections(): string[]
  replaceRange(text: string, from: Position, to?: Position, origin?: string): void
  replaceSelection(text: string): void
  replaceSelections(text: string[]): void
}
const adapted = new WeakSet<VimEditor>()

// The Vim core uses LF between lines in its registers and commands. The
// CodeMirror adapter instead reads and inserts using the document's chosen
// separator, so a CRLF yank can leave a literal CR behind when pasted. Keep
// the Vim API in LF while preserving the document's separator on writes.
export function adaptVimLineEndings(cm: VimEditor): void {
  if (adapted.has(cm)) return
  adapted.add(cm)

  cm.getRange = (from, to) => cm.cm6.state.doc.sliceString(cm.indexFromPos(from), cm.indexFromPos(to), "\n")
  cm.getSelections = () => {
    const { doc, selection } = cm.cm6.state
    return selection.ranges.map(range => doc.sliceString(range.from, range.to, "\n"))
  }
  const editorText = (text: string) => {
    const separator = cm.cm6.state.lineBreak
    return separator === "\n" ? text : text.replace(/\n/g, separator)
  }
  const replaceRange = cm.replaceRange.bind(cm)
  const replaceSelection = cm.replaceSelection.bind(cm)
  const replaceSelections = cm.replaceSelections.bind(cm)
  cm.replaceRange = (text, from, to, origin) => replaceRange(editorText(text), from, to, origin)
  cm.replaceSelection = text => replaceSelection(editorText(text))
  cm.replaceSelections = texts => replaceSelections(texts.map(editorText))
}
