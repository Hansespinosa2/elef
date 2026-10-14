function createDocumentState(EditorState, source, extensions = []) {
  const lineSeparator = source.match(/\r\n|\r|\n/)?.[0] || "\n";
  return {
    lineSeparator,
    state: EditorState.create({ doc: source, extensions: [EditorState.lineSeparator.of(lineSeparator), ...extensions] })
  };
}
export {
  createDocumentState
};
