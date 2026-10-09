import assert from "node:assert/strict"
import test from "node:test"
import { parseHTML } from "linkedom"

import { setProjectionBlockEditable } from "../../../app/javascript/lib/projection_editability.js"

test("projection editability preserves the accessible state without repeating DOM writes", () => {
  const { document } = parseHTML("<div contenteditable=\"true\" role=\"textbox\" aria-label=\"Editable slide block\" aria-multiline=\"true\" spellcheck=\"true\"></div>")
  const block = document.querySelector("div")
  const writes = { set: 0, remove: 0 }
  const setAttribute = block.setAttribute.bind(block)
  const removeAttribute = block.removeAttribute.bind(block)
  block.setAttribute = (...args) => { writes.set += 1; return setAttribute(...args) }
  block.removeAttribute = (...args) => { writes.remove += 1; return removeAttribute(...args) }

  setProjectionBlockEditable(block, true, "Editable slide block")
  assert.deepEqual(writes, { set: 0, remove: 0 })
  assert.equal(block.getAttribute("contenteditable"), "true")
  assert.equal(block.getAttribute("aria-label"), "Editable slide block")

  setProjectionBlockEditable(block, false, "Editable slide block")
  assert.equal(block.getAttribute("contenteditable"), "false")
  assert.equal(block.hasAttribute("role"), false)
  assert.equal(block.hasAttribute("aria-label"), false)
  assert.equal(block.hasAttribute("aria-multiline"), false)
  assert.equal(block.hasAttribute("spellcheck"), false)
  assert.equal(block.getAttribute("aria-readonly"), "true")

  const readonlyWrites = { ...writes }
  setProjectionBlockEditable(block, false, "Editable slide block")
  assert.deepEqual(writes, readonlyWrites)
})
