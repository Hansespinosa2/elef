import assert from "node:assert/strict"
import test from "node:test"
import { NON_TRAILING_BOTTOM_WARNING, slidePositionClasses, slidePositionLayout } from "../src/index.js"

test("placement computation demotes non-trailing bottoms and docks a preceding stack", () => {
  const layout = slidePositionLayout([
    { position: { horizontal: "center", vertical: "middle" } },
    { position: { horizontal: "right", vertical: "bottom" } }
  ])

  assert.deepEqual(layout.entries, [
    { type: "middle", start: 0, end: 1, flushBottom: true },
    { type: "bottom", start: 1, end: 2 }
  ])
})

test("non-trailing bottom blocks demote to top with a warning", () => {
  const layout = slidePositionLayout([
    { position: { horizontal: "left", vertical: "bottom" } },
    { position: { horizontal: "left", vertical: "top" } }
  ])

  assert.deepEqual(layout.verticals, ["top", "top"])
  assert.deepEqual(layout.warnings, [NON_TRAILING_BOTTOM_WARNING])
})

test("slide position classes fall back to left/top", () => {
  assert.equal(slidePositionClasses({ horizontal: "center", vertical: "middle" }), "position-center position-middle")
  assert.equal(slidePositionClasses(null), "position-left position-top")
  assert.equal(slidePositionClasses({ horizontal: "right", vertical: "bottom" }, "top"), "position-right position-top")
})
