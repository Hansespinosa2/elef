// Opening a document is a new history boundary, unlike changing its current
// buffer. Its source bytes select the separator before CodeMirror reads them.
// Separator detection mirrors detectLineSeparator in client session/source_ops
// (kept inline: this module also loads raw in node without a bundler).
export function createDocumentState(EditorState, source, extensions = []) {
  const lineSeparator = source.match(/\r\n|\r|\n/)?.[0] || "\n"
  return {
    lineSeparator,
    state: EditorState.create({ doc: source, extensions: [EditorState.lineSeparator.of(lineSeparator), ...extensions] })
  }
}
