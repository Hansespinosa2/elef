import { undoRedoSessionWorkflow } from "./undo-redo-session.js"

export const SAVED_SOURCE = "# Saved by shared scenario\n\nThe editor autosaved this text.\n"

export async function editAndPreviewWorkflow(ui) {
  await ui.openDeck()
  const originalSource = await ui.readSource()
  await ui.replaceSource(SAVED_SOURCE)
  await ui.waitForSource(SAVED_SOURCE)
  await ui.waitForSaved(SAVED_SOURCE)
  await undoRedoSessionWorkflow(ui, originalSource, SAVED_SOURCE)
  await ui.showVisualMode()
  await ui.waitForPreview("The editor autosaved this text.")
}
