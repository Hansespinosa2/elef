const filterAssertions = {
  documents: ui => ui.assertDocumentsOnly("E2E document"),
  presentations: ui => ui.assertPresentationsOnly("E2E seed", "E2E document"),
  all: ui => ui.assertAllWorkKindsVisible("E2E seed", "E2E document")
}

export const libraryDeepLinkFilters = Object.keys(filterAssertions)

export async function libraryDeepLinksWorkflow(ui, filter) {
  await ui.openLibraryDeepLink(filter)
  await filterAssertions[filter](ui)

  if (filter === "all") {
    // In-app hash moves sync the filter without a reload.
    await ui.setLibraryHash("documents")
    await filterAssertions.documents(ui)
    await ui.setLibraryHash("all")
    await filterAssertions.all(ui)
  }
}
