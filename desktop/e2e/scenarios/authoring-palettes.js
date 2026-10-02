export async function snippetInsertWorkflow(ui) {
  await ui.openDeck()
  const prefix = (await ui.readSource()).trimEnd() + "\n"
  const query = `${prefix}/bold`

  await ui.replaceSource(query)
  await ui.waitForAuthoringOption("snippet", "Bold text")
  await ui.selectAuthoringOption("snippet", "Bold text")

  const expected = `${prefix}**text**`
  await ui.waitForSource(expected)
  await ui.waitForSaved(expected)
}

export async function mathInputWorkflow(ui) {
  await ui.openDeck()
  const prefix = (await ui.readSource()).trimEnd()
  const query = `${prefix}\n\n$$\n@a`

  await ui.replaceSource(query)
  await ui.waitForAuthoringOption("math", "Alpha")
  await ui.selectAuthoringOption("math", "Alpha")

  const inserted = `${prefix}\n\n$$\n\\alpha`
  await ui.waitForSource(inserted)
  const complete = `${inserted}\n$$\n`
  await ui.replaceSource(complete)
  await ui.waitForSaved(complete)
  await ui.showVisualMode()
  await ui.waitForPreview("α")
}
