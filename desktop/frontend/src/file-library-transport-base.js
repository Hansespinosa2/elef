export function createBaseFileLibraryTransport({ invoke }) {
  return {
    getLibraryStatus: () => invoke("get_library_status"),
    listDecks: () => invoke("list_decks"),
    chooseLibraryRoot: () => invoke("choose_library_root"),
    createDeck: (name, kind) => invoke("create_deck", { name, kind }),
    renameDeck: (id, name) => invoke("rename_deck", { id, name }),
    deleteDeck: id => invoke("delete_deck", { id }),
    readSourcePreview: id => invoke("read_deck_preview", { id }),
    readAuthoringRegistries: () => invoke("read_authoring_registries"),
    writeAuthoringRegistry: payload => invoke("write_authoring_registry", payload),
    readLibraryConfig: () => invoke("read_library_config"),
    writeLibraryConfig: config => invoke("write_library_config", { config }),
    exportElef: id => invoke("export_elef", { id }),
    importElef: () => invoke("import_elef"),
    importOpenedElef: () => invoke("import_opened_elef"),
    resolveImportConflict: resolution => invoke("resolve_import_conflict", { resolution }),
    pendingOpenedElefCount: () => invoke("pending_open_elef_count"),
    confirmAppReady: () => invoke("confirm_app_ready"),
    exportDiagnostics: () => invoke("export_diagnostics")
  }
}
