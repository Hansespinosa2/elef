export const SAVED_SOURCE = "# Saved by shared scenario\n\nThe editor autosaved this text.\n"

export async function editAndPreviewWorkflow(ui) {
  await ui.openDeck()
  await ui.replaceSource(SAVED_SOURCE)
  await ui.waitForSaved()
  await ui.showVisualMode()
  await ui.waitForPreview("The editor autosaved this text.")
}
