export async function libraryAndGraphWorkflow(ui) {
  await ui.openLibrary()
  await ui.assertAllWorkKindsVisible("E2E seed", "E2E document")
  await ui.showPresentations()
  await ui.assertPresentationsOnly("E2E seed", "E2E document")
  await ui.showDocuments()
  await ui.assertDocumentsOnly("E2E document", "E2E seed")
  await ui.showDocumentGraph()
  await ui.openGraphDocument("E2E linked")
  await ui.assertDocumentOpened("E2E linked")
}
