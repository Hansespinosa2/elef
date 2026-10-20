import { test } from "node:test";
import assert from "node:assert/strict";
import { mathSourceAt, scanMathSource, sourceIsEscaped } from "../src/math_source.js";

test("math delimiters preserve reader offsets, raw content, and display mode", () => {
  for (const [open, close, display] of [["$", "$", false], ["$$", "$$", true], ["\\(", "\\)", false], ["\\[", "\\]", true]] as const) {
    const source = `a ${open}x${close} z`;
    assert.deepEqual(mathSourceAt(source, 2), { start: 2, end: 3 + open.length + close.length, interior: "x", open, close, display });
    assert.deepEqual(scanMathSource(source), [mathSourceAt(source, 2)]);
  }
  assert.equal(mathSourceAt("$$\nx\n$$")?.interior, "\nx\n");
  assert.equal(mathSourceAt("\\[\nx\n\\]")?.interior, "\nx\n");
});

test("escaped math delimiters use backslash parity on both sides", () => {
  assert.equal(sourceIsEscaped("\\$", 1), true);
  assert.equal(sourceIsEscaped("\\\\$", 2), false);
  assert.equal(mathSourceAt("\\$x$", 1), null);
  assert.equal(mathSourceAt("\\\\$x$", 2)?.interior, "x");
  assert.equal(mathSourceAt("$\\$"), null);
  assert.equal(mathSourceAt("$a\\\\$")?.interior, "a\\\\");
  assert.equal(mathSourceAt("$a\\$b$")?.interior, "a\\$b");
  assert.equal(mathSourceAt("\\(a\\\\)b\\)")?.interior, "a\\\\)b");
  assert.deepEqual(scanMathSource("\\$x$ and \\(y\\)").map((math) => math.interior), ["y"]);
});

test("reader single-dollar whitespace and closing-run behavior stays unchanged", () => {
  for (const source of ["$ x$", "$x $", "$x", "$x$$"]) assert.equal(mathSourceAt(source), null);
  assert.equal(mathSourceAt("$x\ny$")?.interior, "x\ny");
  // Reader accepts empty display/bracket forms. Editor placeholder policy
  // stays with its callers, rather than changing reader recognition.
  assert.equal(mathSourceAt("$$$$")?.interior, "");
  assert.equal(mathSourceAt("\\(\\)")?.interior, "");
});

test("math scanner excludes code, images and link destinations", () => {
  const source = [
    "`$code$` and ``\\(code\\)`` then $x$",
    "```tex", "$fenced$", "```",
    "~~~", "\\[fenced\\]", "~~~",
    "    $indented$",
    "![\\(alt\\)](image-$url$) [\\(label\\)](https://x/$url$)",
    "\\[y\\]",
  ].join("\n");
  assert.deepEqual(scanMathSource(source).map((math) => math.interior), ["x", "label", "y"]);
});

test("unclosed code fences consume the remaining source, unmatched inline backticks do not", () => {
  assert.deepEqual(scanMathSource("```\n$x$"), []);
  assert.deepEqual(scanMathSource("`plain $x$").map((math) => math.interior), ["x"]);
});
