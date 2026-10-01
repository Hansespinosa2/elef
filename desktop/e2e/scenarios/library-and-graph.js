export async function libraryAndGraphWorkflow(ui) {
  await ui.openLibrary()
  await ui.showDocuments()
  await ui.assertDocumentsOnly("E2E document", "E2E seed")
  await ui.showDocumentGraph()
  await ui.openGraphDocument("E2E linked")
  await ui.assertDocumentOpened("E2E linked")
}
