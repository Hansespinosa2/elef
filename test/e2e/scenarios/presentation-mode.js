export const PRESENTATION_SOURCE = "# First slide\n\nBefore E2E.\n\n---\n\n# Second slide\n\nAfter E2E.\n"

export async function presentationModeWorkflow(ui) {
  await ui.openDeck()
  const originalSource = await ui.readSource()

  try {
    await ui.replaceSource(PRESENTATION_SOURCE)
    await ui.waitForSaved(PRESENTATION_SOURCE)
    await ui.enterPresentationMode()
    await ui.assertPresentationSlide(0, "First slide")
    await ui.movePresentation("ArrowRight")
    await ui.assertPresentationSlide(1, "Second slide")
    await ui.movePresentation("Home")
    await ui.assertPresentationSlide(0, "First slide")
    await ui.movePresentation("End")
    await ui.assertPresentationSlide(1, "Second slide")
    await ui.exitPresentationMode()
  } finally {
    await ui.returnToEditor()
    await ui.replaceSource(originalSource)
    await ui.waitForSaved(originalSource)
  }
}
