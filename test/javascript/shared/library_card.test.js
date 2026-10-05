import assert from "node:assert/strict"
import test from "node:test"
import { readFile } from "node:fs/promises"
import vm from "node:vm"
import { parseHTML } from "linkedom"
import { createLibraryCard, renderLibraryCard } from "../../../app/javascript/lib/library_card.js"

const sandbox = vm.createContext({})
vm.runInContext(await readFile(new URL("../../../vendor/javascript/elef-renderer.bundle.js", import.meta.url), "utf8"), sandbox)

test("the library card uses the same HTML producer in the Rails bundle and desktop", () => {
  const properties = { id: "document-42", title: "Notes & diagrams", kind: "document", updatedAt: "2026-10-04T00:00:00.000Z", editUrl: "/documents/42/edit", previewHtml: "<p>Safe preview</p>", controlsHtml: "<button>Action</button>" }
  assert.equal(sandbox.ElefRenderer.renderLibraryCard(properties), renderLibraryCard(properties))
  const { document } = parseHTML(renderLibraryCard(properties))
  assert.equal(document.querySelector(".library-card-title a").textContent, properties.title)
  assert.equal(document.querySelector(".library-card-open").getAttribute("aria-label"), `Edit ${properties.title}`)
  assert.equal(document.querySelector(".library-card-preview p").textContent, "Safe preview")
  assert.equal(document.querySelector(".library-card-controls button").textContent, "Action")
  assert.equal(document.querySelector(".library-card-meta").textContent, "Continuous Markdown · Updated Oct 4, 2026")
  assert.equal(document.querySelector(".deck-card, .deck-card-preview, .deck-open, .deck-name, .deck-meta"), null)
})

test("library metadata remains inert and navigation stays local", () => {
  const title = '<img src=x onerror="alert(1)">'
  const properties = { id: 'id" onclick="run()', title, kind: "presentation", updatedAt: "<script>run()</script>", note: title, editUrl: "#local" }
  const { document } = parseHTML(renderLibraryCard(properties))
  assert.equal(document.querySelector("img, script, [onclick]"), null)
  assert.equal(document.querySelector(".library-card-title").textContent, title)
  assert.equal(document.querySelector(".library-card-note").textContent, title)
  assert.equal(document.querySelector(".library-card-meta").textContent, "Markdown slides · Updated date unavailable")
  for (const editUrl of ["javascript:run()", "https://example.com", "//example.com"]) {
    assert.throws(() => renderLibraryCard({ ...properties, editUrl }), TypeError)
  }
})

test("desktop card actions match web preview and presentation entry points", () => {
  const { document } = parseHTML("<main></main>")
  const calls = []
  const deck = { id: "pres-1", name: "A presentation", kind: "presentation", modified_ms: 0, warnings: [] }
  const card = createLibraryCard(document, deck, {
    open: id => calls.push(["edit", id]),
    preview: item => calls.push(["preview", item.id]),
    present: item => calls.push(["present", item.id]),
    rename() {},
    delete() {}
  })

  card.querySelector(".library-card-preview-button").click()
  ;[...card.querySelectorAll(".library-card-menu-options button")]
    .find(button => button.textContent === "Present")
    .click()

  assert.deepEqual(calls, [["preview", deck.id], ["present", deck.id]])
  assert.equal(card.querySelector(".library-card-preview-button").getAttribute("aria-label"), "Preview A presentation")

  const documentDeck = { ...deck, id: "doc-1", kind: "document" }
  const documentCard = createLibraryCard(document, documentDeck, { open() {}, preview() {}, rename() {}, delete() {} })
  assert.equal([...documentCard.querySelectorAll(".library-card-menu-options button")].some(button => button.textContent === "Present"), false)
})
