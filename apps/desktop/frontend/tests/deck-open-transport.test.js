import test from "node:test"
import assert from "node:assert/strict"
import { prepareDeckOpen } from "@elef/editor-runtime/test-internals"
import { createTransportAdapter } from "../src/transport-adapter.js"

const hashA = "a".repeat(64)
const hashB = "b".repeat(64)
const deferred = () => {
  let resolve
  const promise = new Promise(done => { resolve = done })
  return { promise, resolve }
}

test("same-deck reopen rereads edits saved while its earlier snapshot was pending", async () => {
  const reading = deferred()
  let disk = { id: "A", source: "original", content_hash: hashA }
  let source = disk.source
  let reads = 0
  const saves = []
  const adapter = createTransportAdapter({ invoke: async (command, args) => {
    if (command === "open_deck") {
      if (++reads === 2) return reading.promise
      return { ...disk }
    }
    saves.push(args)
    assert.equal(args.baseHash, disk.content_hash)
    disk = { ...disk, source: args.source, content_hash: hashB }
    return { content_hash: hashB }
  } })
  await adapter.openDeck("A")
  let baseline = source
  const opening = prepareDeckOpen("A", {
    read: id => adapter.readDeck(id), prepare: async () => ({}),
    isDirty: () => source !== baseline,
    flushSave: async () => { await adapter.saveSource("A", source); baseline = source; return true }
  })
  source = "edited while reopening"
  reading.resolve({ id: "A", source: "original", content_hash: hashA })
  const transition = await opening
  assert.equal(transition.deck.source, source)
  assert.equal(transition.deck.content_hash, hashB)
  assert.equal(reads, 3)
  assert.deepEqual(saves, [{ id: "A", source, baseHash: hashA }])
})

test("a same-deck read never authorizes overwriting an external version while local edits are pending", async () => {
  const reading = deferred()
  let reads = 0
  let local = "original"
  const disk = { id: "A", source: "external", content_hash: hashB }
  const saves = []
  const adapter = createTransportAdapter({ invoke: async (command, args) => {
    if (command === "open_deck") return ++reads === 1
      ? { id: "A", source: "original", content_hash: hashA } : reading.promise
    saves.push(args)
    if (args.baseHash !== disk.content_hash) throw { code: "conflict" }
    assert.fail("An external version must not be overwritten")
  } })
  await adapter.openDeck("A")
  const opening = prepareDeckOpen("A", {
    read: id => adapter.readDeck(id), prepare: async () => ({}), isDirty: () => local !== "original",
    flushSave: async () => {
      try { await adapter.saveSource("A", local); return true }
      catch (error) { assert.equal(error.code, "conflict"); return false }
    }
  })
  local = "pending local edits"
  reading.resolve({ ...disk })
  assert.equal(await opening, null)
  assert.equal(saves[0].baseHash, hashA)
  assert.equal(disk.source, "external")
  assert.equal(local, "pending local edits")
})

test("typing during a new document's graph preparation saves to the old deck before activation", async () => {
  const graph = deferred()
  const disk = {
    A: { id: "A", source: "A original", content_hash: hashA },
    B: { id: "B", source: "B original", content_hash: hashB }
  }
  let owner = "A"
  let local = disk.A.source
  let baseline = local
  const saves = []
  const adapter = createTransportAdapter({ invoke: async (command, args) => {
    if (command === "open_deck") return { ...disk[args.id] }
    saves.push(args)
    assert.equal(args.id, "A")
    assert.equal(args.baseHash, hashA)
    disk.A.source = args.source
    return { content_hash: hashA }
  } })
  await adapter.openDeck("A")
  const opening = prepareDeckOpen("B", {
    read: id => adapter.readDeck(id), prepare: async () => { await graph.promise; return { titles: ["A", "B"] } },
    isDirty: () => local !== baseline,
    flushSave: async () => { await adapter.saveSource(owner, local); baseline = local; return true }
  })
  await Promise.resolve()
  local = "A typed during graph load"
  assert.equal(owner, "A")
  graph.resolve()
  const transition = await opening
  assert.equal(disk.A.source, local)
  assert.equal(disk.B.source, "B original")
  assert.equal(saves.length, 1)
  assert.equal(owner, "A", "Preparation must not change save ownership")
  local = transition.deck.source
  adapter.activateDeck(transition.deck)
  owner = transition.deck.id
  assert.equal(owner, "B")
  assert.equal(local, "B original")
})

test("same-deck autosave completing during preparation invalidates an earlier clean snapshot", async () => {
  const graph = deferred()
  let disk = { id: "A", source: "old", content_hash: hashA }
  let revision = 0
  let reads = 0
  const opening = prepareDeckOpen("A", {
    read: async () => { reads += 1; return { ...disk } },
    prepare: async () => { await graph.promise; return {} },
    isDirty: () => false, getRevision: () => revision,
    flushSave: () => assert.fail("Autosave already completed")
  })
  await Promise.resolve()
  disk = { id: "A", source: "already autosaved", content_hash: hashB }
  revision += 1
  graph.resolve()
  const transition = await opening
  assert.equal(reads, 2)
  assert.equal(transition.deck.source, "already autosaved")
  assert.equal(transition.deck.content_hash, hashB)
  assert.equal(transition.revision, revision)
})
