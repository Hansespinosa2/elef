export async function snippetInsertWorkflow(ui) {
  await ui.openDeck()
  await ui.showSourceMode()
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
  await ui.showSourceMode()
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

export async function documentLinkCompletionWorkflow(ui) {
  await ui.openDeck("E2E document")
  await ui.showSourceMode()
  const original = await ui.readSource()
  const query = "[[E2E li"
  const pairedSource = `${query}]]`
  const completedSource = "[[E2E linked]]"

  try {
    await ui.replaceSource(pairedSource)
    await ui.setCaretPosition(query.length)
    await ui.refreshDocumentLinkPalette()
    await ui.waitForAuthoringOption("document-link", "E2E linked")
    await ui.selectAuthoringOption("document-link", "E2E linked")
    await ui.waitForSource(completedSource)
    await ui.waitForSaved(completedSource)
  } finally {
    if (await ui.readSource() !== original) {
      await ui.replaceSource(original)
      await ui.waitForSaved(original)
    }
  }
}
