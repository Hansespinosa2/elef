const LIBRARY_VIEW = `
  <div class="library-shared-view">
  <header class="library-hero page-heading mb-8 flex items-end justify-between gap-4 max-[920px]:flex-col max-[920px]:items-stretch">
    <div>
      <div class="library-kicker flex items-center gap-3">
        <p class="eyebrow mb-1 text-xs font-extrabold uppercase tracking-[0.12em] text-[#6d4aff]">Your workspace</p>
        <span id="library-count" class="library-count rounded-full border border-[#304047] bg-[#202c32] px-2 py-1 text-xs font-bold text-[#aab7b1]"></span>
      </div>
      <h1 id="library-title" class="mb-0 text-4xl font-bold">Library</h1>
      <p id="library-description" class="subheading mt-2 text-[#6f675c]"></p>
    </div>
    <div data-library-view-slot="actions"></div>
    <label class="search-box" for="library-search">
      <span aria-hidden="true">⌕</span>
      <input id="library-search" type="search" placeholder="Search decks" autocomplete="off" aria-label="Search decks" data-action="input->library-search#filter">
      <kbd>⌘ K</kbd>
    </label>
  </header>

  <section class="library-browser" aria-label="Browse your library">
    <nav class="library-tabs mb-6 flex flex-wrap gap-2" aria-label="Library views">
      <a id="show-deck-list" class="library-tab" data-library-tab="all">All</a>
      <a id="show-documents" class="library-tab" data-library-tab="documents">Documents</a>
      <a id="show-presentations" class="library-tab" data-library-tab="presentations">Presentations</a>
    </nav>
    <div id="notice" class="notice" role="status" aria-live="polite" hidden></div>
    <section id="document-graph-view" class="document-graph-panel mt-8 rounded-2xl border border-[#ddd5c8] bg-[#fffdf8] p-5" hidden aria-labelledby="document-graph-heading"></section>
    <div data-library-view-slot="lineage"></div>
    <section id="deck-list" class="library-list deck-list mt-8 grid gap-4" role="list" aria-label="Saved work"></section>
    <button id="library-load-more" class="button secondary library-load-more mt-6" type="button" aria-controls="deck-list" hidden>Load more decks</button>
    <div id="empty-library" class="empty-state flex items-center justify-between rounded-2xl border border-[#ddd5c8] bg-[#fffdf8] p-5 max-[920px]:flex-col max-[920px]:items-stretch" hidden>
      <div>
        <h2 class="mb-2 text-2xl font-bold" data-library-empty-title></h2>
        <p class="text-[#6f675c]" data-library-empty-copy></p>
      </div>
      <div data-library-view-slot="empty-action"></div>
    </div>
    <p id="library-no-results" class="library-no-results no-results" data-library-search-target="noResults" role="status" hidden>No decks match this search.</p>
  </section>
  </div>
`

const VALID_FILTERS = new Set(["all", "documents", "presentations"])

export function mountLibraryHosts(root = globalThis.document) {
  if (!root) return
  for (const host of root.querySelectorAll("[data-library-view-config]")) {
    if (host.dataset.libraryViewMounted === "true") continue
    const config = JSON.parse(host.dataset.libraryViewConfig)
    renderLibraryView(host, config)
    host.dataset.libraryViewMounted = "true"
  }
}

export function renderLibraryView(container, config = {}) {
  if (!container?.ownerDocument) throw new TypeError("Library view needs a DOM container")

  const document = container.ownerDocument
  const template = document.createElement("template")
  template.innerHTML = LIBRARY_VIEW
  const root = template.content.firstElementChild
  const browser = template.content.querySelector(".library-browser")
  const filter = VALID_FILTERS.has(config.filter) ? config.filter : "all"
  const routes = config.routes || {}

  root.querySelector("#library-title").textContent = config.title || "Library"
  root.querySelector("#library-count").textContent = config.countLabel || "0 works"
  root.querySelector("#library-description").textContent = config.description || "One home for your documents, presentations, and source."
  const search = root.querySelector("#library-search")
  if (config.searchController) root.dataset.controller = "library-search"
  else search.removeAttribute("data-action")

  for (const link of root.querySelectorAll("[data-library-tab]")) {
    const name = link.dataset.libraryTab
    link.href = routes[name] || `#library/${name}`
    const selected = name === filter
    link.classList.toggle("is-active", selected)
    if (selected) link.setAttribute("aria-current", "page")
  }
  root.querySelector("#deck-list").setAttribute("aria-label", `Saved ${filter}`)

  const graph = root.querySelector("#document-graph-view")
  const empty = root.querySelector("#empty-library")
  empty.hidden = !config.empty
  const actions = root.querySelector('[data-library-view-slot="actions"]')
  moveSlot(container, "actions", actions)
  const hasGraph = moveGraphSlot(container, graph)
  graph.hidden = filter !== "documents" || !hasGraph
  moveSlot(container, "lineage", root.querySelector('[data-library-view-slot="lineage"]'))
  moveSlot(container, "cards", root.querySelector("#deck-list"))
  moveSlot(container, "empty-action", empty.querySelector('[data-library-view-slot="empty-action"]'))
  updateLibraryEmptyState(empty, filter)

  container.replaceChildren(template.content)
  return {
    root,
    browser: container.querySelector(".library-browser"),
    list: container.querySelector("#deck-list"),
    graph: container.querySelector("#document-graph-view"),
    count: container.querySelector("#library-count"),
    empty: container.querySelector("#empty-library"),
    noResults: container.querySelector("#library-no-results"),
    search: container.querySelector("#library-search")
  }
}

export function updateLibraryEmptyState(container, filter = "all") {
  const selected = VALID_FILTERS.has(filter) ? filter : "all"
  const kindLabel = selected === "all" ? "work" : selected === "documents" ? "document" : "presentation"
  const title = container.querySelector("[data-library-empty-title]")
  const copy = container.querySelector("[data-library-empty-copy]")
  const action = container.querySelector("[data-library-empty-action]")
  title.textContent = `No ${kindLabel}${selected === "all" ? "" : "s"} yet.`
  copy.textContent = "Start with Markdown. Elef keeps your source and assets in your library."
  if (action) {
    action.textContent = selected === "documents" ? "Create a document" : "Create a presentation"
    action.dataset.kind = selected === "documents" ? "document" : "presentation"
  }
}

function moveSlot(host, name, target) {
  const slot = host.querySelector(`template[data-library-view-slot="${name}"]`)
  if (!slot || !target) return
  const wrapperClass = name === "cards" ? "library-list" : null
  const wrapper = wrapperClass ? slot.content.firstElementChild : null
  if (wrapper?.classList.contains(wrapperClass)) target.append(...wrapper.childNodes)
  else target.append(slot.content)
}

function moveGraphSlot(host, target) {
  const slot = host.querySelector('template[data-library-view-slot="graph"]')
  const source = slot?.content.firstElementChild
  if (!source || !target) return false

  for (const attribute of source.attributes) {
    if (attribute.name !== "id" && attribute.name !== "hidden") target.setAttribute(attribute.name, attribute.value)
  }
  target.replaceChildren(...source.childNodes)
  return true
}
