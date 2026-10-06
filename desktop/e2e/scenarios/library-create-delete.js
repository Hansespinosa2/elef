export const SHARED_LIBRARY_CREATE_DELETE_TITLE = "E2E shared library operation"

export async function libraryCreateDeleteWorkflow(ui) {
  await ui.openLibrary()
  await ui.createWork(SHARED_LIBRARY_CREATE_DELETE_TITLE, "presentation")
  await ui.assertCreatedWork(SHARED_LIBRARY_CREATE_DELETE_TITLE)
  await ui.openLibrary()
  await ui.assertWorkVisible(SHARED_LIBRARY_CREATE_DELETE_TITLE)
  await ui.deleteWork(SHARED_LIBRARY_CREATE_DELETE_TITLE)
  await ui.assertWorkAbsent(SHARED_LIBRARY_CREATE_DELETE_TITLE)
}
