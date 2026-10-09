import assert from "node:assert/strict"
import test from "node:test"
import { parseHTML } from "linkedom"

import { createIncrementalList, LIBRARY_RENDER_BATCH_SIZE } from "../../app/javascript/lib/incremental_list.js"

test("renders the first list batch immediately and appends later batches in order", () => {
  const { document } = parseHTML("<html><body><ul></ul></body></html>")
  const batches = []
  const list = createIncrementalList(document.querySelector("ul"), {
    batchSize: 2
  })

  assert.equal(list.render(["a", "b", "c", "d", "e"], value => {
    const item = document.createElement("li")
    item.textContent = value
    return item
  }, { onAppend: nodes => batches.push(nodes.map(node => node.textContent)) }), 5)
  assert.deepEqual([...document.querySelectorAll("li")].map(node => node.textContent), ["a", "b"])
  assert.deepEqual(batches, [["a", "b"]])
  assert.equal(list.renderedCount, 2)
  assert.equal(list.hasMore, true)

  assert.equal(list.appendNext(), true)
  assert.equal(list.appendNext(), false)
  assert.deepEqual([...document.querySelectorAll("li")].map(node => node.textContent), ["a", "b", "c", "d", "e"])
  assert.deepEqual(batches, [["a", "b"], ["c", "d"], ["e"]])
  assert.equal(list.renderedCount, 5)
  assert.equal(list.hasMore, false)
})

test("a new list render replaces the earlier list and restarts paging", () => {
  const { document } = parseHTML("<html><body><ul></ul></body></html>")
  const list = createIncrementalList(document.querySelector("ul"), {
    batchSize: 1
  })
  const render = values => list.render(values, value => {
    const item = document.createElement("li")
    item.textContent = value
    return item
  })

  render(["old-1", "old-2"])
  render(["new-1", "new-2"])

  assert.deepEqual([...document.querySelectorAll("li")].map(node => node.textContent), ["new-1"])
  assert.equal(list.hasMore, true)
  list.appendNext()
  assert.deepEqual([...document.querySelectorAll("li")].map(node => node.textContent), ["new-1", "new-2"])
})

test("the native library batch bound is smaller than a large library", () => {
  assert.equal(LIBRARY_RENDER_BATCH_SIZE, 48)
  assert.ok(LIBRARY_RENDER_BATCH_SIZE < 1000)
})
