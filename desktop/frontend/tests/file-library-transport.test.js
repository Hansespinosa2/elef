import assert from "node:assert/strict"
import test from "node:test"

import { createFileLibraryTransport } from "../src/file-library-transport.js"

test("the file library transport keeps native command names and payloads at the desktop boundary", async () => {
  const calls = []
  const transport = createFileLibraryTransport({
    invoke: async (command, payload) => {
      calls.push([command, payload])
      if (command === "export_elef" || command === "export_diagnostics") return true
      return command === "pending_open_elef_count" ? 2 : { ok: true }
    }
  })

  await transport.getLibraryStatus()
  await transport.listDecks()
  await transport.chooseLibraryRoot()
  await transport.createDeck("Notes", "document")
  await transport.renameDeck("deck-id", "Renamed")
  await transport.deleteDeck("deck-id")
  await transport.readSourcePreview("deck-id")
  await transport.readDocumentGraph()
  await transport.readAuthoringRegistries()
  await transport.writeAuthoringRegistry({ registry: "snippets", entries: [] })
  await transport.readLibraryConfig()
  await transport.writeLibraryConfig({ theme: "light" })
  await transport.exportElef("deck-id")
  await transport.importElef()
  await transport.importOpenedElef()
  await transport.resolveImportConflict("keep_both")
  await transport.pendingOpenedElefCount()
  await transport.confirmAppReady()
  await transport.exportDiagnostics()

  assert.deepEqual(calls, [
    ["get_library_status", undefined],
    ["list_decks", undefined],
    ["choose_library_root", undefined],
    ["create_deck", { name: "Notes", kind: "document" }],
    ["rename_deck", { id: "deck-id", name: "Renamed" }],
    ["delete_deck", { id: "deck-id" }],
    ["read_deck_preview", { id: "deck-id" }],
    ["document_graph", undefined],
    ["read_authoring_registries", undefined],
    ["write_authoring_registry", { registry: "snippets", entries: [] }],
    ["read_library_config", undefined],
    ["write_library_config", { config: { theme: "light" } }],
    ["export_elef", { id: "deck-id" }],
    ["import_elef", undefined],
    ["import_opened_elef", undefined],
    ["resolve_import_conflict", { resolution: "keep_both" }],
    ["pending_open_elef_count", undefined],
    ["confirm_app_ready", undefined],
    ["export_diagnostics", undefined]
  ])
})
