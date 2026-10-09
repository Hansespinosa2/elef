import assert from "node:assert/strict"
import test from "node:test"

import { createTauriHost } from "../src/tauri-host.js"

const MANIFESTLESS_ID = "path:abc123"

function deckSummary(overrides = {}) {
  return {
    id: MANIFESTLESS_ID,
    name: "Manifestless",
    kind: "presentation",
    modified_ms: 1_700_000_000_000,
    warnings: [],
    notices: [],
    ...overrides,
  }
}

function hostWith(calls, { snapshotSource = "# Deck\n", list = [deckSummary()] } = {}) {
  return createTauriHost({
    invoke: async (command, payload) => {
      calls.push([command, payload])
      if (command === "list_decks") return list
      if (command === "read_source_snapshot") return { source: snapshotSource, content_hash: "h1" }
      if (command === "open_deck") throw new Error("getWork must not open (and repair) decks")
      throw new Error(`unexpected command ${command}`)
    },
  })
}

test("getWork joins fresh text onto the listed summary without opening the deck", async () => {
  const calls = []
  const host = hostWith(calls)
  const [listed] = await host.library.listWorks()
  assert.equal(listed.id, MANIFESTLESS_ID)

  const snapshot = await host.works.getWork(MANIFESTLESS_ID)
  assert.equal(snapshot.id, MANIFESTLESS_ID)
  assert.equal(snapshot.title, "Manifestless")
  assert.equal(snapshot.text, "# Deck\n")
  assert.deepEqual(snapshot.baseline, { revision: "h1" })
  assert.deepEqual(calls.map(([command]) => command), ["list_decks", "read_source_snapshot"])
})

test("getWork for an unlisted id falls back to one list instead of opening", async () => {
  const calls = []
  const host = hostWith(calls)
  const snapshot = await host.works.getWork(MANIFESTLESS_ID)
  assert.equal(snapshot.id, MANIFESTLESS_ID)
  assert.equal(snapshot.text, "# Deck\n")
  assert.deepEqual(calls.map(([command]) => command), ["read_source_snapshot", "list_decks"])
})

test("rename refreshes the cached summary snapshots join onto", async () => {
  const calls = []
  const host = createTauriHost({
    invoke: async (command) => {
      calls.push(command)
      if (command === "list_decks") return [deckSummary()]
      if (command === "read_source_snapshot") return { source: "# Deck\n", content_hash: "h1" }
      if (command === "rename_deck") return deckSummary({ name: "Renamed" })
      throw new Error(`unexpected command ${command}`)
    },
  })
  await host.library.listWorks()
  const renamed = await host.library.renameWork(MANIFESTLESS_ID, "Renamed")
  assert.equal(renamed.title, "Renamed")
  const snapshot = await host.works.getWork(MANIFESTLESS_ID)
  assert.equal(snapshot.title, "Renamed")
  assert.ok(!calls.includes("open_deck"))
  assert.ok(!calls.includes("list_decks", 1))
})

test("first list serves the boot status without listing IPCs", async () => {
  const calls = []
  const host = createTauriHost({
    invoke: async (command) => {
      calls.push(command)
      throw new Error(`unexpected command ${command}`)
    },
    initialStatus: { root: "/lib", decks: [deckSummary()] },
  })
  assert.deepEqual(await host.library.listWorkspaces(), [{ id: "local", name: "/lib" }])
  const works = await host.library.listWorks()
  assert.equal(works.length, 1)
  assert.equal(works[0].id, MANIFESTLESS_ID)
  assert.deepEqual(calls, [])
  await assert.rejects(() => host.library.listWorks(), /unexpected command list_decks/)
  assert.deepEqual(await host.library.listWorkspaces(), [{ id: "local", name: "/lib" }])
})

test("noted decks serve the next list once", async () => {
  const calls = []
  const host = hostWith(calls)
  host.noteListedDecks([deckSummary({ name: "Noted" })])
  const works = await host.library.listWorks()
  assert.equal(works[0].title, "Noted")
  assert.deepEqual(calls.map(([command]) => command), [])
  const again = await host.library.listWorks()
  assert.equal(again[0].title, "Manifestless")
  assert.deepEqual(calls.map(([command]) => command), ["list_decks"])
})

test("mutations drop the noted decks", async () => {
  const calls = []
  const host = createTauriHost({
    invoke: async (command) => {
      calls.push(command)
      if (command === "list_decks") return [deckSummary()]
      if (command === "rename_deck") return deckSummary({ name: "Renamed" })
      throw new Error(`unexpected command ${command}`)
    },
  })
  host.noteListedDecks([deckSummary({ name: "Stale" })])
  await host.library.renameWork(MANIFESTLESS_ID, "Renamed")
  const works = await host.library.listWorks()
  assert.equal(works[0].title, "Manifestless")
  assert.deepEqual(calls, ["rename_deck", "list_decks"])
})

test("save drops the noted decks so the next list sees the new mtime", async () => {
  const calls = []
  const host = createTauriHost({
    invoke: async (command) => {
      calls.push(command)
      if (command === "list_decks") return [deckSummary({ modified_ms: 2_000 })]
      if (command === "save_source") return { content_hash: "h2" }
      throw new Error(`unexpected command ${command}`)
    },
  })
  host.noteListedDecks([deckSummary({ modified_ms: 1_000 })])
  await host.works.saveWork(MANIFESTLESS_ID, "# new", { revision: "h1" })
  const [work] = await host.library.listWorks()
  assert.equal(work.updatedAt, new Date(2_000).toISOString())
  assert.deepEqual(calls, ["save_source", "list_decks"])
})

test("root change invalidates the cached workspace", async () => {
  const calls = []
  let root = "/one"
  const host = createTauriHost({
    invoke: async (command) => {
      calls.push(command)
      if (command === "get_library_status") return { root, decks: [] }
      throw new Error(`unexpected command ${command}`)
    },
  })
  assert.deepEqual(await host.library.listWorkspaces(), [{ id: "local", name: "/one" }])
  assert.deepEqual(await host.library.listWorkspaces(), [{ id: "local", name: "/one" }])
  root = "/two"
  host.noteRootChanged()
  assert.deepEqual(await host.library.listWorkspaces(), [{ id: "local", name: "/two" }])
  assert.deepEqual(calls, ["get_library_status", "get_library_status"])
})

test("delete evicts the cached summary", async () => {
  let deleted = false
  const host = createTauriHost({
    invoke: async (command) => {
      if (command === "list_decks") return deleted ? [] : [deckSummary()]
      if (command === "read_source_snapshot") {
        if (deleted) throw new Error("missing")
        return { source: "# Deck\n", content_hash: "h1" }
      }
      if (command === "delete_deck") {
        deleted = true
        return { deleted: true }
      }
      throw new Error(`unexpected command ${command}`)
    },
  })
  await host.library.listWorks()
  await host.library.deleteWork(MANIFESTLESS_ID)
  await assert.rejects(() => host.works.getWork(MANIFESTLESS_ID), /missing/)
})
