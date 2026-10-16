import assert from "node:assert/strict"
import test from "node:test"
import { readFile } from "node:fs/promises"

const moduleSource = await readFile(new URL("../../../../packages/editor-runtime/dist/controllers/editor_markdown.js", import.meta.url), "utf8")
const source = moduleSource.replace('import katex from "katex"', "const katex = { renderToString: () => '' }")
const editorMarkdown = await import(`data:text/javascript;base64,${Buffer.from(source).toString("base64")}`)

test("end-insertions land past invisible trailing whitespace", () => {
  assert.equal(editorMarkdown.markdownForVisibleText("See ", "Seex", "paragraph", null), "See x")
  assert.equal(
    editorMarkdown.markdownForVisibleText("See ", "Seex", "paragraph", null, { documentMode: true }),
    "See x"
  )
})

test("range operations never swallow unselected trailing whitespace", () => {
  assert.equal(editorMarkdown.markdownForVisibleText("aXb ", "ab", "paragraph", null), "ab ")
})

test("trimmed trailing whitespace round-trips byte-identical when nothing changed", () => {
  assert.equal(editorMarkdown.markdownForVisibleText("See ", "See", "paragraph", null), "See ")
})

test("whitespace the DOM never rendered survives lagging flushes once internal", () => {
  // The projection strips the trailing space ("See " renders "<p>See</p>"),
  // so after precise commits the DOM lags the engine by that space; a later
  // legacy batch (the space in "Research ta" declines to legacy) must not
  // read the inherited gap as a user deletion.
  assert.equal(
    editorMarkdown.markdownForVisibleText("See [[Research", "See[[Research ta", "paragraph", null, { documentMode: true }),
    "See [[Research ta"
  )
  assert.equal(
    editorMarkdown.markdownForVisibleText("See ", "See[[Research ta", "paragraph", null, { documentMode: true }),
    "See [[Research ta"
  )
})

test("lagging whitespace survives mid-block insertions and adjacent deletions", () => {
  assert.equal(
    editorMarkdown.markdownForVisibleText("See [[Research", "See[[ResXearch", "paragraph", null, { documentMode: true }),
    "See [[ResXearch"
  )
  assert.equal(
    editorMarkdown.markdownForVisibleText("See [[R", "See[[", "paragraph", null, { documentMode: true }),
    "See [["
  )
})

test("genuine whitespace deletions still fall back to the unaligned diff", () => {
  assert.equal(editorMarkdown.markdownForVisibleText("a b", "ab", "paragraph", null), "ab")
})

test("just-typed trailing whitespace is evidence, not round-trip noise", () => {
  // Flush #2 of the link-palette batch: the DOM still shows the just-typed
  // trailing space, which the trim hides; the trimmed diff looks like an
  // empty diff with lag skips, but the run proves a real insertion.
  assert.equal(
    editorMarkdown.markdownForVisibleText("See [[Research", "See[[Research ", "paragraph", null, { documentMode: true }),
    "See [[Research "
  )
  assert.equal(editorMarkdown.markdownForVisibleText("ab", "aXb ", "paragraph", null), "aXb ")
  assert.equal(editorMarkdown.markdownForVisibleText("ab", "abX ", "paragraph", null), "abX ")
})

test("trailing whitespace round-trips when nothing was typed", () => {
  assert.equal(editorMarkdown.markdownForVisibleText("See ", "See ", "paragraph", null), "See ")
})
