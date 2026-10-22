import { test } from "node:test";
import assert from "node:assert/strict";
import { adjustTableColumnMove, skipTableDelimiterRow, tableCellAt, tableSourceOffset, tableVisibleOffset } from "../src/session/table_motion.js";

// Index map of RAGGED (row 1 starts at 9):
// row 0: 0='|' 1-4='aaaa' 5='|' 6='b' 7='|' 8='\n'
// row 1: 9='|' 10='c' 11='|' 12-13='dd' 14='|' 15='\n'
const RAGGED = "|aaaa|b|\n|c|dd|\n";

// SHORT row 1 (`|c|`, starts at 9): 9='|' 10='c' 11='|' 12='\n'
const SHORT = "|aaaa|b|\n|c|\n";

test("vertical motion into a narrower cell stays in the same column", () => {
  // offset 4: last 'a' of the wide cell; engine line motion lands on 12.
  // Same column is "c" at 10; the 1-char cell holds intra-cell 0.
  assert.equal(adjustTableColumnMove(RAGGED, 4, 12), 10);
});

test("vertical motion into a wider cell preserves the intra-cell offset", () => {
  // offset 10 is 'c' (column 0, intra-cell 0); upwards lands back at 1.
  assert.equal(adjustTableColumnMove(RAGGED, 10, 2), 1);
  // offset 11 is the pipe after 'c'; it belongs to the cell on the left,
  // and a 1-char cell clamps intra-cell to 0, so it lands at 1, not 2.
  assert.equal(adjustTableColumnMove(RAGGED, 11, 3), 1);
  // offset 14 is the second 'd' (column 1, intra-cell 1); moving up clamps
  // onto 1-char "b" at its last character.
  assert.equal(adjustTableColumnMove(RAGGED, 14, 6), 6);
});

test("motion clamps to the last column when the target row is shorter", () => {
  // offset 6: 'b' in column 1; the next row has a single column.
  assert.equal(adjustTableColumnMove(SHORT, 6, 11), 10);
});

test("non-table motion passes through untouched", () => {
  assert.equal(adjustTableColumnMove("hello\nworld\n", 1, 7), 7);
  assert.equal(adjustTableColumnMove(RAGGED, 4, 4), 4);
});

test("motion starting outside any table passes through untouched", () => {
  const mixed = "intro\n|a|b|\n|c|d|\n";
  assert.equal(adjustTableColumnMove(mixed, 1, 8), 8);
});

test("motion into a delimiter row steps through to the next real row", () => {
  // | a | b | (0-8) \n=9 |---|---| (10-18) \n=19 | c | d | (starts 20)
  const table = "| a | b |\n|---|---|\n| c | d |\n";
  // j from the header lands in the delimiter; the skip advances past it.
  assert.equal(skipTableDelimiterRow(table, 2, 12), 20);
  // k from the body steps back over the delimiter to the header.
  assert.equal(skipTableDelimiterRow(table, 21, 12), 0);
  // A motion that already avoids the delimiter passes through.
  assert.equal(skipTableDelimiterRow(table, 2, 21), 21);
  // Outside tables nothing changes.
  assert.equal(skipTableDelimiterRow("plain\ntext\n", 1, 7), 7);
});

test("tableCellAt reports grid position and flags delimiter rows", () => {
  const table = "| a | b |\n|---|---|\n| c | d |\n";
  assert.deepEqual(tableCellAt(table, 2), { lineIndex: 0, dataRowIndex: 0, cellIndex: 0, intra: 1, cellStart: 1, cellLength: 3 });
  assert.deepEqual(tableCellAt(table, 22), { lineIndex: 2, dataRowIndex: 1, cellIndex: 0, intra: 1, cellStart: 21, cellLength: 3 });
  assert.deepEqual(tableCellAt(table, 12)?.dataRowIndex, -1);
  assert.equal(tableCellAt("plain\n", 1), null);
});

test("tableVisibleOffset recomputes placement from the rendered grid", () => {
  const table = "| a | b |\n|---|---|\n| c | d |\n";
  const grid = [
    [{ text: "a", length: 1 }, { text: "b", length: 1 }],
    [{ text: "c", length: 1 }, { text: "d", length: 1 }],
  ];
  // 'a' is the first rendered character; 'c' follows "ab" despite the
  // delimiter row between them in source.
  assert.equal(tableVisibleOffset(table, 2, grid), 0);
  assert.equal(tableVisibleOffset(table, 22, grid), 2);
  // Second column counts the first column's rendered text.
  assert.equal(tableVisibleOffset(table, 6, grid), 1);
  // Delimiter rows and non-tables decline to the legacy linear map.
  assert.equal(tableVisibleOffset(table, 12, grid), null);
  assert.equal(tableVisibleOffset("plain\n", 1, grid), null);
  // Formatted cells (rendered text differs from trimmed source) decline.
  assert.equal(tableVisibleOffset(table, 2, [[{ text: "X", length: 1 }]]), null);
});

test("tableSourceOffset inverts the grid mapping for capture", () => {
  const table = "| a | b |\n|---|---|\n| c | d |\n";
  const grid = [
    [{ text: "a", length: 1 }, { text: "b", length: 1 }],
    [{ text: "c", length: 1 }, { text: "d", length: 1 }],
  ];
  // DOM-visible 0 (before 'a') reads the content start of cell ' a '.
  assert.equal(tableSourceOffset(table, grid, 0), 2);
  // DOM-visible 2 (the b|c edge) pins forward to the content of ' c '.
  assert.equal(tableSourceOffset(table, grid, 2), 22);
  // DOM-visible 3 (the c|d edge) pins forward to the content of ' d '.
  assert.equal(tableSourceOffset(table, grid, 3), 26);
  // Past the last cell declines to the legacy map.
  assert.equal(tableSourceOffset(table, grid, 99), null);
  // Formatted cells decline.
  assert.equal(tableSourceOffset(table, [[{ text: "X", length: 1 }]], 0), null);
});

test("table grid mappings round-trip through engine offsets", () => {
  const table = "| a | b |\n|---|---|\n| c | d |\n";
  const grid = [
    [{ text: "a", length: 1 }, { text: "b", length: 1 }],
    [{ text: "c", length: 1 }, { text: "d", length: 1 }],
  ];
  // Every content source offset survives source -> DOM -> source
  // (padding-only positions have no DOM-visible counterpart by design).
  for (const sourceOffset of [2, 6, 22, 26]) {
    const dom = tableVisibleOffset(table, sourceOffset, grid);
    assert.ok(dom !== null, `source ${sourceOffset} maps to the grid`);
    assert.equal(tableSourceOffset(table, grid, dom as number), sourceOffset);
  }
});
