async function applyEditorSource(source, {
  id,
  expectedSource,
  getDeckId,
  getSource,
  waitForEditor,
  setFallback,
  materializeEdits = () => {
  }
}) {
  const controller = await waitForEditor();
  materializeEdits();
  if (getDeckId() !== id || getSource() !== expectedSource) return false;
  if (controller) controller.setExternalValue(source);
  else setFallback(source);
  return true;
}
export {
  applyEditorSource
};
