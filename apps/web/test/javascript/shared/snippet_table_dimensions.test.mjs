import assert from "node:assert/strict"
import test from "node:test"
import { loadPackageSource } from "./package_source.mjs"

const source = await loadPackageSource("packages/editor-runtime/src/controllers/snippet_table_dimensions.ts")
const tables = await import(`data:text/javascript;base64,${Buffer.from(source).toString("base64")}`)

test("table dimensions parse WxH with a columns-first reading", () => {
  assert.deepEqual(tables.parseTableDimensions("5x2"), { cols: 5, rows: 2 })
  assert.deepEqual(tables.parseTableDimensions(" 3X4 "), { cols: 3, rows: 4 })
  assert.deepEqual(tables.parseTableDimensions("5 x 2"), { cols: 5, rows: 2 })
  assert.deepEqual(tables.parseTableDimensions("1x1"), { cols: 1, rows: 1 })
  assert.deepEqual(tables.parseTableDimensions("12x12"), { cols: 12, rows: 12 })
})

test("table dimensions reject blanks, garbage, zeroes, and oversize grids", () => {
  for (const text of [null, undefined, "", "   ", "abc", "5x", "x2", "5", "0x5", "5x0", "-1x2", "13x2", "2x13", "5x2x3", "5.5x2"]) {
    assert.equal(tables.parseTableDimensions(text), null, JSON.stringify(text))
  }
})

test("table grid body draws header plus the requested body rows", () => {
  assert.equal(
    tables.tableGridBody(2, 2),
    "| ${1:Column 1} | ${2:Column 2} |\n| --- | --- |\n| ${3:Value 1} | ${4:Value 2} |\n| ${5:Value 3} | ${6:Value 4} |"
  )
  assert.equal(
    tables.tableGridBody(2, 1),
    "| ${1:Column 1} | ${2:Column 2} |\n| --- | --- |\n| ${3:Value 1} | ${4:Value 2} |"
  )
})

test("table grid body numbers stops across header and rows", () => {
  assert.equal(
    tables.tableGridBody(3, 1),
    "| ${1:Column 1} | ${2:Column 2} | ${3:Column 3} |\n| --- | --- | --- |\n| ${4:Value 1} | ${5:Value 2} | ${6:Value 3} |"
  )
})

test("table grid body clamps out-of-range dimensions instead of failing", () => {
  const body = tables.tableGridBody(0, 99)
  assert.match(body, /^\| \$\{1:Column 1\} \|$/m)
  assert.equal(body.split("\n").length, 1 + 1 + 12)
})

test("assist query keeps the old trigger semantics without trailing text", () => {
  assert.deepEqual(tables.parseAssistQuery("/table"), { prefix: "/", text: "table", start: 0, rest: "" })
  assert.deepEqual(tables.parseAssistQuery("/TABLE"), { prefix: "/", text: "table", start: 0, rest: "" })
  assert.deepEqual(tables.parseAssistQuery("  /image"), { prefix: "/", text: "image", start: 2, rest: "" })
  assert.equal(tables.parseAssistQuery("no trigger here"), null)
  assert.equal(tables.parseAssistQuery("//table"), null)
})

test("assist query captures trailing dimensions after a slash trigger", () => {
  assert.deepEqual(tables.parseAssistQuery("/table 5x2"), { prefix: "/", text: "table", start: 0, rest: " 5x2" })
  assert.deepEqual(tables.parseAssistQuery("  /table  3X4 "), { prefix: "/", text: "table", start: 2, rest: "  3X4 " })
})

test("assist query never captures trailing text after a colon directive", () => {
  assert.equal(tables.parseAssistQuery(":align center"), null)
  assert.deepEqual(tables.parseAssistQuery(":align"), { prefix: ":", text: "align", start: 0, rest: "" })
})
