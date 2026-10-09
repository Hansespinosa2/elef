import assert from "node:assert/strict"
import test from "node:test"
import { readFile } from "node:fs/promises"
import vm from "node:vm"
import { parseHTML } from "linkedom"
import { createLibraryCard, renderLibraryCard, renderLibraryCardControls } from "../../../app/javascript/lib/library_card.js"

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
  assert.equal(document.querySelectorAll(".library-card-controls").length, 1)
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
  const deck = { id: "deck-unsafe", name: title, kind: "presentation", source_file: "deck.md", warnings: ['<script>run()</script>'] }
  const card = createLibraryCard(document, deck, { open() {}, rename() {}, delete() {} })
  assert.equal(card.querySelector("img, script, [onerror]"), null)
  assert.equal(card.querySelector(".deck-warning").textContent, deck.warnings[0])
  assert.equal(card.querySelector(".deck-warning").getAttribute("role"), "note")
  for (const editUrl of ["javascript:run()", "https://example.com", "//example.com"]) {
    assert.throws(() => renderLibraryCard({ ...properties, editUrl }), TypeError)
  }
})

test("Rails and desktop use the shared library action markup with host-supplied behavior", () => {
  const properties = {
    title: "A & \"Better\" Deck",
    kind: "presentation",
    previewUrl: "/presentations/42",
    authenticityToken: "csrf-token",
    rename: {
      url: "/presentations/42/rename",
      method: "patch",
      name: "presentation[title]",
      id: "presentation_42_rename_title",
      fields: [{ name: "library_view", value: "presentations" }]
    },
    fork: {
      choices: [
        { label: "As continuation", url: "/presentations/42/fork", fields: [{ name: "fork_type", value: "continuation" }] },
        { label: "As inspiration", url: "/presentations/42/fork", fields: [{ name: "fork_type", value: "inspiration" }] }
      ]
    },
    present: { url: "/presentations/42/publish", turbo: false },
    remove: { url: "/presentations/42", method: "delete", confirm: 'Delete A & "Better" Deck?' }
  }
  const html = renderLibraryCardControls(properties)
  assert.equal(sandbox.ElefRenderer.renderLibraryCardControls(properties), html)

  const { document } = parseHTML(html)
  assert.equal(document.querySelector("a.library-card-preview-button").getAttribute("href"), properties.previewUrl)
  assert.equal(document.querySelector(".library-card-menu-trigger").getAttribute("aria-label"), `More actions for ${properties.title}`)
  assert.equal(document.querySelector(".library-rename").getAttribute("action"), properties.rename.url)
  assert.equal(document.querySelector('.library-rename input[name="presentation[title]"]').value, properties.title)
  assert.equal(document.querySelector('.library-rename input[name="_method"]').value, "patch")
  assert.equal(document.querySelector('.library-rename input[name="library_view"]').value, "presentations")
  assert.equal(document.querySelectorAll('.fork-menu-options form input[name="fork_type"]').length, 2)
  assert.equal(document.querySelector('form[action="/presentations/42/publish"]').getAttribute("data-turbo"), "false")
  assert.equal(document.querySelector('form[action="/presentations/42"]').getAttribute("data-turbo-confirm"), 'Delete A & "Better" Deck?')
  assert.equal(document.querySelectorAll('form input[name="authenticity_token"]').length, 5)
  assert.equal(document.querySelector("script, [onclick], [onerror]"), null)
})

test("desktop card actions match web preview and presentation entry points", () => {
  const { document, Event } = parseHTML("<main></main>")
  const calls = []
  const deck = { id: "pres-1", name: "A presentation", kind: "presentation", modified_ms: 0, warnings: [] }
  const card = createLibraryCard(document, deck, {
    open: id => calls.push(["edit", id]),
    preview: item => calls.push(["preview", item.id]),
    present: item => calls.push(["present", item.id]),
    rename: (item, name) => calls.push(["rename", item.id, name]),
    delete: item => calls.push(["delete", item.id])
  })

  assert.equal(card.querySelectorAll(".library-card-controls").length, 1)
  card.querySelector(".library-card-preview-button").click()
  ;[...card.querySelectorAll(".library-card-menu-options button")]
    .find(button => button.textContent === "Present")
    .click()
  card.querySelector(".library-rename input").value = "Renamed presentation"
  card.querySelector(".library-rename").dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }))
  card.querySelector(".danger").click()

  assert.deepEqual(calls, [
    ["preview", deck.id],
    ["present", deck.id],
    ["rename", deck.id, "Renamed presentation"],
    ["delete", deck.id]
  ])
  assert.equal(card.querySelector(".library-card-preview-button").getAttribute("aria-label"), "Preview A presentation")

  const documentDeck = { ...deck, id: "doc-1", kind: "document" }
  const documentCard = createLibraryCard(document, documentDeck, { open() {}, preview() {}, rename() {}, delete() {} })
  assert.equal([...documentCard.querySelectorAll(".library-card-menu-options button")].some(button => button.textContent === "Present"), false)
})
