import { PIXEL_PNG_BYTES, PIXEL_PNG_DIGEST } from "./media-fixture.js"

export async function insertImageWorkflow(ui) {
  const source = await ui.insertImage({
    bytes: PIXEL_PNG_BYTES,
    filename: "pixel.png",
    mimeType: "image/png"
  })
  await ui.waitForSaved(source)
  await ui.reopenDeck()
  await ui.waitForSource(source)
  await ui.showVisualMode()
  await ui.waitForImage(PIXEL_PNG_DIGEST)
}
