export async function libraryDeepLinksWorkflow(ui) {
  // Full-boot deep links land on the requested filter.
  await ui.openLibraryDeepLink("documents")
  await ui.assertDocumentsOnly("E2E document")
  await ui.openLibraryDeepLink("presentations")
  await ui.assertPresentationsOnly("E2E seed", "E2E document")
  await ui.openLibraryDeepLink("all")
  await ui.assertAllWorkKindsVisible("E2E seed", "E2E document")
  // In-app hash moves sync the filter without a reload.
  await ui.setLibraryHash("documents")
  await ui.assertDocumentsOnly("E2E document")
  await ui.setLibraryHash("all")
  await ui.assertAllWorkKindsVisible("E2E seed", "E2E document")
}
