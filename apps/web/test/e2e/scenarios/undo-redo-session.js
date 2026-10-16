export async function undoRedoSessionWorkflow(ui, originalSource, editedSource) {
  await ui.undo()
  await ui.waitForSource(originalSource)
  await ui.waitForSaved(originalSource)

  await ui.redo()
  await ui.waitForSource(editedSource)
  await ui.waitForSaved(editedSource)
}
