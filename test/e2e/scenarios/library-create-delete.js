export const SHARED_LIBRARY_CREATE_DELETE_TITLES = Object.freeze({
  presentation: "E2E shared presentation operation",
  document: "E2E shared document operation"
})

export async function libraryCreateDeleteWorkflow(ui) {
  for (const [kind, title] of Object.entries(SHARED_LIBRARY_CREATE_DELETE_TITLES)) {
    await ui.openLibrary()
    await ui.createWork(title, kind)
    await ui.assertCreatedWork(title, kind)
    await ui.openLibrary()
    await ui.assertWorkVisible(title)
    await ui.deleteWork(title)
    await ui.assertWorkAbsent(title)
  }
}
