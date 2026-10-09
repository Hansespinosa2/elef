import test from "node:test"
import assert from "node:assert/strict"
import { blockOperationRange, blockOperationStart } from "../../app/javascript/lib/editor_block_ranges.js"

test("ART-EDIT-001: block operations own the Art line and its target list", () => {
  const source = "Before\n\n:::art\n- Alpha\n- Beta\n\nAfter"
  const artStart = source.indexOf(":::art")
  const listStart = source.indexOf("- Alpha")
  const block = {
    range: { start: listStart, end: source.indexOf("\n\nAfter") },
    art: { source_range: { start: artStart, end: artStart + ":::art\n".length } }
  }

  assert.equal(blockOperationStart({ directives: [] }, block), artStart)
  assert.equal(source.slice(blockOperationStart({ directives: [] }, block), block.range.end), ":::art\n- Alpha\n- Beta")
  assert.equal(source.slice(0, artStart), "Before\n\n")
  assert.equal(source.slice(block.range.end), "\n\nAfter")
})

test("ART-EDIT-001: position directive ownership starts before Art", () => {
  const source = ":::position{middle}\n:::art\n- Alpha"
  const block = {
    range: { start: source.indexOf("- Alpha"), end: source.length },
    art: { source_range: { start: source.indexOf(":::art"), end: source.indexOf("- Alpha") } },
    position_directive_id: "position-1"
  }
  const slide = { directives: [{ id: "position-1", range: { start: 0 } }] }

  assert.equal(blockOperationStart(slide, block), 0)
})

test("ART-EDIT-001: deleting a block includes an Art directive and position directive preceding it", () => {
  const source = ":::art\n:::align{center}\n- Alpha\n\n- Later"
  const block = {
    range: { start: source.indexOf("- Alpha"), end: source.indexOf("\n\n- Later") },
    art: { source_range: { start: 0, end: ":::art\n".length } },
    position_directive_id: "align-1"
  }
  const slide = {
    blocks: [block],
    directives: [
      { id: "align-1", type: "position", range: { start: source.indexOf(":::align"), end: source.indexOf("\n", source.indexOf(":::align")) + 1 } }
    ]
  }

  const range = blockOperationRange(slide, block)
  assert.equal(range.start, source.indexOf(":::art"))
  assert.equal(source.slice(range.start, range.end), ":::art\n:::align{center}\n- Alpha")
  assert.equal(source.slice(0, range.start) + source.slice(range.end), "\n\n- Later")
})
