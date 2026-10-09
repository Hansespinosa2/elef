// Opening a document is a new history boundary, unlike changing its current
// buffer. Its source bytes select the separator before CodeMirror reads them.
export function createDocumentState(EditorState, source, extensions = []) {
  const lineSeparator = source.match(/\r\n|\r|\n/)?.[0] || "\n"
  return {
    lineSeparator,
    state: EditorState.create({ doc: source, extensions: [EditorState.lineSeparator.of(lineSeparator), ...extensions] })
  }
}
