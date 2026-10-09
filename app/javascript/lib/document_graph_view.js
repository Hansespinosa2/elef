const SVG_NAMESPACE = "http://www.w3.org/2000/svg"

function element(document, name, className, text) {
  const result = document.createElement(name)
  if (className) result.className = className
  if (text !== undefined) result.textContent = text
  return result
}

function svgElement(document, name, attributes = {}) {
  const result = document.createElementNS(SVG_NAMESPACE, name)
  for (const [key, value] of Object.entries(attributes)) {
    if (value !== undefined && value !== null) result.setAttribute(key, String(value))
  }
  return result
}

function documentHref(node) {
  const url = node.url
  if (typeof url === "string" && url.startsWith("/") && !url.startsWith("//") && !/[\\\u0000-\u001f]/.test(url)) {
    return url
  }
  return "#deck/" + encodeURIComponent(String(node.id))
}

function renderGraphSvg(document, nodes, edges) {
  const svg = svgElement(document, "svg", {
    viewBox: "0 0 1000 620",
    role: "img",
    "aria-labelledby": "document-graph-heading"
  })
  const defs = svgElement(document, "defs")
  const marker = svgElement(document, "marker", {
    id: "document-graph-arrow",
    markerWidth: 10,
    markerHeight: 10,
    refX: 9,
    refY: 5,
    orient: "auto",
    markerUnits: "strokeWidth",
    viewBox: "0 0 10 10"
  })
  marker.append(svgElement(document, "path", { d: "M0,0 L10,5 L0,10 Z" }))
  defs.append(marker)

  const viewport = svgElement(document, "g", { "data-document-graph-target": "viewport" })
  const edgeGroup = svgElement(document, "g", {
    class: "document-graph-edges",
    "data-document-graph-target": "edges"
  })
  for (const edge of edges) {
    edgeGroup.append(svgElement(document, "line", {
      class: "document-graph-edge",
      "data-document-graph-target": "edge",
      "data-source-id": edge.source,
      "data-target-id": edge.target,
      "marker-end": "url(#document-graph-arrow)"
    }))
  }

  const nodeGroup = svgElement(document, "g", {
    class: "document-graph-nodes",
    "data-document-graph-target": "nodes"
  })
  for (const node of nodes) {
    const id = String(node.id)
    const title = String(node.title ?? "")
    const link = svgElement(document, "a", {
      href: documentHref(node),
      class: "document-graph-node",
      "data-document-graph-target": "node",
      "data-node-id": id,
      "data-title": title,
      "data-deck-id": id,
      "aria-label": "Open " + title
    })
    const hitArea = svgElement(document, "rect", {
      class: "document-graph-node-hit-area",
      fill: "transparent",
      "pointer-events": "all",
      "aria-hidden": "true"
    })
    const circle = svgElement(document, "circle", { r: 14 })
    const label = svgElement(document, "text", { x: 22, y: 5 })
    label.textContent = title
    const tooltip = svgElement(document, "title")
    tooltip.textContent = title
    link.append(hitArea, circle, label, tooltip)
    nodeGroup.append(link)
  }

  viewport.append(edgeGroup, nodeGroup)
  svg.append(defs, viewport)
  return svg
}

export function renderDocumentGraphView(root, graph) {
  if (!root || !root.ownerDocument || !Array.isArray(graph?.nodes) || !Array.isArray(graph?.edges)) {
    throw new TypeError("A document graph root, nodes, and edges are required.")
  }

  const document = root.ownerDocument
  const nodes = graph.nodes
  const edges = graph.edges

  const heading = element(document, "div", "mb-4 flex items-end justify-between gap-4 max-[920px]:flex-col max-[920px]:items-stretch")
  const introduction = element(document, "div")
  introduction.append(
    element(document, "p", "eyebrow mb-1 text-xs font-extrabold uppercase tracking-[0.12em] text-[#6d4aff]", "Document relationships"),
    element(document, "h2", "mb-1 text-2xl font-bold", "Document network"),
    element(document, "p", "text-[#6f675c]", "Select a document to open it.")
  )
  introduction.querySelector("h2").id = "document-graph-heading"

  const legend = element(document, "div", "document-graph-legend text-sm text-[#6f675c]")
  const linkLegend = element(document, "span")
  linkLegend.append(element(document, "i", "document-graph-key-arrow"), document.createTextNode("Links to a document"))
  legend.append(linkLegend, element(document, "span", null, nodes.length + (nodes.length === 1 ? " document" : " documents")))
  heading.append(introduction, legend)

  const graphContainer = element(document, "div", "document-graph")
  const navigation = element(document, "div", "document-graph-navigation")
  const search = element(document, "div", "document-graph-search")
  const label = element(document, "label", "sr-only", "Find a document")
  label.setAttribute("for", "document-graph-search")
  const input = element(document, "input")
  input.id = "document-graph-search"
  input.type = "search"
  input.placeholder = "Find a document…"
  input.dataset.documentGraphTarget = "search"
  input.dataset.action = "input->document-graph#search keydown.down->document-graph#focusResult"
  const results = element(document, "div", "document-graph-results")
  results.dataset.documentGraphTarget = "results"
  results.dataset.action = "keydown.esc->document-graph#closeSearch"
  results.hidden = true
  search.append(label, input, results)

  const controls = element(document, "div", "document-graph-controls")
  controls.setAttribute("aria-label", "Graph controls")
  const zoomOut = element(document, "button", null, "−")
  zoomOut.type = "button"
  zoomOut.dataset.action = "document-graph#zoomOut"
  zoomOut.setAttribute("aria-label", "Zoom out")
  const reset = element(document, "button", null, "100%")
  reset.type = "button"
  reset.dataset.documentGraphTarget = "scaleLabel"
  reset.dataset.action = "document-graph#reset"
  reset.setAttribute("aria-label", "Reset graph view")
  reset.title = "Reset to 100%"
  const zoomIn = element(document, "button", null, "+")
  zoomIn.type = "button"
  zoomIn.dataset.action = "document-graph#zoomIn"
  zoomIn.setAttribute("aria-label", "Zoom in")
  controls.append(zoomOut, reset, zoomIn)
  navigation.append(search, controls)

  const status = element(document, "span", "sr-only")
  status.dataset.documentGraphTarget = "status"
  status.setAttribute("aria-live", "polite")

  const canvas = element(document, "div", "document-graph-canvas")
  canvas.dataset.documentGraphTarget = "canvas"
  canvas.tabIndex = 0
  canvas.setAttribute("aria-label", "Document network graph")
  canvas.append(renderGraphSvg(document, nodes, edges))
  if (!nodes.length) {
    canvas.append(element(document, "p", "document-graph-empty", "Create a document to start your network."))
  }
  graphContainer.append(navigation, status, canvas)

  const help = element(document, "p", "document-graph-help", "Drag the canvas to pan. Use the controls or your trackpad to zoom.")
  root.replaceChildren(heading, graphContainer, help)
}
