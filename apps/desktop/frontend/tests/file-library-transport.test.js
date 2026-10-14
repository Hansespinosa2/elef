import assert from "node:assert/strict"
import test from "node:test"

import { createFileLibraryTransport } from "../src/file-library-transport.js"
import { createFileLibraryTransport as createStableFileLibraryTransport } from "../src/file-library-transport-stable.js"

test("the file library transport keeps native command names and payloads at the desktop boundary", async () => {
  const calls = []
  const transport = createFileLibraryTransport({
    invoke: async (command, payload) => {
      calls.push([command, payload])
      if (command === "export_elef") return true
      return command === "pending_open_elef_count" ? 2 : { ok: true }
    }
  })

  await transport.getLibraryStatus()
  await transport.listWorkFolders()
  await transport.chooseLibraryRoot()
  await transport.createWorkFolder("Notes", "document")
  await transport.renameWorkFolder("work-id", "Renamed")
  await transport.deleteWorkFolder("work-id")
  await transport.readSourcePreview("work-id")
  await transport.readDocumentGraph()
  await transport.readAuthoringRegistries()
  await transport.writeAuthoringRegistry({ registry: "snippets", entries: [] })
  await transport.readLibraryConfig()
  await transport.writeLibraryConfig({ theme: "light" })
  await transport.exportElef("work-id")
  await transport.importElef()
  await transport.importOpenedElef()
  await transport.resolveImportConflict("keep_both")
  await transport.pendingOpenedElefCount()
  await transport.confirmAppReady()
  await transport.exportDiagnostics()
  await transport.printWork()

  assert.deepEqual(calls, [
    ["get_library_status", undefined],
    ["list_work_folders", undefined],
    ["choose_library_root", undefined],
    ["create_work_folder", { name: "Notes", kind: "document" }],
    ["rename_work_folder", { id: "work-id", name: "Renamed" }],
    ["delete_work_folder", { id: "work-id" }],
    ["read_work_folder_preview", { id: "work-id" }],
    ["document_graph", undefined],
    ["read_authoring_registries", undefined],
    ["write_authoring_registry", { registry: "snippets", entries: [] }],
    ["read_library_config", undefined],
    ["write_library_config", { config: { theme: "light" } }],
    ["export_elef", { id: "work-id" }],
    ["import_elef", undefined],
    ["import_opened_elef", undefined],
    ["resolve_import_conflict", { resolution: "keep_both" }],
    ["pending_open_elef_count", undefined],
    ["confirm_app_ready", undefined],
    ["export_diagnostics", undefined],
    ["print_work", undefined]
  ])
})

test("the stable file library transport keeps the base commands and omits the document graph", async () => {
  const calls = []
  const transport = createStableFileLibraryTransport({
    invoke: async (command, payload) => {
      calls.push([command, payload])
      return { ok: true }
    }
  })

  assert.equal(typeof transport.readDocumentGraph, "undefined")
  await transport.listWorkFolders()
  await transport.readSourcePreview("work-id")
  await transport.exportDiagnostics()
  await transport.printWork()

  assert.deepEqual(calls, [
    ["list_work_folders", undefined],
    ["read_work_folder_preview", { id: "work-id" }],
    ["export_diagnostics", undefined],
    ["print_work", undefined]
  ])
})
