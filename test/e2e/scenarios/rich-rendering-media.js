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
  const originalStoredSource = await ui.readStoredSource()
  assert.equal(normalizeLineEndings(originalSource), normalizeLineEndings(RICH_RENDERING_SOURCE),
    "The runtime rich-rendering deck must start from the checked-in fixture source")
  assert.equal(normalizeLineEndings(originalStoredSource), normalizeLineEndings(RICH_RENDERING_SOURCE),
    "The persisted rich-rendering deck must start from the checked-in fixture source")

  await ui.showVisualMode()
  await ui.refreshPreview()
  await ui.assertRichRenderingMedia()

  await ui.enterPresentationMode()
  await ui.assertPresentationSlide(0, "Rich rendering and media sample")
  await ui.movePresentation("ArrowRight")
  await ui.assertPresentationSlide(1, "Art sample")
  await ui.exitPresentationMode()

  const lineSeparator = originalStoredSource.match(/\r\n|\r|\n/)?.[0] || "\n"
  const editedSource = `${originalStoredSource}Saved by the rich fixture round-trip.${lineSeparator}`
  await ui.showSourceMode()
  await ui.replaceSource(editedSource)
  await ui.waitForSaved(editedSource)
  const savedStoredSource = await ui.readStoredSource()
  await ui.openDeck(RICH_RENDERING_TITLE)
  await ui.waitForSource(savedStoredSource)
  assert.equal(await ui.readStoredSource(), savedStoredSource,
    "The persisted rich fixture source must remain byte-identical after save and reopen")
  assert.equal(normalizeLineEndings(await ui.readSource()), normalizeLineEndings(savedStoredSource),
    "The reopened rich fixture editor must show the persisted source")
  await ui.showVisualMode()
  await ui.assertRichRenderingMedia()

  await ui.showSourceMode()
  await ui.restoreSource(originalStoredSource)
  await ui.waitForSaved(originalStoredSource)
  const restoredStoredSource = await ui.readStoredSource()
  assert.equal(restoredStoredSource, originalStoredSource,
    "Restoring the rich fixture must preserve its original source bytes")
  await ui.openDeck(RICH_RENDERING_TITLE)
  await ui.waitForSource(restoredStoredSource)
  assert.equal(await ui.readStoredSource(), restoredStoredSource,
    "Restored rich fixture source must remain byte-identical after close and reopen")
  assert.equal(normalizeLineEndings(await ui.readSource()), normalizeLineEndings(RICH_RENDERING_SOURCE))
}
