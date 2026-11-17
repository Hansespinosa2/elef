import { test } from "node:test";
import assert from "node:assert/strict";
import { parseHTML } from "linkedom";
import { adjustTableColumnMove, fragmentedTableSourceOffset, skipTableDelimiterRow, tableCellAt, tableSourceOffset, tableVisibleOffset } from "../src/session/table_motion.js";

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

const FRAGMENTED_SOURCE = "| Header | Other |\n| --- | --- |\n| same | first |\n| same | second |\n| last |  |";

function fragmentedTable() {
  const { document } = parseHTML(`<main>
    <div data-editor-block-id="one"><table><thead><tr><th>Header</th><th>Other</th></tr></thead><tbody><tr><td>same</td><td>first</td></tr></tbody></table></div>
    <div data-editor-block-id="one"><table><thead><tr><th>Header</th><th>Other</th></tr></thead><tbody><tr><td>same</td><td>second</td></tr></tbody></table></div>
    <div data-editor-block-id="one"><table><thead><tr><th>Header</th><th>Other</th></tr></thead><tbody><tr><td>last</td><td></td></tr></tbody></table></div>
  </main>`);
  return { document, fragments: [...document.querySelectorAll("[data-editor-block-id]")] };
}

test("fragmented tables map actual cells, repeated values and cell edges to source", () => {
  const { fragments } = fragmentedTable();
  const first = fragments[0]!.querySelector("tbody td")!;
  const second = fragments[1]!.querySelector("tbody td")!;
  const last = fragments[2]!.querySelector("tbody td")!;
  const empty = fragments[2]!.querySelector("tbody td:last-child")!;
  const map = (node: Node, offset: number) => fragmentedTableSourceOffset(FRAGMENTED_SOURCE, fragments, node, offset);
  assert.deepEqual(map(first.firstChild!, 2), { kind: "mapped", offset: FRAGMENTED_SOURCE.indexOf("same") + 2 });
  assert.deepEqual(map(second.firstChild!, 2), { kind: "mapped", offset: FRAGMENTED_SOURCE.lastIndexOf("same") + 2 });
  assert.deepEqual(map(last.firstChild!, 4), { kind: "mapped", offset: FRAGMENTED_SOURCE.indexOf("last") + 4 });
  assert.deepEqual(map(empty, 0), { kind: "mapped", offset: FRAGMENTED_SOURCE.lastIndexOf("|") });
  assert.deepEqual(map(second, 0), { kind: "mapped", offset: FRAGMENTED_SOURCE.lastIndexOf("same") });
  assert.deepEqual(map(second, 1), { kind: "mapped", offset: FRAGMENTED_SOURCE.lastIndexOf("same") + 4 });
  assert.deepEqual(map(second.firstChild!, 5), { kind: "unmappable" });
  assert.deepEqual(map(second.firstChild!, -1), { kind: "unmappable" });
});

test("fragmented tables map repeated header points and distinguish non-tables", () => {
  const { document, fragments } = fragmentedTable();
  const firstHeader = fragments[0]!.querySelector("th")!.firstChild!;
  const repeatedHeader = fragments[1]!.querySelector("th")!.firstChild!;
  assert.deepEqual(fragmentedTableSourceOffset(FRAGMENTED_SOURCE, fragments, firstHeader, 2), { kind: "mapped", offset: FRAGMENTED_SOURCE.indexOf("Header") + 2 });
  assert.deepEqual(fragmentedTableSourceOffset(FRAGMENTED_SOURCE, fragments, repeatedHeader, 2), { kind: "mapped", offset: FRAGMENTED_SOURCE.indexOf("Header") + 2 });
  assert.deepEqual(fragmentedTableSourceOffset(FRAGMENTED_SOURCE, fragments, fragments[1]!, 0), { kind: "unmappable" });
  assert.deepEqual(fragmentedTableSourceOffset("plain", [document.createElement("p")], firstHeader, 0), { kind: "not-table" });
});

test("fragmented mapping accepts live cell edge spaces and simple formatting in other cells", () => {
  const { fragments } = fragmentedTable();
  const cell = fragments[1]!.querySelector("tbody td")!;
  cell.textContent = "same ";
  const source = FRAGMENTED_SOURCE.replace("| same | second |", "| same  | second |").replace("| last |", "| **last** |");
  fragments[2]!.querySelector("tbody td")!.innerHTML = "<strong>last</strong>";
  assert.deepEqual(fragmentedTableSourceOffset(source, fragments, cell.firstChild!, 5),
    { kind: "mapped", offset: source.lastIndexOf("same") + 5 });
});

test("fragmented formatted cell points map inside verified Markdown delimiters", () => {
  const { fragments } = fragmentedTable();
  const cell = fragments[1]!.querySelector("tbody td")!;
  cell.innerHTML = "<strong>same</strong>";
  const source = FRAGMENTED_SOURCE.replace("| same | second |", "| **same** | second |");
  const strong = cell.firstElementChild!;
  const start = source.indexOf("**same**") + 2;
  assert.deepEqual(fragmentedTableSourceOffset(source, fragments, strong.firstChild!, 2), { kind: "mapped", offset: start + 2 });
  assert.deepEqual(fragmentedTableSourceOffset(source, fragments, cell, 0), { kind: "mapped", offset: start });
  assert.deepEqual(fragmentedTableSourceOffset(source, fragments, strong, 1), { kind: "mapped", offset: start + 4 });
  assert.deepEqual(fragmentedTableSourceOffset(source, fragments, strong.firstChild!, 5), { kind: "unmappable" });
});

test("a simple linked cell does not block edits elsewhere in a continued table", () => {
  const { fragments } = fragmentedTable();
  const source = FRAGMENTED_SOURCE.replace("| same | first |", "| [same](https://example.com) | first |");
  const linkedCell = fragments[0]!.querySelector("tbody td")!;
  linkedCell.innerHTML = '<a href="https://example.com">same</a>';
  const linkedText = linkedCell.querySelector("a")!.firstChild!;
  const otherCell = fragments[1]!.querySelector("tbody td:last-child")!.firstChild!;
  assert.deepEqual(fragmentedTableSourceOffset(source, fragments, linkedText, 2),
    { kind: "mapped", offset: source.indexOf("[same]") + 1 + 2 });
  assert.deepEqual(fragmentedTableSourceOffset(source, fragments, otherCell, 3),
    { kind: "mapped", offset: source.indexOf("second") + 3 });
});

test("fragmented tables map links whose destinations contain balanced parentheses", () => {
  const { fragments } = fragmentedTable();
  const destination = "https://example.com/path_(detail)";
  const source = FRAGMENTED_SOURCE.replace("| same | first |", `| [same](${destination}) | first |`);
  const linkedCell = fragments[0]!.querySelector("tbody td")!;
  linkedCell.innerHTML = `<a href="${destination}">same</a>`;
  const linkedText = linkedCell.querySelector("a")!.firstChild!;
  const otherCell = fragments[1]!.querySelector("tbody td:last-child")!.firstChild!;
  assert.deepEqual(fragmentedTableSourceOffset(source, fragments, linkedText, 2),
    { kind: "mapped", offset: source.indexOf("[same]") + 1 + 2 });
  assert.deepEqual(fragmentedTableSourceOffset(source, fragments, otherCell, 3),
    { kind: "mapped", offset: source.indexOf("second") + 3 });
});

test("fragmented table endpoints produce the exact cross-page source range", () => {
  const { fragments } = fragmentedTable();
  const first = fragments[0]!.querySelector("tbody td:last-child")!.firstChild!;
  const last = fragments[2]!.querySelector("tbody td")!.firstChild!;
  const from = fragmentedTableSourceOffset(FRAGMENTED_SOURCE, fragments, first, 2);
  const to = fragmentedTableSourceOffset(FRAGMENTED_SOURCE, fragments, last, 2);
  assert.equal(from.kind, "mapped");
  assert.equal(to.kind, "mapped");
  if (from.kind !== "mapped" || to.kind !== "mapped") throw new Error("unmapped endpoints");
  assert.equal(FRAGMENTED_SOURCE.slice(from.offset, to.offset), "rst |\n| same | second |\n| la");
  assert.equal(FRAGMENTED_SOURCE.slice(0, from.offset) + "X" + FRAGMENTED_SOURCE.slice(to.offset),
    "| Header | Other |\n| --- | --- |\n| same | fiXst |  |");
});

test("fragmented table offsets count split text nodes within a cell", () => {
  const { document, fragments } = fragmentedTable();
  const cell = fragments[1]!.querySelector("tbody td:last-child")!;
  cell.replaceChildren(document.createTextNode("sec"), document.createTextNode("ond"));
  assert.deepEqual(fragmentedTableSourceOffset(FRAGMENTED_SOURCE, fragments, cell.childNodes[1]!, 2),
    { kind: "mapped", offset: FRAGMENTED_SOURCE.indexOf("second") + 5 });
  assert.deepEqual(fragmentedTableSourceOffset(FRAGMENTED_SOURCE, fragments, cell, 1),
    { kind: "mapped", offset: FRAGMENTED_SOURCE.indexOf("second") + 3 });
});

test("fragmented tables validate all fragments before mapping", () => {
  const { document, fragments } = fragmentedTable();
  const point = fragments[0]!.querySelector("td")!.firstChild!;
  const map = (parts: Element[] = fragments, source = FRAGMENTED_SOURCE) => fragmentedTableSourceOffset(source, parts, point, 1);
  assert.deepEqual(map(), { kind: "mapped", offset: FRAGMENTED_SOURCE.indexOf("same") + 1 });
  assert.deepEqual(map(fragments.slice(0, 2)), { kind: "unmappable" });
  assert.deepEqual(map([fragments[1]!, fragments[0]!, fragments[2]!]), { kind: "unmappable" });
  assert.deepEqual(map([fragments[0]!, fragments[0]!, fragments[2]!]), { kind: "unmappable" });
  assert.deepEqual(map(fragments, FRAGMENTED_SOURCE.replace("last", "stale")), { kind: "unmappable" });
  fragments[2]!.querySelector("td")!.innerHTML = "<strong>last</strong>";
  assert.deepEqual(map(), { kind: "unmappable" });
  fragments[2]!.querySelector("td")!.textContent = "last";
  fragments[2]!.querySelector("th")!.textContent = "changed";
  assert.deepEqual(map(), { kind: "unmappable" });
  fragments[2]!.querySelector("th")!.textContent = "Header";
  fragments[2]!.querySelector("td")!.setAttribute("colspan", "2");
  assert.deepEqual(map(), { kind: "unmappable" });
  assert.deepEqual(map([...fragments, document.createElement("div")]), { kind: "unmappable" });
});

test("fragmented tables reject unsupported source syntax rather than guessing", () => {
  const { fragments } = fragmentedTable();
  const point = fragments[0]!.querySelector("td")!.firstChild!;
  const map = (source: string) => fragmentedTableSourceOffset(source, fragments, point, 1);
  assert.deepEqual(map(`prefix\n${FRAGMENTED_SOURCE}`), { kind: "unmappable" });
  assert.deepEqual(map(FRAGMENTED_SOURCE.replace("same", "**same**")), { kind: "unmappable" });
  assert.deepEqual(map(FRAGMENTED_SOURCE.replace("same", "sa\\me")), { kind: "unmappable" });
  assert.deepEqual(map(FRAGMENTED_SOURCE.replace("| --- | --- |", "| --- | --- |\n| --- | --- |")), { kind: "unmappable" });
});
