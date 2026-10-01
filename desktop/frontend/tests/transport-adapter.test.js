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

  assert.deepEqual(calls.map(([, payload]) => payload.base_hash), [undefined, hashA, hashB])
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
  assert.equal(saves[0].base_hash, hashA)

  conflict = false
  adapter.acceptDiskVersion("deck-1", hashB)
  await adapter.saveSource("deck-1", "# keep local")
  assert.equal(saves[1].base_hash, hashB)
})
