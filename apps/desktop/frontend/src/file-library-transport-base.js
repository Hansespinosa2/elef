import { createExportTransport } from "./export-transport.js"

export function createBaseFileLibraryTransport({ invoke, pptxSeams } = {}) {
  const pptxExport = createExportTransport({ invoke, ...pptxSeams })
  return {
    getLibraryStatus: () => invoke("get_library_status"),
    listWorkFolders: () => invoke("list_work_folders"),
    chooseLibraryRoot: () => invoke("choose_library_root"),
    createWorkFolder: (name, kind) => invoke("create_work_folder", { name, kind }),
    renameWorkFolder: (id, name) => invoke("rename_work_folder", { id, name }),
    deleteWorkFolder: id => invoke("delete_work_folder", { id }),
    readSourcePreview: id => invoke("read_work_folder_preview", { id }),
    readAuthoringRegistries: () => invoke("read_authoring_registries"),
    writeAuthoringRegistry: payload => invoke("write_authoring_registry", payload),
    readLibraryConfig: () => invoke("read_library_config"),
    writeLibraryConfig: config => invoke("write_library_config", { config }),
    exportElef: id => invoke("export_elef", { id }),
    exportPptx: (workId, input) => pptxExport.exportPresentationPptx(workId, input),
    importElef: () => invoke("import_elef"),
    importOpenedElef: () => invoke("import_opened_elef"),
    resolveImportConflict: resolution => invoke("resolve_import_conflict", { resolution }),
    pendingOpenedElefCount: () => invoke("pending_open_elef_count"),
    confirmAppReady: () => invoke("confirm_app_ready"),
    confirmDiscardUnsavedChanges: () => invoke("confirm_discard_unsaved_changes"),
    exportDiagnostics: () => invoke("export_diagnostics")
  }
}
