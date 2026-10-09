import assert from "node:assert/strict"
import test from "node:test"
import { createDocumentGraphCache } from "../../../app/javascript/lib/document_graph_cache.js"

function deferred() {
  let resolve
  const promise = new Promise(yes => { resolve = yes })
  return { promise, resolve }
}

test("a graph request in flight during invalidation cannot restore stale nodes", async () => {
  const beforeSave = deferred()
  const afterSave = deferred()
  const requests = [beforeSave, afterSave]
  let loads = 0
  const cache = createDocumentGraphCache(() => requests[loads++].promise)

  const firstPreview = cache.get()
  await Promise.resolve()
  assert.equal(loads, 1)

  cache.invalidate()
  const secondPreview = cache.get()
  await Promise.resolve()
  assert.equal(loads, 2)

  const latestGraph = { nodes: [{ id: "new-target" }] }
  beforeSave.resolve({ nodes: [{ id: "old-target" }] })
  afterSave.resolve(latestGraph)

  assert.deepEqual(await firstPreview, latestGraph)
  assert.deepEqual(await secondPreview, latestGraph)
  assert.deepEqual(await cache.get(), latestGraph)
  assert.equal(loads, 2)
})
