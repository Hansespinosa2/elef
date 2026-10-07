export const CONFLICT_LOCAL_SOURCE = "# Local draft\n\nKeep this in the conflict dialog.\n"
export const CONFLICT_EXTERNAL_SOURCE = "# External edit\n\nThese bytes must survive.\n"
export const CONFLICT_MERGED_SOURCE = "# Merged version\n\nKeep the useful parts from both edits.\n"
export const CONFLICT_BASELINE_SOURCE = "# Before conflict test\n\nSeed paragraph.\n"

export async function externalEditConflictWorkflow(ui, resolution = "disk") {
  await ui.writeExternalSource(CONFLICT_BASELINE_SOURCE)
  await ui.openDeck("E2E conflict")
  await ui.pauseAutosave()
  await ui.replaceSource(CONFLICT_LOCAL_SOURCE)
  await ui.writeExternalSource(CONFLICT_EXTERNAL_SOURCE)
  await ui.flushLocalSave()
  await ui.waitForConflict()
  await ui.assertConflict(CONFLICT_LOCAL_SOURCE, CONFLICT_EXTERNAL_SOURCE)

  if (resolution === "disk") {
    await ui.useDiskVersion()
    await ui.waitForSource(CONFLICT_EXTERNAL_SOURCE)
    await ui.assertDiskSource(CONFLICT_EXTERNAL_SOURCE)
  } else if (resolution === "local") {
    await ui.keepLocalVersion()
    await ui.waitForSaved(CONFLICT_LOCAL_SOURCE)
    await ui.assertDiskSource(CONFLICT_LOCAL_SOURCE)
  } else if (resolution === "merge") {
    await ui.editMergedSource(CONFLICT_MERGED_SOURCE)
    await ui.saveMergedVersion()
    await ui.waitForSaved(CONFLICT_MERGED_SOURCE)
    await ui.assertDiskSource(CONFLICT_MERGED_SOURCE)
  } else {
    throw new Error(`Unsupported shared conflict resolution: ${resolution}`)
  }
}
