import assert from "node:assert/strict"
import test from "node:test"
import { readFile } from "node:fs/promises"

const source = (await readFile(new URL("../../app/javascript/controllers/math_shorthand_controller.js", import.meta.url), "utf8"))
  .replace('import { Controller } from "@hotwired/stimulus"', "class Controller {}")
  .replace('import { editorFor } from "controllers/editor_controller"', "const editorFor = () => null")
const math = await import(`data:text/javascript;base64,${Buffer.from(source).toString("base64")}`)

test("serializes only the supported v1 math transforms", () => {
  assert.equal(math.expandMathShorthand("x.b"), "\\mathbf{x}")
  assert.equal(math.expandMathShorthand("\\alpha.b"), "\\boldsymbol{\\alpha}")
  assert.equal(math.expandMathShorthand("@a.b"), "\\boldsymbol{\\alpha}")
  assert.equal(math.expandMathShorthand("R.bb"), "\\mathbb{R}")
  assert.equal(math.expandMathShorthand("x.vec"), "\\vec{x}")
  assert.equal(math.expandMathShorthand("A.t"), "A^{\\mathsf{T}}")
  assert.equal(math.expandMathShorthand("A.T"), "A^{\\mathsf{T}}")
  assert.equal(math.expandMathShorthand("A.inv"), "A^{-1}")
  assert.equal(math.expandMathShorthand("x.b.vec.t"), "\\vec{\\mathbf{x}}^{\\mathsf{T}}")
})

test("preserves mathematical postfix sequence and rejects deferred grammar", () => {
  assert.equal(math.expandMathShorthand("A.inv.t"), "\\left(A^{-1}\\right)^{\\mathsf{T}}")
  assert.equal(math.expandMathShorthand("A.t.inv"), "\\left(A^{\\mathsf{T}}\\right)^{-1}")
  assert.notEqual(math.expandMathShorthand("A.inv.t"), math.expandMathShorthand("A.t.inv"))
  for (const source of ["x.invalid", "x.hat", "x.abs", "x.sqrt", "x.b.bb", "x.vec.vec"]) {
    assert.equal(math.expandMathShorthand(source), null)
  }
})

test("finds a complete active chain at a cursor inside its source", () => {
  assert.deepEqual(
    (({ start, end, source, expansion }) => ({ start, end, source, expansion }))(math.mathShorthandAt("$x.b.vec.t$", 4)),
    { start: 1, end: 10, source: "x.b.vec.t", expansion: "\\vec{\\mathbf{x}}^{\\mathsf{T}}" }
  )
  assert.equal(math.mathShorthandAt("`$x.b$`", 4), null)
  assert.equal(math.mathShorthandAt("```\n$x.b$\n```", 7), null)
})

test("pairs, promotes, and skips math delimiters without touching code or escapes", () => {
  assert.equal(math.mathDollarAction("text", 4), "pair")
  assert.equal(math.mathDollarAction("$$", 1), "promote")
  assert.equal(math.mathDollarAction("$$$$", 2), "skip")
  assert.equal(math.mathDollarAction("`code`", 3), "literal")
  assert.equal(math.mathDollarAction("```\ncode\n```", 6), "literal")
  assert.equal(math.mathDollarAction("\\", 1), "literal")
  assert.equal(math.mathDollarAction("$x$", 2), "skip")
})

test("authoring assist stays under the synchronous latency gate", () => {
  const region = `$${"x+".repeat(2498)}x.b$`
  const start = performance.now()
  const timings = []
  for (let index = 0; index < 1000; index += 1) {
    const before = performance.now()
    math.mathShorthandAt(region, region.length - 2)
    timings.push(performance.now() - before)
  }
  const sorted = timings.toSorted((left, right) => left - right)
  const p95 = sorted[Math.floor(sorted.length * 0.95)]
  const p99 = sorted[Math.floor(sorted.length * 0.99)]
  const max = sorted.at(-1)
  assert.ok(p95 < 5, `p95 was ${p95.toFixed(3)} ms`)
  assert.ok(p99 < 10, `p99 was ${p99.toFixed(3)} ms`)
  assert.ok(max < 16, `maximum was ${max.toFixed(3)} ms`)
  assert.ok(performance.now() - start < 10000, "1,000 edit benchmark exceeded 10 seconds")
})
