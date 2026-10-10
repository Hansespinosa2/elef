export const SLIDE_POSITION_SOURCE = [
  ":::align{middle center}",
  "# Alignment stack",
  "",
  ":::align{center}",
  "Subtitle",
  "",
  ":::align{bottom right}",
  "Footer",
  ""
].join("\n")

export const COLUMN_DOCKING_SOURCE = [
  "# Deck title",
  "",
  "## Left",
  "",
  ":::align{middle center}",
  "Left stack",
  "",
  ":::align{bottom center}",
  "Left footer",
  "",
  "## Right",
  "",
  "Right text"
].join("\n")

export async function slidePositionGrammarWorkflow(ui) {
  await ui.openDeck()
  const originalSource = await ui.readSource()

  try {
    await ui.showSourceMode()
    await ui.replaceSource(SLIDE_POSITION_SOURCE)
    await ui.waitForSaved(SLIDE_POSITION_SOURCE)
    await ui.showVisualMode()
    await ui.assertSlidePositionGrammar()

    await ui.showSourceMode()
    await ui.replaceSource(COLUMN_DOCKING_SOURCE)
    await ui.waitForSaved(COLUMN_DOCKING_SOURCE)
    await ui.showVisualMode()
    await ui.assertColumnSlidePositionDocking()
  } finally {
    await ui.showSourceMode()
    await ui.replaceSource(originalSource)
    await ui.waitForSaved(originalSource)
    await ui.showVisualMode()
  }
}
