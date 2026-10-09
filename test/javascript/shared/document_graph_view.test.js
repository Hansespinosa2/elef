import assert from "node:assert/strict"
import test from "node:test"
import { parseHTML } from "linkedom"
import { renderDocumentGraphView } from "../../../app/javascript/lib/document_graph_view.js"

function render(graph) {
  const { document } = parseHTML('<section aria-labelledby="document-graph-heading"></section>')
  const root = document.querySelector("section")
  renderDocumentGraphView(root, graph)
  return { document, root }
}

test("the shared graph view renders accessible nodes, links, edges, search, and controls", () => {
  const graph = {
    nodes: [
      { id: 12, title: "Planning", url: "/documents/12" },
      { id: "local-id", title: "Notes & diagrams" }
    ],
    edges: [{ source: 12, target: "local-id" }]
  }
  const { document, root } = render(graph)

  assert.equal(root.querySelector("h2").textContent, "Document network")
  assert.equal(root.querySelector(".document-graph-legend").textContent, "Links to a document2 documents")
  assert.equal(root.querySelectorAll(".document-graph-node").length, 2)
  assert.equal(root.querySelector(".document-graph-node[href='/documents/12']").dataset.deckId, "12")
  assert.equal(root.querySelector(".document-graph-node[href='#deck/local-id']").getAttribute("aria-label"), "Open Notes & diagrams")
  assert.equal(root.querySelector(".document-graph-node[data-node-id='local-id'] text").textContent, "Notes & diagrams")
  assert.equal(root.querySelector(".document-graph-edge").dataset.sourceId, "12")
  assert.equal(root.querySelector(".document-graph-edge").dataset.targetId, "local-id")
  assert.equal(root.querySelector("label[for='document-graph-search']").textContent, "Find a document")
  assert.ok(root.querySelector("[data-action='document-graph#zoomIn']"))
  assert.ok(root.querySelector("[data-document-graph-target='status'][aria-live='polite']"))
  assert.equal(document.querySelectorAll("script, img").length, 0)
})

test("graph titles stay inert and unsafe links fall back to local deck navigation", () => {
  const { document, root } = render({
    nodes: [{ id: "safe-id", title: '<img src=x onerror="run()"><script>run()</script>', url: "javascript:run()" }],
    edges: []
  })
  const node = root.querySelector(".document-graph-node")

  assert.equal(node.getAttribute("href"), "#deck/safe-id")
  assert.equal(node.querySelector("text").textContent, '<img src=x onerror="run()"><script>run()</script>')
  assert.equal(document.querySelector("img, script, [onerror]"), null)
})

test("the shared graph view renders a useful empty state", () => {
  const { root } = render({ nodes: [], edges: [] })

  assert.equal(root.querySelector(".document-graph-legend span:last-child").textContent, "0 documents")
  assert.equal(root.querySelector(".document-graph-empty").textContent, "Create a document to start your network.")
  assert.equal(root.querySelectorAll(".document-graph-node").length, 0)
})

test("invalid graph payloads fail closed", () => {
  const { document } = parseHTML("<section></section>")
  assert.throws(() => renderDocumentGraphView(document.querySelector("section"), { nodes: [] }), TypeError)
})
