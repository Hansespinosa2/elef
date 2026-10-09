import assert from "node:assert/strict"
import test from "node:test"
import { parseHTML } from "linkedom"

import { createLibraryCard } from "../../app/javascript/lib/library_card.js"

test("untrusted deck names and warnings are inserted as text", () => {
  const { document } = parseHTML("<html><body></body></html>")
  const deck = {
    id: "deck-1",
    name: "<img src=x onerror=alert(1)>",
    kind: "presentation",
    source_file: "talk.md",
    warnings: ["<script>run()</script>"]
  }

  const card = createLibraryCard(document, deck, { open() {}, rename() {}, delete() {} })

  assert.equal(card.querySelector("img, script"), null)
  assert.equal(card.querySelector(".library-card-title").textContent, deck.name)
  assert.equal(card.querySelector(".deck-warning").textContent, deck.warnings[0])
})

test("deck actions carry the selected deck identity", () => {
  const { document, Event } = parseHTML("<html><body></body></html>")
  const deck = { id: "deck-42", name: "Notes", kind: "document", source_file: "document.md", warnings: [] }
  const calls = []
  const card = createLibraryCard(document, deck, {
    open: id => calls.push(["open", id]),
    rename: (item, name) => calls.push(["rename", item.id, name]),
    delete: item => calls.push(["delete", item.id])
  })
  const click = () => new Event("click", { bubbles: true })

  card.querySelector(".library-card-open").dispatchEvent(click())
  card.querySelector(".library-rename input").value = "New notes"
  card.querySelector(".library-rename").dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }))
  card.querySelector(".danger").dispatchEvent(click())

  assert.deepEqual(calls, [["open", "deck-42"], ["rename", "deck-42", "New notes"], ["delete", "deck-42"]])
})
