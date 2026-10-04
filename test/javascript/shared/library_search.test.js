import assert from "node:assert/strict"
import test from "node:test"
import { parseHTML } from "linkedom"

import { filterLibraryCards } from "../../../app/javascript/lib/library_filter.js"

test("library search matches titles without case or canonical Unicode differences", () => {
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
