import assert from "node:assert/strict"
import test from "node:test"
import { readFile } from "node:fs/promises"
import { parseHTML } from "linkedom"

// Differ side of visual inline revelation: the projection holds the
// base source slice for revealed constructs so edits inside them map
// positionally, delimiter deletions commit, and pairing mismatches
// refuse (the batch stays in the DOM for the next flush). The host
// resolves the verified map and injects it; the differ stays
// dependency-free.
const dist = (path) =>
  new URL(`../../../../packages/editor-runtime/dist/${path}`, import.meta.url)
const reveal = await import(dist("controllers/editor_reveal.js"))
const moduleSource = await readFile(dist("controllers/editor_markdown.js"), "utf8")
const source = moduleSource
  .replace('import katex from "katex"', "const katex = { renderToString: () => '' }")
const editorMarkdown = await import(
  `data:text/javascript;base64,${Buffer.from(source).toString("base64")}`
)

// Host-style call: resolve the map and inject it through options.
function commit(base, text, element) {
  return editorMarkdown.markdownForVisibleText(base, text, "paragraph", element, {
    documentMode: true,
    revealActives: reveal.activeInlineMap(base, element)
  })
}

const ACTIVE = (kind, format, text) =>
  `<span data-editor-inline-active="true" data-editor-inline-kind="${kind}" data-editor-inline-format="${format}" data-editor-inline-source="${text}">${text}</span>`

function block(inner) {
  const { document } = parseHTML(`<div data-editor-block-id="b1">${inner}</div>`)
  const element = document.querySelector("[data-editor-block-id]")
  return { element, text: element.textContent ?? "" }
}

test("revealed emphasis round-trips with delimiters in the DOM", () => {
  const { element, text } = block(`<p>A ${ACTIVE("format", "emphasis", "*warm*")} word</p>`)
  assert.equal(text, "A *warm* word")
  assert.equal(commit("A *warm* word", text, element), "A *warm* word")
})

test("typing inside revealed emphasis commits positionally", () => {
  const { element } = block(`<p>A ${ACTIVE("format", "emphasis", "*warm*")} word</p>`)
  assert.equal(commit("A *warm* word", "A *warXm* word", element), "A *warXm* word")
})

test("deleting revealed delimiters un-formats in the source", () => {
  const { element } = block(`<p>A ${ACTIVE("format", "emphasis", "*warm*")} word</p>`)
  assert.equal(commit("A *warm* word", "A warm word", element), "A warm word")
})

test("revealed strong and code commit through the same path", () => {
  const strong = block(`<p>A ${ACTIVE("format", "strong", "**bold**")} word</p>`)
  assert.equal(commit("A **bold** word", "A **bolXd** word", strong.element), "A **bolXd** word")
  const code = block(`<p>A ${ACTIVE("code", "", "`cell`")} word</p>`)
  assert.equal(commit("A `cell` word", "A `ceXll` word", code.element), "A `ceXll` word")
})

test("concealed constructs ignore the reveal path entirely", () => {
  const { element, text } = block(`<p>A <em>warm</em> word</p>`)
  assert.equal(text, "A warm word")
  assert.equal(commit("A *warm* word", text, element), "A *warm* word")
  assert.equal(commit("A *warm* word", "A warXm word", element), "A *warXm* word")
})

test("a stray active span refuses instead of corrupting", () => {
  // No emphasis token in source but an active span in the DOM:
  // pairing fails, so the flush refuses and keeps the base.
  const { element } = block(`<p>A ${ACTIVE("format", "emphasis", "*warm*")} word</p>`)
  assert.equal(commit("A plain word", "A *warm* word", element), "A plain word")
})

test("tokenizer disagreement refuses instead of corrupting", () => {
  // Pathological nesting the tokenizers read differently: the strict
  // re-tokenize check fails, so the flush refuses and keeps the base.
  const { element } = block(`<p>${ACTIVE("format", "emphasis", "*x*")}</p>`)
  assert.equal(commit("***x*", "***x*?", element), "***x*")
})
