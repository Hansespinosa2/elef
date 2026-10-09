import { undoRedoSessionWorkflow } from "./undo-redo-session.js"
import { insertImageWorkflow } from "./insert-image.js"

export const SAVED_SOURCE = "# Saved by shared scenario\n\nThe editor autosaved this text.\n\nSee [[E2E linked]].\n"

export async function editAndPreviewWorkflow(ui) {
  await ui.openDeck()
  await ui.renameEditorTitle("E2E shared title")
  await ui.waitForEditorTitle("E2E shared title")
  await ui.reopenDeck()
  await ui.assertEditorTitle("E2E shared title")
  await ui.renameEditorTitle("E2E seed")
  await ui.waitForEditorTitle("E2E seed")

  const originalSource = await ui.readSource()
  const caretPosition = originalSource.indexOf("Seed paragraph.") + 5
  await ui.setCaretPosition(caretPosition)
  await ui.showVisualMode()
  await ui.assertDocumentLinkPreview("E2E linked")
  await ui.showSourceMode()
  await ui.assertSourceEditorUsable()
  await ui.assertCaretPosition(caretPosition)
  await ui.assertModeSwitchRespectsNewCaret()
  await ui.replaceSource(SAVED_SOURCE)
  await ui.waitForSource(SAVED_SOURCE)
  await ui.waitForSaved(SAVED_SOURCE)
  await undoRedoSessionWorkflow(ui, originalSource, SAVED_SOURCE)
  await ui.refreshPreview()
  await ui.showVisualMode()
  await ui.assertDocumentLinkPreview("E2E linked")
  await ui.showSourceMode()
  const sourceWithImage = await insertImageWorkflow(ui)
  await ui.showVisualMode()
  await ui.waitForPreview("The editor autosaved this text.")
  const visualSource = sourceWithImage.replace("The editor autosaved this text.", "The visual editor changed this text.")
  await ui.editVisualText("The editor autosaved this text.", "The visual editor changed this text.")
  await ui.waitForSource(visualSource)
  await ui.waitForSaved(visualSource)
  await ui.waitForPreview("The visual editor changed this text.")

  await ui.openDeck("E2E document")
  const originalDocument = await ui.readSource()
  const updatedDocument = `${originalDocument.trimEnd()}\n\nAfter saving, see [[E2E linked]].\n`
  await ui.replaceSource(updatedDocument)
  await ui.waitForSource(updatedDocument)
  await ui.waitForSaved(updatedDocument)
  await ui.refreshPreview()
  await ui.showVisualMode()
  await ui.assertDocumentLinkPreview("E2E linked")
  await ui.openDeck()
}
