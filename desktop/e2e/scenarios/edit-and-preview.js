import { undoRedoSessionWorkflow } from "./undo-redo-session.js"
import { insertImageWorkflow } from "./insert-image.js"

export const SAVED_SOURCE = "# Saved by shared scenario\n\nThe editor autosaved this text.\n"

export async function editAndPreviewWorkflow(ui) {
  await ui.openDeck()
  const originalSource = await ui.readSource()
  await ui.replaceSource(SAVED_SOURCE)
  await ui.waitForSource(SAVED_SOURCE)
  await ui.waitForSaved(SAVED_SOURCE)
  await undoRedoSessionWorkflow(ui, originalSource, SAVED_SOURCE)
  const sourceWithImage = await insertImageWorkflow(ui)
  await ui.showVisualMode()
  await ui.waitForPreview("The editor autosaved this text.")
  const visualSource = sourceWithImage.replace("The editor autosaved this text.", "The visual editor changed this text.")
  await ui.editVisualText("The editor autosaved this text.", "The visual editor changed this text.")
  await ui.waitForSource(visualSource)
  await ui.waitForSaved(visualSource)
  await ui.waitForPreview("The visual editor changed this text.")
}
