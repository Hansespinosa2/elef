export function normalizeLibrarySearch(value) {
  return String(value ?? "").trim().normalize("NFC").toLowerCase()
}

export function libraryNameMatches(name, query) {
  const needle = normalizeLibrarySearch(query)
  return !needle || normalizeLibrarySearch(name).includes(needle)
}

export function filterLibraryCards(root, rawQuery) {
  let visible = 0

  for (const card of root.querySelectorAll("article.library-card")) {
    const title = card.querySelector(".library-card-title")?.textContent?.trim() || ""
    const matches = libraryNameMatches(title, rawQuery)
    card.hidden = !matches
    if (matches) visible += 1
  }

  const noResults = root.querySelector("#library-no-results, [data-library-search-target='noResults']")
  if (noResults) noResults.hidden = !String(rawQuery || "").trim() || visible > 0
  return visible
}
