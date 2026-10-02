export async function hostileDeckNeutralizedWorkflow(ui) {
  await ui.openDeck("E2E hostile")
  await ui.showVisualMode()
  await ui.waitForPreview("Safe preview text remains visible.")
  const state = await ui.inspectHostilePreview()
  const externalMediaViolation = ui.rejectExternalMedia && (state.externalMedia.length || state.remoteRequests.length)
  if (state.scriptRan || state.eventRan || state.inlineHandlers.length || state.executableElements.length || state.unsafeLinks.length || state.unsafeMedia.length || externalMediaViolation) {
    throw new Error(`Hostile Markdown reached an executable or remote preview surface: ${JSON.stringify(state)}`)
  }
}
