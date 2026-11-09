import { test } from "node:test"
import assert from "node:assert/strict"
import { tableSourceProjection } from "../src/table_source.js"

test("table annotations preserve original offsets, escaped pipes, and column alignment", () => {
  const source = "# Notes\r\n\r\n| Name | Value |\r\n| :--- | ---: |\r\n| a\\|b | $x$ |\r\n"
  const table = tableSourceProjection(source)[0]
  assert.ok(table)
  assert.deepEqual(table.rows.map(row => row.cells.map(cell => source.slice(cell.from, cell.to))),
    [["Name", "Value"], ["a\\|b", "$x$"]])
  assert.deepEqual(table.rows[0]?.cells.map(cell => cell.alignment), ["left", "right"])
  assert.equal(source.slice(table.delimiter.from, table.delimiter.to), "| :--- | ---: |")
})

test("code fences and malformed tables are never projected as grids", () => {
  assert.deepEqual(tableSourceProjection("```\n| A | B |\n| - | - |\n```"), [])
  assert.deepEqual(tableSourceProjection("| A | B |\n| --- |\n"), [])
  assert.deepEqual(tableSourceProjection("$$\n| A | B |\n| - | - |\n$$"), [])
  assert.deepEqual(tableSourceProjection("> | A | B |\n> | - | - |\n> | x | y |"), [])
})

test("tables without outer pipes and rows with missing cells keep insertion points", () => {
  const source = "A | B\n--- | ---\nx |\n"
  const table = tableSourceProjection(source)[0]
  assert.ok(table)
  assert.deepEqual(table.rows.map(row => row.cells.map(cell => source.slice(cell.from, cell.to))), [["A", "B"], ["x", ""]])
  assert.deepEqual(table.rows[0]?.cells.map(cell => cell.alignment), ["default", "default"])
})
