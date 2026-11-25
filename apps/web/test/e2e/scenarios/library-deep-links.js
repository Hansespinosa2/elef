export const libraryDeepLinkScenarios = {
  async documents(ui) {
    await ui.openLibraryDeepLink("documents")
    await ui.assertDocumentsOnly("E2E document")
  },

  async presentations(ui) {
    await ui.openLibraryDeepLink("presentations")
    await ui.assertPresentationsOnly("E2E seed", "E2E document")
  },

  async all(ui) {
    await ui.openLibraryDeepLink("all")
    await ui.assertAllWorkKindsVisible("E2E seed", "E2E document")

    // In-app hash moves sync the filter without a reload.
    await ui.setLibraryHash("documents")
    await ui.assertDocumentsOnly("E2E document")
    await ui.setLibraryHash("all")
    await ui.assertAllWorkKindsVisible("E2E seed", "E2E document")
  }
}
