import assert from "node:assert/strict"
import test from "node:test"
import { parseHTML } from "linkedom"
import { filterDecks, filterLibraryCards } from "../../../app/javascript/lib/library_filter.js"

const decks = [
  { id: "doc-1", name: "Notes", kind: "document" },
  { id: "slides-1", name: "Research", kind: "presentation" },
  { id: "doc-2", name: "Café plans", kind: "document" }
]

test("library filters preserve both work kinds and narrow to each selected tab", () => {
  assert.deepEqual(filterDecks(decks).map(deck => deck.id), ["doc-1", "slides-1", "doc-2"])
  assert.deepEqual(filterDecks(decks, "documents").map(deck => deck.id), ["doc-1", "doc-2"])
  assert.deepEqual(filterDecks(decks, "presentations").map(deck => deck.id), ["slides-1"])
})

test("library search is case and canonical Unicode insensitive within the active filter", () => {
  assert.deepEqual(filterDecks(decks, "documents", "CAFÉ").map(deck => deck.id), ["doc-2"])
  assert.deepEqual(filterDecks(decks, "presentations", "café"), [])
  assert.deepEqual(filterDecks(decks, "all", "  NOTES ").map(deck => deck.id), ["doc-1"])
})

test("DOM search updates card visibility and the no-results state", () => {
  const { document } = parseHTML(`
    <section>
      <article class="library-card"><h2 class="library-card-title">Café Deck</h2></article>
      <article class="library-card"><h2 class="library-card-title">Meeting Notes</h2></article>
      <p id="library-no-results" hidden>No decks match this search.</p>
    </section>
  `)
  const root = document.querySelector("section")
  const cards = [...root.querySelectorAll(".library-card")]
  const noResults = root.querySelector("#library-no-results")

  assert.equal(filterLibraryCards(root, "CAFE\u0301"), 1)
  assert.equal(cards[0].hidden, false)
  assert.equal(cards[1].hidden, true)
  assert.equal(noResults.hidden, true)

  assert.equal(filterLibraryCards(root, "no matching deck"), 0)
  assert.equal(noResults.hidden, false)

  assert.equal(filterLibraryCards(root, ""), 2)
  assert.equal(cards[0].hidden, false)
  assert.equal(cards[1].hidden, false)
  assert.equal(noResults.hidden, true)
})
