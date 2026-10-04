import { libraryNameMatches } from "../../../app/javascript/lib/library_filter.js"

export function filterDecks(decks, filter = "all", query = "") {
  const kind = filter === "documents" ? "document" : filter === "presentations" ? "presentation" : null
  return decks.filter(deck => {
    if (kind && deck.kind !== kind) return false
    return libraryNameMatches(deck.name, query)
  })
}
