export const CONTINUOUS_SOURCE = "# Authoring session\n\nalpha beta gamma\n\nEquation $x^2$.\n\n| Name | Value |\n| --- | --- |\n| delta | epsilon |\n\nFinal paragraph.\n"

// One uninterrupted input path, shared by Playwright and the real Tauri
// WebView. Setup may seed source; the actions never repair the caret, retry
// lost characters, or wait between individual keystrokes.
export async function continuousAuthoringWorkflow(ui) {
  await ui.openWork("E2E document")
  const original = await ui.readSource()
  try {
    await ui.showSourceMode()
    await ui.restoreSource(CONTINUOUS_SOURCE)
    await ui.waitForSaved(CONTINUOUS_SOURCE)
    await ui.showVisualMode()
    await ui.startContinuousAuthoring()
    await ui.clickContinuousText("alpha beta gamma")
    await ui.continuousKeys("0dw")
    await ui.waitForSource(CONTINUOUS_SOURCE.replace("alpha beta", "beta"))
    await ui.assertContinuousText("beta gamma")
    await ui.continuousKeys("u")
    await ui.waitForSource(CONTINUOUS_SOURCE)

    await ui.continuousKeys("gg4jfxryG")
    await ui.waitForSource(CONTINUOUS_SOURCE.replace("x^2", "y^2"))
    await ui.assertContinuousMath("y")
    await ui.continuousKeys("uG")
    await ui.waitForSource(CONTINUOUS_SOURCE)
    await ui.assertContinuousMath("x")

    await ui.clickContinuousText("delta", true)
    await ui.continuousKeys("0fdcweta")
    await ui.continuousKeys("Escape", true)
    const edited = CONTINUOUS_SOURCE.replace("delta", "eta")
    await ui.waitForSource(edited)
    await ui.assertContinuousText("eta", true)
    await ui.assertContinuousText("epsilon", true)
    await ui.continuousKeys("uG")
    await ui.waitForSource(CONTINUOUS_SOURCE)

    await ui.continuousKeys("gg2jddp")
    await ui.waitForSource(CONTINUOUS_SOURCE.replace("alpha beta gamma\n\n", "\nalpha beta gamma\n"))
    await ui.continuousKeys("uuG")
    await ui.waitForSource(CONTINUOUS_SOURCE)
    await ui.continuousSourceMode()
    await ui.showVisualMode()
    await ui.assertContinuousText("alpha beta gamma")
    await ui.clickContinuousText("Final paragraph.")
    await ui.continuousKeys("A Saved.")
    await ui.continuousKeys("Escape", true)
    const saved = CONTINUOUS_SOURCE.replace("Final paragraph.", "Final paragraph. Saved.")
    await ui.waitForSaved(saved)
    await ui.stopContinuousAuthoring()
    await ui.openWork("E2E document")
    await ui.waitForSource(saved)
  } finally {
    await ui.stopContinuousAuthoring()
    await ui.showSourceMode()
    await ui.restoreSource(original)
    await ui.waitForSaved(original)
  }
}

// The same session on the frozen long mathematical document. Source seeding
// is setup; all navigation, typing, deletion, undo and saves use the active
// editor without repairing its selection or retrying characters.
export async function continuousLongDocumentWorkflow(ui, source) {
  await ui.openWork("E2E document")
  const original = await ui.readSource()
  try {
    await ui.showSourceMode()
    await ui.startContinuousAuthoring()
    await ui.restoreSource(source)
    await ui.showVisualMode()
    await ui.continuousKeys("GiLong document session with equations")
    await ui.continuousKeys("Escape", true)
    const saved = source + "Long document session with equations"
    await ui.waitForSource(saved)
    await ui.continuousKeys("ggG0d2w")
    await ui.waitForSource(source + "session with equations")
    await ui.continuousKeys("u")
    await ui.waitForSaved(saved)
    await ui.stopContinuousAuthoring()
    await ui.openWork("E2E document")
    await ui.waitForSource(saved)
  } finally {
    await ui.stopContinuousAuthoring()
    await ui.showSourceMode()
    await ui.restoreSource(original)
    await ui.waitForSaved(original)
  }
}
