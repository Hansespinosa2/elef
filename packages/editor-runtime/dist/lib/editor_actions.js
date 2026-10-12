function editorActionControl(event, action) {
  const control = event.target?.closest?.(`[data-editor-action="${action}"]`);
  return control ?? null;
}
function bindEditorAction(root, action, handler, { events = ["click"] } = {}) {
  const listener = (event) => {
    const control = editorActionControl(event, action);
    if (!control || !root.contains(control)) return;
    handler(event, control);
  };
  events.forEach((type) => root.addEventListener(type, listener));
  return () => events.forEach((type) => root.removeEventListener(type, listener));
}
export {
  bindEditorAction,
  editorActionControl
};
