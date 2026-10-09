export const PRESENTATION_SOURCE = "# First slide\n\n:::step{01}\nFirst reveal A\n\n:::step{1}\nFirst reveal B\n\n:::step\nSecond reveal\n\n---\n\n# Second slide\n\n:::step\nAfter E2E.\n"

export async function presentationModeWorkflow(ui) {
  await ui.openDeck()
  const originalSource = await ui.readSource()

  try {
    await ui.replaceSource(PRESENTATION_SOURCE)
    await ui.waitForSaved(PRESENTATION_SOURCE)
    await ui.enterPresentationMode()
    await ui.assertPresentationSlide(0, "First slide")
    await ui.assertPresentationText(0, "First reveal A", false)
    await ui.assertPresentationText(0, "First reveal B", false)
    await ui.assertPresentationText(0, "Second reveal", false)
    await ui.movePresentation("ArrowRight")
    await ui.assertPresentationText(0, "First reveal A", true)
    await ui.assertPresentationText(0, "First reveal B", true)
    await ui.assertPresentationText(0, "Second reveal", false)
    await ui.movePresentation("ArrowRight")
    await ui.assertPresentationText(0, "Second reveal", true)
    await ui.movePresentation("ArrowRight")
    await ui.assertPresentationSlide(1, "Second slide")
    await ui.assertPresentationText(1, "After E2E.", false)
    await ui.movePresentation("ArrowLeft")
    await ui.assertPresentationSlide(0, "First slide")
    await ui.assertPresentationText(0, "First reveal A", true)
    await ui.assertPresentationText(0, "First reveal B", true)
    await ui.assertPresentationText(0, "Second reveal", true)
    await ui.movePresentation("ArrowLeft")
    await ui.assertPresentationText(0, "Second reveal", false)
    await ui.movePresentation("Home")
    await ui.assertPresentationSlide(0, "First slide")
    await ui.assertPresentationText(0, "First reveal A", false)
    await ui.movePresentation("End")
    await ui.assertPresentationSlide(1, "Second slide")
    await ui.assertPresentationText(1, "After E2E.", true)
    await ui.exitPresentationMode()
  } finally {
    await ui.returnToEditor()
    await ui.replaceSource(originalSource)
    await ui.waitForSaved(originalSource)
  }
}
