// Opening a document is a new history boundary, unlike changing its current
// buffer. Its source bytes select the separator before CodeMirror reads them.
// Separator detection mirrors detectLineSeparator in client session/source_ops
// (kept inline: this module also loads raw in node without a bundler).
import type { EditorState as CodeMirrorEditorState, Extension, Text } from "@codemirror/state";

export function createDocumentState(
  EditorState: typeof CodeMirrorEditorState,
  source: string,
  extensions: Extension[] = []
) {
  const lineSeparator = source.match(/\r\n|\r|\n/)?.[0] || "\n"
  return {
    lineSeparator,
    state: EditorState.create({ doc: source, extensions: [EditorState.lineSeparator.of(lineSeparator), ...extensions] })
  }
}

// Compare CodeMirror documents in their position space while retaining the
// actual Text nodes in the replacement. A serialized mixed-ending document
// can contain literal CR/LF characters inside a line, so re-normalizing the
// replacement would alter bytes unrelated to the server's change.
export function diffDocumentText(current: Text, next: Text): { from: number; to: number; insert: Text } | null {
  if (current.eq(next)) return null
  const before = current.toString(), after = next.toString()
  let from = 0, oldEnd = before.length, newEnd = after.length
  while (from < oldEnd && from < newEnd && before.charCodeAt(from) === after.charCodeAt(from)) from++
  while (oldEnd > from && newEnd > from && before.charCodeAt(oldEnd - 1) === after.charCodeAt(newEnd - 1)) {
    oldEnd--
    newEnd--
  }
  const insert = next.slice(from, newEnd)
  // A literal LF and a structural line break have the same flattened
  // character but different Text structure. Fall back to the whole document
  // if a minimal string diff would fail to reproduce that structure.
  return current.replace(from, oldEnd, insert).eq(next)
    ? { from, to: oldEnd, insert }
    : { from: 0, to: current.length, insert: next }
}
