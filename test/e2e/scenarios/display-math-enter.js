export const EMPTY_DISPLAY_MATH_SOURCE = "# E2E display math\n\n"

export async function displayMathEnterWorkflow(ui) {
  await ui.openDeck("E2E document")
  const originalSource = await ui.readSource()
  const expectedSource = `${EMPTY_DISPLAY_MATH_SOURCE}$$\n\n$$`
  const expectedCaret = EMPTY_DISPLAY_MATH_SOURCE.length + 3

  try {
    await ui.showSourceMode()
    await ui.replaceSource(EMPTY_DISPLAY_MATH_SOURCE)
    await ui.waitForSource(EMPTY_DISPLAY_MATH_SOURCE)
    await ui.refreshPreview()
    await ui.showVisualMode()
    await ui.typeEmptyDisplayMath("visual")
    await ui.assertDisplayMathCaret(expectedSource, expectedCaret, "visual")
    await ui.waitForSaved(expectedSource)

    await ui.showSourceMode()
    await ui.assertCaretPosition(expectedCaret)

    await ui.replaceSource(EMPTY_DISPLAY_MATH_SOURCE)
    await ui.waitForSource(EMPTY_DISPLAY_MATH_SOURCE)
    await ui.refreshPreview()
    await ui.showSourceMode()
    await ui.typeEmptyDisplayMath("source")
    await ui.assertDisplayMathCaret(expectedSource, expectedCaret, "source")
    await ui.waitForSaved(expectedSource)
  } finally {
    if (await ui.readSource() !== originalSource) {
      await ui.restoreSource(originalSource)
      await ui.flushLocalSave()
      await ui.waitForSaved(originalSource)
    }
  }
}
