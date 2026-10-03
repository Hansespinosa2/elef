export async function slideStructureWorkflow(ui) {
  await ui.openDeck()
  await ui.showVisualMode()

  const originalSource = await ui.readSource()
  const originalSlideCount = await ui.slideCount()
  const sourceWithNewSlide = `${originalSource}${originalSource.endsWith("\n") ? "" : "\n"}---\n# New slide\n\nStart writing here.`
  await ui.addSlideAfterLast()
  await ui.waitForSource(sourceWithNewSlide)
  await ui.waitForSlideCount(originalSlideCount + 1)
  await ui.waitForSaved(sourceWithNewSlide)

  await ui.showSourceMode()
  await ui.undo()
  await ui.waitForSource(originalSource)
  await ui.waitForSaved(originalSource)

  await ui.redo()
  await ui.waitForSource(sourceWithNewSlide)
  await ui.waitForSaved(sourceWithNewSlide)

  await ui.undo()
  await ui.waitForSource(originalSource)
  await ui.waitForSaved(originalSource)
  await ui.showVisualMode()
  await ui.waitForSlideCount(originalSlideCount)
}
