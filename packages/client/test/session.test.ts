import { test } from "node:test";
import assert from "node:assert/strict";

import { ADAPTER_METHODS, assertEditorAdapter } from "../src/session/editor_adapter.js";

import {
  caretAfterInsert,
  clampSelection,
  detectLineSeparator,
  diffSource,
  frontmatterRangeFor,
  normalizeLineEndings,
  offsetSelection,
  toEditorLineEndings,
} from "../src/session/source_ops.js";

function apply(current: string, change: { from: number; to: number; insert: string }): string {
  return current.slice(0, change.from) + change.insert + current.slice(change.to);
}

test("line endings normalize and round-trip through the document separator", () => {
  assert.equal(normalizeLineEndings("a\r\nb\rc\nd"), "a\nb\nc\nd");
  assert.equal(detectLineSeparator("a\r\nb"), "\r\n");
  assert.equal(detectLineSeparator("a\rb"), "\r");
  assert.equal(detectLineSeparator("a\nb"), "\n");
  assert.equal(detectLineSeparator("plain"), "\n");
  assert.equal(toEditorLineEndings("a\r\nb", "\n"), "a\nb");
  assert.equal(toEditorLineEndings("a\rb\nc", "\r\n"), "a\r\nb\r\nc");
});

test("selection clamps to the document bounds", () => {
  assert.deepEqual(clampSelection(2, 5, 10), { anchor: 2, head: 5 });
  assert.deepEqual(clampSelection(-3, 99, 10), { anchor: 0, head: 10 });
  assert.deepEqual(clampSelection(7, 7, 0), { anchor: 0, head: 0 });
});

test("identical sources produce no diff", () => {
  assert.equal(diffSource("same", "same", "\n"), null);
  assert.equal(diffSource("a\nb", "a\r\nb", "\n"), null);
  // Separator mismatch against the document still dispatches (matches the
  // controller shell): the lone \r is deleted to converge on the source.
  assert.deepEqual(diffSource("a\r\nb", "a\nb", "\r\n"), { from: 1, to: 2, insert: "" });
});

test("diff covers insertions, deletions, and replacements", () => {
  const cases: Array<[string, string]> = [
    ["hello", "hello world"],
    ["hello world", "hello"],
    ["one two three", "one TWO three"],
    ["", "fresh document"],
    ["stale document", ""],
    ["aaa\nbbb\nccc", "aaa\nBBB\nccc"],
  ];
  for (const [current, source] of cases) {
    const change = diffSource(current, source, "\n");
    assert.ok(change, `expected a change for ${JSON.stringify(source)}`);
    assert.equal(apply(current, change!), normalizeLineEndings(source));
  }
});

test("diff converts the insert to the document separator", () => {
  const change = diffSource("a\r\nb", "a\r\nB\r\nc", "\r\n");
  assert.ok(change);
  assert.equal(apply("a\r\nb", change!), "a\r\nB\r\nc");
  assert.ok(!/(?<!\r)\n/.test(change!.insert));
});

test("diff touches only the changed span", () => {
  const change = diffSource("prefix-body-suffix", "prefix-XY-suffix", "\n");
  assert.deepEqual({ from: change!.from, to: change!.to }, { from: 7, to: 11 });
});

test("caret and selection arithmetic match the controller shells", () => {
  assert.equal(caretAfterInsert(4, "ab\r\ncd"), 4 + 5);
  assert.deepEqual(offsetSelection(10, { from: 1, to: 3 }), { anchor: 11, head: 13 });
});

test("adapter validation pins the narrow binding surface", () => {
  assert.deepEqual(ADAPTER_METHODS, ["getText", "setText", "materializeEdits"]);
  const valid = { getText: () => "", setText: () => true, materializeEdits: () => {} };
  assert.equal(assertEditorAdapter(valid), valid);
  assert.throws(() => assertEditorAdapter(null), /adapter object/);
  assert.throws(() => assertEditorAdapter({}), /getText/);
  assert.throws(
    () => assertEditorAdapter({ getText: () => "", setText: () => true }),
    /materializeEdits/
  );
  assert.throws(
    () => assertEditorAdapter({ getText: () => "", setText: "yes", materializeEdits: () => {} }),
    /setText/
  );
});

test("frontmatter range matches the controller regex", () => {
  assert.deepEqual(frontmatterRangeFor("---\ntitle: x\n---\nbody"), { from: 0, to: 16 });
  assert.deepEqual(frontmatterRangeFor("---\r\ntitle: x\r\n---\r\nbody")?.from, 0);
  assert.equal(frontmatterRangeFor("no frontmatter here"), null);
  assert.equal(frontmatterRangeFor("body\n---\nnot first\n---"), null);
  assert.equal(frontmatterRangeFor("---\n"), null);
});
