import assert from "node:assert/strict"
import test from "node:test"
import { parseHTML } from "linkedom"

import { setProjectionBlockEditable } from "@elef/editor-runtime/test-internals"

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

test("marking a block readonly changes attributes only, never content or structure", async () => {
  const { markProjectionBlocksReadOnly } = await import("@elef/editor-runtime/test-internals")
  const { document } = parseHTML(
    `<div class="editor-projection"><div data-editor-block-id="b1" contenteditable="true" role="textbox"><h1>Title</h1><p>Body <strong>bold</strong></p></div></div>`
  )
  const projection = document.querySelector(".editor-projection")

  markProjectionBlocksReadOnly(projection)

  const blocks = projection.querySelectorAll("[data-editor-block-id]")
  assert.equal(blocks.length, 1)
  const block = blocks[0]
  assert.equal(block.tagName, "DIV")
  assert.equal(block.getAttribute("contenteditable"), "false")
  assert.equal(block.getAttribute("aria-readonly"), "true")
  assert.equal(block.innerHTML, '<h1>Title</h1><p>Body <strong>bold</strong></p>')
  assert.equal(block.querySelectorAll("*").length, 3)
})
