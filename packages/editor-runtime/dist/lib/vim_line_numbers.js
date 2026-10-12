function formatLineNumber(number, state, mode) {
  if (mode !== "relative") return String(number);
  const activeLine = state.doc.lineAt(state.selection.main.head).number;
  return String(Math.abs(activeLine - number));
}
export {
  formatLineNumber
};
