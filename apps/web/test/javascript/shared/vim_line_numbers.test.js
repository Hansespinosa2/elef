import assert from "node:assert/strict"
import test from "node:test"
import { formatLineNumber } from "@elef/editor-runtime/test-internals"

const state = {
  doc: {
    lineAt(position) { return { number: Math.floor(position / 10) + 1 } }
  },
  selection: { main: { head: 20 } }
}

test("relative line numbers use model positions and show zero at the cursor", () => {
  assert.deepEqual([1, 2, 3, 4, 5].map(number => formatLineNumber(number, state, "relative")), ["2", "1", "0", "1", "2"])
})

test("absolute and unknown line number modes preserve absolute labels", () => {
  assert.equal(formatLineNumber(4, state, "absolute"), "4")
  assert.equal(formatLineNumber(4, state, "unknown"), "4")
})
