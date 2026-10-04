import assert from "node:assert/strict"
import test from "node:test"
import { parseHTML } from "linkedom"
import { mountLibraryHosts, renderLibraryView, updateLibraryEmptyState } from "../../../app/javascript/lib/library_view.js"

function mount(config = {}, slots = "") {
  const { document } = parseHTML(`<div id="mount">${slots}</div>`)
  const host = document.querySelector("#mount")
  const view = renderLibraryView(host, config)
  return { document, host, view }
}

test("both hosts receive one library header, search field, and three shared views", () => {
  const { document, view } = mount({
    filter: "documents",
    countLabel: "4 works",
    description: "Long-form Markdown, gathered in one calm place.",
    routes: { all: "/", documents: "/documents", presentations: "/presentations" }
  })

  assert.equal(document.querySelectorAll("#library-title").length, 1)
  assert.equal(document.querySelector("#library-title").textContent, "Library")
  assert.equal(view.search.getAttribute("aria-label"), "Search decks")
  assert.equal(view.count.textContent, "4 works")
  assert.equal(view.browser.querySelector("#show-documents").getAttribute("aria-current"), "page")
  assert.equal(view.browser.querySelector("#show-documents").getAttribute("href"), "/documents")
  assert.equal(view.browser.querySelectorAll("[data-library-tab]").length, 3)
  assert.equal(view.graph.hidden, true)
})

test("Rails slots populate shared cards, actions, empty action, and the documents graph", () => {
  const { host, view } = mount({ filter: "documents", searchController: true }, `
    <template data-library-view-slot="actions"><button id="library-action">More</button></template>
    <template data-library-view-slot="graph"><section class="document-graph-panel" data-controller="document-graph" data-document-graph-data-value='{"nodes":[],"edges":[]}'><h2 id="document-graph-heading">Document network</h2></section></template>
    <template data-library-view-slot="cards"><article class="library-card"><h2 class="library-card-title">A document</h2></article></template>
    <template data-library-view-slot="empty-action"><button id="server-create" data-library-empty-action>Create a presentation</button></template>
  `)

  assert.equal(host.querySelector("#library-action").textContent, "More")
  assert.equal(view.list.querySelector(".library-card-title").textContent, "A document")
  assert.equal(view.empty.querySelector("[data-library-empty-title]").textContent, "No documents yet.")
  assert.equal(view.empty.querySelector("[data-library-empty-copy]").textContent, "Start with Markdown. Elef keeps your source and assets in your library.")
  assert.equal(view.empty.querySelector("#server-create").textContent, "Create a document")
  assert.equal(view.empty.querySelector("#server-create").dataset.kind, "document")
  assert.equal(view.empty.querySelectorAll(".empty-state").length, 0)
  assert.equal(view.graph.hidden, false)
  assert.equal(view.graph.dataset.controller, "document-graph")
  assert.equal(view.graph.querySelector("#document-graph-heading").textContent, "Document network")
  assert.equal(view.root.dataset.controller, "library-search")
})

test("the shared empty state keeps its copy and create action in sync with the active filter", () => {
  const { view } = mount({}, `<template data-library-view-slot="empty-action"><button data-library-empty-action>create</button></template>`)
  updateLibraryEmptyState(view.empty, "presentations")
  assert.equal(view.empty.querySelector("[data-library-empty-title]").textContent, "No presentations yet.")
  assert.equal(view.empty.querySelector("[data-library-empty-action]").textContent, "Create a presentation")
  assert.equal(view.empty.querySelector("[data-library-empty-action]").dataset.kind, "presentation")
})

test("configuration strings remain text and desktop can own navigation and filtering", () => {
  const { view } = mount({
    filter: "all",
    countLabel: "<script>unsafe</script>",
    description: "<img src=x onerror=alert(1)>",
    searchController: false
  })

  assert.equal(view.count.textContent, "<script>unsafe</script>")
  assert.equal(view.count.querySelector("script"), null)
  assert.equal(view.root.querySelector("#library-description").textContent, "<img src=x onerror=alert(1)>")
  assert.equal(view.search.hasAttribute("data-action"), false)
  assert.equal(view.root.querySelector("#show-documents").getAttribute("href"), "#library/documents")
})

test("Rails library hosts hydrate once from their serialized view contract", () => {
  const { document } = parseHTML(`
    <main>
      <div id="host" data-library-view-config='{"filter":"documents","title":"Library","countLabel":"2 works","description":"Shared description","searchController":true}'>
        <template data-library-view-slot="cards"><section class="library-list" role="list"><article class="library-card"><h2 class="library-card-title">Notes</h2></article></section></template>
      </div>
    </main>
  `)

  mountLibraryHosts(document)
  mountLibraryHosts(document)

  const host = document.querySelector("#host")
  assert.equal(host.querySelectorAll(".library-shared-view").length, 1)
  assert.equal(host.querySelector(".library-shared-view").dataset.controller, "library-search")
  assert.equal(host.querySelector("#library-title").textContent, "Library")
  assert.equal(host.querySelector("#library-count").textContent, "2 works")
  assert.equal(host.querySelector("#deck-list .library-card-title").textContent, "Notes")
  assert.equal(host.querySelector("#show-documents").getAttribute("aria-current"), "page")
})
