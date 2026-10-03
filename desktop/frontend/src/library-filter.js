export function filterDecks(decks, filter = "all", query = "") {
  const normalizedQuery = query.trim().normalize("NFC").toLowerCase()
  const kind = filter === "documents" ? "document" : filter === "presentations" ? "presentation" : null
  return decks.filter(deck => {
    if (kind && deck.kind !== kind) return false
    return !normalizedQuery || deck.name.normalize("NFC").toLowerCase().includes(normalizedQuery)
  })
}
