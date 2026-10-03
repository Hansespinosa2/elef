export async function applyEditorSource(source, {
  id, expectedSource, getDeckId, getSource, waitForEditor, setFallback
}) {
  const controller = await waitForEditor()
  // Readiness may wait while navigation or typing changes the target buffer.
  // A delayed reload/recovery must not replace another deck or newer edits.
  if (getDeckId() !== id || getSource() !== expectedSource) return false
  if (controller) controller.setExternalValue(source)
  else setFallback(source)
  return true
}
