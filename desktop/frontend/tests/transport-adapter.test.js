import assert from "node:assert/strict"
import test from "node:test"

import { createTransportAdapter } from "../src/transport-adapter.js"

const hashA = "a".repeat(64)
const hashB = "b".repeat(64)

test("save sends the last loaded hash and advances it after success", async () => {
  const calls = []
  const adapter = createTransportAdapter({
    invoke: async (command, payload) => {
      calls.push([command, payload])
      if (command === "open_deck") return { id: "deck-1", content_hash: hashA }
      return { ok: true, content_hash: hashB }
    }
  })

  await adapter.openDeck("deck-1")
  await adapter.saveSource("deck-1", "# edited")
  await adapter.saveSource("deck-1", "# edited again")

  assert.deepEqual(calls.map(([, payload]) => payload.baseHash), [undefined, hashA, hashB])
  assert.equal("base_hash" in calls[1][1], false)
  assert.equal(calls[1][1].source, "# edited")
})

test("conflicts preserve the base hash until the user accepts the disk version", async () => {
  const saves = []
  const conflicts = []
  let conflict = true
  const adapter = createTransportAdapter({
    onConflict: event => conflicts.push(event),
    invoke: async (command, payload) => {
      if (command === "open_deck") return { id: "deck-1", content_hash: hashA }
      saves.push(payload)
      if (conflict) {
        throw {
          code: "conflict",
          details: { disk_hash: hashB, current: { source: "# from disk" } }
        }
      }
      return { ok: true, content_hash: hashA }
    }
  })

  await adapter.openDeck("deck-1")
  await assert.rejects(adapter.saveSource("deck-1", "# local"), error => error.code === "conflict")
  assert.equal(conflicts[0].source, "# local")
  assert.equal(saves[0].baseHash, hashA)

  conflict = false
  adapter.acceptDiskVersion("deck-1", hashB)
  await adapter.saveSource("deck-1", "# keep local")
  assert.equal(saves[1].baseHash, hashB)
})

test("first-open manifest creation and UUID repair save with the returned identity", async () => {
  for (const requested of ["path:manifestless", "duplicate-old-uuid"]) {
    const calls = []
    const adapter = createTransportAdapter({ invoke: async (command, payload) => {
      calls.push([command, payload])
      if (command === "open_deck") return { id: "new-uuid", source: "old", content_hash: hashA }
      return { content_hash: hashB }
    } })
    const deck = await adapter.openDeck(requested)
    await adapter.saveSource(deck.id, "edited")
    assert.deepEqual(calls[1], ["save_source", { id: "new-uuid", source: "edited", baseHash: hashA }])
    await assert.rejects(adapter.saveSource(requested, "stale"), error => error.code === "not_found")
  }
})
