import assert from "node:assert/strict"
import test from "node:test"
import { filterDecks } from "../../../app/javascript/lib/library_filter.js"

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
