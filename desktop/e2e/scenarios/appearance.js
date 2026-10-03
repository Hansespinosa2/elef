export async function appearanceWorkflow(ui) {
  await ui.openDeck()
  const original = await ui.readSource()
  await ui.showVisualMode()
  await ui.setAppearance("theme", "dark")
  await ui.setAppearance("typography", "technical")
  const styled = await ui.readSource()
  if (!/^theme: dark$/m.test(styled) || !/^typography: technical$/m.test(styled)) {
    throw new Error("Appearance choices did not persist in Markdown front matter")
  }
  await ui.waitForSaved(styled)
  await ui.reopenDeck()
  await ui.showVisualMode()
  await ui.assertAppearance("dark", "technical")
  await ui.showSourceMode()
  await ui.replaceSource(original)
  await ui.waitForSource(original)
  await ui.waitForSaved(original)
}
