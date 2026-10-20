import test, { after } from "node:test"
import assert from "node:assert/strict"
import { parseHTML } from "linkedom"
import {
  pointAtVisibleOffset,
  sourceOffsetForVisibleOffset,
  visibleOffsetAtPoint,
  visibleOffsetForSourceOffset,
} from "@elef/editor-runtime/test-internals"

// The caret walkers run against linkedom DOM with a minimal Node shim.
const nodeDescriptor = Object.getOwnPropertyDescriptor(globalThis, "Node")
Object.defineProperty(globalThis, "Node", { configurable: true, writable: true, value: { ELEMENT_NODE: 1, TEXT_NODE: 3 } })
after(() => {
  if (nodeDescriptor) Object.defineProperty(globalThis, "Node", nodeDescriptor)
  else delete globalThis.Node
})

const LIST_HTML = `<div data-editor-block-id="b1"><ul>\n<li>one</li>\n<li>two</li>\n<li>three</li>\n</ul>\n</div>`
const LIST_SOURCE = "- one\n- two\n- three\n"

function listBlock() {
  const { document } = parseHTML(LIST_HTML)
  return document.querySelector("[data-editor-block-id]")
}

test("visible offsets skip pretty-printing whitespace between elements", () => {
  const block = listBlock()
  const two = block.querySelectorAll("li")[1].firstChild

  assert.equal(visibleOffsetAtPoint(block, two, 1), 4)
  assert.equal(visibleOffsetAtPoint(block, block.querySelectorAll("li")[2].firstChild, 5), 11)
})

test("visible offsets resolve back into pretty-printed content", () => {
  const block = listBlock()
  const two = block.querySelectorAll("li")[1].firstChild

  const [node, offset] = pointAtVisibleOffset(block, 4)
  assert.equal(node, two)
  assert.equal(offset, 1)
})

test("caret mapping agrees with the source map on concealed markers", () => {
  assert.equal(sourceOffsetForVisibleOffset(LIST_SOURCE, 4), 9)
  assert.equal(visibleOffsetForSourceOffset(LIST_SOURCE, 9), 4)
  assert.equal(sourceOffsetForVisibleOffset(LIST_SOURCE, 0), 2)
  assert.equal(visibleOffsetForSourceOffset(LIST_SOURCE, 2), 0)
})

test("rendered spaces stay counted", () => {
  const { document } = parseHTML(`<div data-editor-block-id="b1"><p>a <b>b</b></p></div>`)
  const block = document.querySelector("[data-editor-block-id]")
  const bold = block.querySelector("b").firstChild

  assert.equal(visibleOffsetAtPoint(block, bold, 1), 3)
  const [node, offset] = pointAtVisibleOffset(block, 3)
  assert.equal(node, bold)
  assert.equal(offset, 1)
})

test("embedded newlines stay invisible everywhere", () => {
  const { document } = parseHTML(`<div data-editor-block-id="b1"><pre><span>a</span>\n<span>b</span></pre></div>`)
  const block = document.querySelector("[data-editor-block-id]")
  const second = block.querySelectorAll("span")[1].firstChild

  assert.equal(visibleOffsetAtPoint(block, second, 0), 1)
})

test("softbreak newlines inside text stay invisible", () => {
  const { document } = parseHTML(
    `<div data-editor-block-id="b1"><p>This uses most:\n<strong>emphasis</strong>, <em>qualification</em></p></div>`,
  )
  const block = document.querySelector("[data-editor-block-id]")
  const emphasis = block.querySelector("strong").firstChild
  const qualification = block.querySelector("em").firstChild

  assert.equal(visibleOffsetAtPoint(block, emphasis, 0), 15)
  assert.equal(visibleOffsetAtPoint(block, qualification, 0), 25)
})

test("inverse offsets land before skipped newlines", () => {
  const { document } = parseHTML(`<div data-editor-block-id="b1"><p>a\nb</p></div>`)
  const block = document.querySelector("[data-editor-block-id]")
  const text = block.querySelector("p").firstChild

  assert.equal(visibleOffsetAtPoint(block, text, 1), 1)
  assert.equal(visibleOffsetAtPoint(block, text, 2), 1)
  const [node, offset] = pointAtVisibleOffset(block, 1)
  assert.equal(node, text)
  assert.equal(offset, 1)
})

test("screen-reader and hidden runs stay skipped", () => {
  const { document } = parseHTML(
    `<div data-editor-block-id="b1">E<span class="katex-mathml">E = mc^2</span><span aria-hidden="true">×</span></div>`,
  )
  const block = document.querySelector("[data-editor-block-id]")

  assert.equal(visibleOffsetAtPoint(block, block.firstChild, 1), 1)
})

test("active math roots count raw newlines for identity mapping", () => {
  const { document } = parseHTML(
    `<div data-editor-block-id="b1"><span class="editor-math-active editor-live-math-display">$$\\n\\n$$</span></div>`,
  )
  const math = document.querySelector(".editor-math-active")
  const text = math.firstChild

  assert.equal(visibleOffsetAtPoint(math, text, 3), 3)
  const [node, offset] = pointAtVisibleOffset(math, 3)
  assert.equal(node, text)
  assert.equal(offset, 3)
})

test("trailing spaces map end-of-block carets to end-of-source", () => {
  // The renderer trims "See " to "See", so visible 3 is ambiguous: the map
  // gives end-of-block carets end-of-source affinity.
  assert.equal(sourceOffsetForVisibleOffset("See ", 3), 4)
  assert.equal(sourceOffsetForVisibleOffset("See ", 2), 2)
  assert.equal(visibleOffsetForSourceOffset("See ", 4), 3)
  assert.equal(visibleOffsetForSourceOffset("See ", 3), 3)
  assert.equal(sourceOffsetForVisibleOffset("See  \n", 3), 6)
})

test("all-whitespace slices keep identity mapping", () => {
  assert.equal(sourceOffsetForVisibleOffset("   ", 0), 0)
  assert.equal(visibleOffsetForSourceOffset("   ", 0), 0)
})

test("trimmed trailing space round-trips through the DOM", () => {
  const { document } = parseHTML(`<div data-editor-block-id="b1"><p>See</p></div>`)
  const block = document.querySelector("[data-editor-block-id]")
  const text = block.querySelector("p").firstChild

  assert.equal(visibleOffsetAtPoint(block, text, 3), 3)
  assert.equal(sourceOffsetForVisibleOffset("See ", visibleOffsetAtPoint(block, text, 3)), 4)
  const [node, offset] = pointAtVisibleOffset(block, visibleOffsetForSourceOffset("See ", 4))
  assert.equal(node, text)
  assert.equal(offset, 3)
})
