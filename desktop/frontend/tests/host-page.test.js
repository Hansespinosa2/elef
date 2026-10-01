import assert from "node:assert/strict"
import { readFile } from "node:fs/promises"
import test from "node:test"
import { parseHTML } from "linkedom"

const page = await readFile(new URL("../index.html", import.meta.url), "utf8")
const main = await readFile(new URL("../src/main.js", import.meta.url), "utf8")
const { document } = parseHTML(page)

test("desktop host page provides every element referenced by the app shell", () => {
  const ids = new Set([...main.matchAll(/document\.querySelector\(["']#([\w-]+)/g)].map(match => match[1]))
  const missing = [...ids].filter(id => !document.getElementById(id))
  assert.deepEqual(missing, [])
})

test("the host starts in source mode and keeps the unfinished visual mode disabled", () => {
  const sourceForm = document.querySelector("#desktop-editor-form")
  const sourceMode = document.querySelector("#source-mode")
  const visualMode = document.querySelector("#visual-mode")
  assert.equal(sourceForm.dataset.editorMode, "source")
  assert.equal(sourceMode.getAttribute("aria-pressed"), "true")
  assert.equal(visualMode.disabled, true)
})

test("the host uses no inline event handlers under the strict script policy", () => {
  assert.equal(document.querySelector("[onclick], [onerror], [onload]"), null)
})
