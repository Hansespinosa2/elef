export const CONFLICT_LOCAL_SOURCE = "# Local draft\n\nKeep this in the conflict dialog.\n"
export const CONFLICT_EXTERNAL_SOURCE = "# External edit\n\nThese bytes must survive.\n"

export async function externalEditConflictWorkflow(ui) {
  await ui.openDeck("E2E conflict")
  await ui.pauseAutosave()
  await ui.replaceSource(CONFLICT_LOCAL_SOURCE)
  await ui.writeExternalSource(CONFLICT_EXTERNAL_SOURCE)
  await ui.flushLocalSave()
  await ui.waitForConflict()
  await ui.assertConflict(CONFLICT_LOCAL_SOURCE, CONFLICT_EXTERNAL_SOURCE)
  await ui.useDiskVersion()
  await ui.waitForSource(CONFLICT_EXTERNAL_SOURCE)
  await ui.assertDiskSource(CONFLICT_EXTERNAL_SOURCE)
}
