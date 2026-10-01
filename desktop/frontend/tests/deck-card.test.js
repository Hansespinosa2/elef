import assert from "node:assert/strict"
import test from "node:test"
import { parseHTML } from "linkedom"

import { createDeckCard } from "../src/deck-card.js"

test("untrusted deck names and warnings are inserted as text", () => {
  const { document } = parseHTML("<html><body></body></html>")
  const deck = {
    id: "deck-1",
    name: "<img src=x onerror=alert(1)>",
    kind: "presentation",
    source_file: "talk.md",
    warnings: ["<script>run()</script>"]
  }

  const card = createDeckCard(document, deck, { open() {}, rename() {}, delete() {} })

  assert.equal(card.querySelector("img, script"), null)
  assert.equal(card.querySelector(".deck-name").textContent, deck.name)
  assert.equal(card.querySelector(".deck-warning").textContent, deck.warnings[0])
})

test("deck actions carry the selected deck identity", () => {
  const { document, Event } = parseHTML("<html><body></body></html>")
  const deck = { id: "deck-42", name: "Notes", kind: "document", source_file: "document.md", warnings: [] }
  const calls = []
  const card = createDeckCard(document, deck, {
    open: id => calls.push(["open", id]),
    rename: item => calls.push(["rename", item.id]),
    delete: item => calls.push(["delete", item.id])
  })
  const click = () => new Event("click", { bubbles: true })

  card.querySelector(".deck-open").dispatchEvent(click())
  card.querySelector(".deck-action").dispatchEvent(click())
  card.querySelector(".danger").dispatchEvent(click())

  assert.deepEqual(calls, [["open", "deck-42"], ["rename", "deck-42"], ["delete", "deck-42"]])
})
