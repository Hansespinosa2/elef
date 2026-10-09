import assert from "node:assert/strict"
import { readFileSync } from "node:fs"

export const RICH_RENDERING_TITLE = "E2E rich rendering"
export const RICH_RENDERING_SOURCE = readFileSync(
  new URL("../../fixtures/desktop/release/rich-rendering-media.md", import.meta.url),
  "utf8"
)

function normalizeLineEndings(source) {
  return source.replace(/\r\n|\r/g, "\n")
}

export async function richRenderingMediaWorkflow(ui) {
  await ui.openDeck(RICH_RENDERING_TITLE)
  const originalSource = await ui.readSource()
  assert.equal(normalizeLineEndings(originalSource), normalizeLineEndings(RICH_RENDERING_SOURCE),
    "The runtime rich-rendering deck must start from the checked-in fixture source")

  await ui.showVisualMode()
  await ui.refreshPreview()
  await ui.assertRichRenderingMedia()

  await ui.enterPresentationMode()
  await ui.assertPresentationSlide(0, "Rich rendering and media sample")
  await ui.assertPresentationSlide(1, "Art sample")
  await ui.exitPresentationMode()

  const editedSource = `${originalSource}Saved by the rich fixture round-trip.\n`
  await ui.showSourceMode()
  await ui.replaceSource(editedSource)
  await ui.waitForSaved(editedSource)
  const savedRawSource = await ui.readSource()
  await ui.openDeck(RICH_RENDERING_TITLE)
  await ui.waitForSource(savedRawSource)
  assert.equal(await ui.readSource(), savedRawSource,
    "The rich fixture source must remain byte-identical after save and reopen")
  await ui.showVisualMode()
  await ui.assertRichRenderingMedia()

  await ui.showSourceMode()
  await ui.replaceSource(originalSource)
  await ui.waitForSaved()
  const restoredRawSource = await ui.readSource()
  await ui.openDeck(RICH_RENDERING_TITLE)
  await ui.waitForSource(restoredRawSource)
  assert.equal(await ui.readSource(), restoredRawSource,
    "Restoring the rich fixture must also survive close and reopen")
  assert.equal(normalizeLineEndings(restoredRawSource), normalizeLineEndings(RICH_RENDERING_SOURCE))
}
