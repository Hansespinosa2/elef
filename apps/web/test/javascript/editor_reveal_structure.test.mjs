import assert from "node:assert/strict"
import test from "node:test"

// Structural revelation helpers: markers derive from source order
// and verify against rendered text, so any mismatch hides the marker
// instead of showing a wrong one.
import { loadPackageSource } from "./shared/package_source.mjs"

// editor_reveal.ts is import-free, so the suite runs the real module from
// source through a data: URL instead of importing the dist file.
const reveal = await import(
  `data:text/javascript;base64,${Buffer.from(await loadPackageSource("packages/editor-runtime/src/controllers/editor_reveal.ts")).toString("base64")}`
)

test("heading markers include the exact hashes", () => {
  assert.equal(reveal.structuralMarkerForLine("heading", ["## Warm head"], 0, "Warm head"), "## ")
  assert.equal(reveal.structuralMarkerForLine("heading", ["# T"], 0, "T"), "# ")
})

test("setext headings show no inline marker", () => {
  assert.equal(reveal.structuralMarkerForLine("heading", ["Title", "====="], 0, "Title"), null)
})

test("list markers preserve nesting indent", () => {
  assert.equal(reveal.structuralMarkerForLine("list", ["- a", "  - b"], 1, "b"), "  - ")
  assert.equal(reveal.structuralMarkerForLine("list", ["1. a", "2. b"], 1, "b"), "2. ")
})

test("blank source lines do not shift line indexes", () => {
  assert.equal(reveal.structuralMarkerForLine("quote", ["> a", ">", "> b"], 1, "b"), "> ")
})

test("rendered-text mismatches hide the marker", () => {
  // Concealed inline markup: the stripped source cannot equal the
  // rendered text, so nothing shows (safe direction).
  assert.equal(reveal.structuralMarkerForLine("list", ["- a *b* c"], 0, "a b c"), null)
  assert.equal(reveal.structuralMarkerForLine("heading", ["## Warm"], 0, "Something else"), null)
})

test("fence delimiters carry the info string", () => {
  assert.deepEqual(reveal.fenceDelimiters(["```js", "code", "```"]), { open: "```js", close: "```" })
  assert.deepEqual(reveal.fenceDelimiters(["~~~", "code", "~~~"]), { open: "~~~", close: "~~~" })
})

test("unclosed fences still show the opener", () => {
  assert.deepEqual(reveal.fenceDelimiters(["```js", "code"]), { open: "```js", close: null })
})

test("mismatched fence characters drop the closer", () => {
  assert.deepEqual(reveal.fenceDelimiters(["```js", "code", "~~~"]), { open: "```js", close: null })
})
