import assert from "node:assert/strict"
import test from "node:test"
import { readFile } from "node:fs/promises"
import vm from "node:vm"
import { parseHTML } from "linkedom"
import { renderLibraryCard } from "../../../app/javascript/lib/library_card.js"

const sandbox = vm.createContext({})
vm.runInContext(await readFile(new URL("../../../vendor/javascript/elef-renderer.bundle.js", import.meta.url), "utf8"), sandbox)

test("the library card uses the same HTML producer in the Rails bundle and desktop", () => {
  const properties = { id: "document-42", title: "Notes & diagrams", kind: "document", metadata: "Continuous Markdown", editUrl: "/documents/42/edit", previewHtml: "<p>Safe preview</p>", controlsHtml: "<button>Action</button>" }
  assert.equal(sandbox.ElefRenderer.renderLibraryCard(properties), renderLibraryCard(properties))
  const { document } = parseHTML(renderLibraryCard(properties))
  assert.equal(document.querySelector(".library-card-title a").textContent, properties.title)
  assert.equal(document.querySelector(".library-card-preview p").textContent, "Safe preview")
  assert.equal(document.querySelector(".library-card-controls button").textContent, "Action")
})

test("library metadata remains inert and navigation stays local", () => {
  const title = '<img src=x onerror="alert(1)">'
  const properties = { id: 'id" onclick="run()', title, kind: "presentation", metadata: "<script>run()</script>", note: title, editUrl: "#local" }
  const { document } = parseHTML(renderLibraryCard(properties))
  assert.equal(document.querySelector("img, script, [onclick]"), null)
  assert.equal(document.querySelector(".library-card-title").textContent, title)
  assert.equal(document.querySelector(".library-card-note").textContent, title)
  for (const editUrl of ["javascript:run()", "https://example.com", "//example.com"]) {
    assert.throws(() => renderLibraryCard({ ...properties, editUrl }), TypeError)
  }
})
