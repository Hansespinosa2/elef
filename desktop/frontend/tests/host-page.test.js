import assert from "node:assert/strict"
import { readFile } from "node:fs/promises"
import test from "node:test"
import { parseHTML } from "linkedom"

const page = await readFile(new URL("../index.html", import.meta.url), "utf8")
const main = await readFile(new URL("../src/main.js", import.meta.url), "utf8")
const viewportStyles = await readFile(new URL("../src/rendered-content.css", import.meta.url), "utf8")
const { document } = parseHTML(page)

test("rendered decks reuse Rails styles with only native viewport chrome", () => {
  assert.ok(main.includes('import "../../../app/assets/stylesheets/application.css"'))
  assert.doesNotMatch(viewportStyles, /^\.(?:slide|document|presentation|katex)[\w.-]*(?:\s|\{|:)/m)
})

test("desktop host page provides every element referenced by the app shell", () => {
  const ids = new Set([...main.matchAll(/document\.querySelector\(["']#([\w-]+)/g)].map(match => match[1]))
  const missing = [...ids].filter(id => !document.getElementById(id))
  assert.deepEqual(missing, [])
})

test("the shell presents itself as Elef Desktop rather than a preview build", () => {
  assert.match(document.querySelector(".app-version").textContent, /^Elef Desktop · v\d/)
})

test("the host starts in source mode and gates visual editing until the local preview renders", () => {
  const sourceForm = document.querySelector("#desktop-editor-form")
  const sourceMode = document.querySelector("#source-mode")
  const visualMode = document.querySelector("#visual-mode")
  assert.equal(sourceForm.dataset.editorMode, "source")
  assert.match(sourceForm.dataset.controller, /preview/)
  assert.equal(sourceMode.getAttribute("aria-pressed"), "true")
  assert.equal(visualMode.disabled, true)
  assert.equal(visualMode.getAttribute("data-action"), "click->editor#showVisual")
  assert.equal(visualMode.getAttribute("data-editor-target"), "visualButton")
  assert.ok(document.querySelector("#desktop-preview[data-preview-target='container']"))
  assert.ok(document.querySelector("[data-editor-map-json]"))
})

test("the host uses no inline event handlers under the strict script policy", () => {
  assert.equal(document.querySelector("[onclick], [onerror], [onload]"), null)
})

test("the editor reuses the web Appearance controller and front matter fields", () => {
  const appearance = document.querySelector(".appearance-settings[data-controller='appearance']")
  assert.ok(appearance)
  assert.equal(appearance.hidden, true)
  for (const key of ["theme", "typography"]) {
    const field = appearance.querySelector(`[data-appearance-target='${key}']`)
    assert.equal(field.getAttribute("name"), `work[${key}]`)
    assert.equal(field.querySelector("option").value, "")
  }
})

test("the source editor forwards input and keyboard events to authoring palettes", () => {
  const actions = document.querySelector("#deck-source").dataset.action.split(/\s+/)
  for (const action of [
    "input->snippet-palette#input",
    "keydown->snippet-palette#keydown",
    "keydown->math-shorthand#keydown",
    "input->math-shortcut-palette#input",
    "keydown->math-shortcut-palette#keydown",
    "input->mermaid-assist#input",
    "input->document-link-palette#input",
    "keydown->document-link-palette#keydown"
  ]) {
    assert.ok(actions.includes(action), `missing host action ${action}`)
  }
})

test("the library provides the local document graph view and deck navigation", () => {
  assert.ok(document.querySelector("#show-deck-list[data-library-tab='all']"))
  assert.ok(document.querySelector("#show-documents[data-library-tab='documents']"))
  assert.ok(document.querySelector("#show-presentations[data-library-tab='presentations']"))
  assert.ok(document.querySelector("#show-document-graph"))
  assert.ok(document.querySelector("#document-graph-view[hidden]"))
  assert.ok(document.querySelector("#document-graph-search[data-document-graph-target='search']"))
  assert.ok(document.querySelector("#document-graph-mount"))
})
