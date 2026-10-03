export function filterLibraryCards(root, rawQuery) {
  const query = String(rawQuery || "").trim().normalize("NFC").toLowerCase()
  let visible = 0

  for (const card of root.querySelectorAll("article.library-card")) {
    const title = card.querySelector(".library-card-title")?.textContent?.trim() || ""
    const matches = title.normalize("NFC").toLowerCase().includes(query)
    card.hidden = !matches
    if (matches) visible += 1
  }

  const noResults = root.querySelector("[data-library-search-target='noResults']")
  if (noResults) noResults.hidden = !query || visible > 0
  return visible
}
