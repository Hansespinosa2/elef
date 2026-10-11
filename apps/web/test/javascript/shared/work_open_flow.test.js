import test from "node:test"
import assert from "node:assert/strict"
import { createWorkOpenFlow } from "@elef/editor-runtime/test-internals"

test("concurrent work opens cannot replace editor state in reverse read order", async () => {
  let resolve
  const pending = new Promise(done => { resolve = done })
  const order = []
  const open = createWorkOpenFlow(async id => {
    order.push(`read ${id}`)
    if (id === "A") await pending
    order.push(`activate ${id}`)
  })
  const a = open("A")
  const b = open("B")
  await Promise.resolve()
  assert.deepEqual(order, ["read A"])
  resolve()
  await Promise.all([a, b])
  assert.deepEqual(order, ["read A", "activate A", "read B", "activate B"])
})

test("a rejected open does not prevent the next navigation", async () => {
  const open = createWorkOpenFlow(async id => {
    if (id === "missing") throw new Error("not found")
    return id
  })
  await assert.rejects(open("missing"), /not found/)
  assert.equal(await open("next"), "next")
})
