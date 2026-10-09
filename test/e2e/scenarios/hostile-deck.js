export async function hostileDeckNeutralizedWorkflow(ui) {
  if (!["allow-remote", "reject-remote"].includes(ui.externalMediaPolicy)) {
    throw new Error(`Host must declare an external media policy: ${ui.externalMediaPolicy}`)
  }
  await ui.openDeck("E2E hostile")
  await ui.showVisualMode()
  await ui.waitForPreview("Safe preview text remains visible.")
  const state = await ui.inspectHostilePreview()
  const externalMediaViolation = ui.externalMediaPolicy === "reject-remote"
    ? state.externalMedia.length > 0 || state.remoteRequests.length > 0
    : !state.externalMedia.includes("https://example.invalid/tracker.png")
  if (state.scriptRan || state.eventRan || state.frameRan || state.inlineHandlers.length || state.executableElements.length || state.unsafeLinks.length || state.unsafeMedia.length || externalMediaViolation) {
    throw new Error(`Hostile Markdown violated the ${ui.externalMediaPolicy} host policy: ${JSON.stringify(state)}`)
  }
}
