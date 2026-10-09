// Shared document-graph view: renders the graph panel markup into a host
// element. Ported from the Stimulus-era document_graph_view.js without
// behavior change, minus the Stimulus data-action wiring (the client
// GraphController attaches its own listeners). DOM contract (ids, classes,
// aria labels) is unchanged so both hosts keep working through DO-3.

export interface GraphNodeData {
  id: string | number;
  title?: string | null;
  url?: string | null;
  x?: number;
  y?: number;
}

export interface GraphEdgeData {
  source: string | number;
  target: string | number;
}

export interface GraphData {
  nodes: GraphNodeData[];
  edges: GraphEdgeData[];
}

const SVG_NAMESPACE = "http://www.w3.org/2000/svg";

function element(
  document: Document,
  name: string,
  className?: string | null,
  text?: string,
): HTMLElement {
  const result = document.createElement(name);
  if (className) result.className = className;
  if (text !== undefined) result.textContent = text;
  return result;
}

function svgElement(
  document: Document,
  name: string,
  attributes: Record<string, string | number | undefined | null> = {},
): SVGElement {
  const result = document.createElementNS(SVG_NAMESPACE, name);
  for (const [key, value] of Object.entries(attributes)) {
    if (value !== undefined && value !== null) result.setAttribute(key, String(value));
  }
  return result;
}

export function graphNodeHref(node: GraphNodeData): string {
  const url = node.url;
  if (typeof url === "string" && url.startsWith("/") && !url.startsWith("//") && !/[\\\u0000-\u001f]/.test(url)) {
    return url;
  }
  return "#deck/" + encodeURIComponent(String(node.id));
}

function renderGraphSvg(document: Document, nodes: GraphNodeData[], edges: GraphEdgeData[]): SVGElement {
  const svg = svgElement(document, "svg", {
    viewBox: "0 0 1000 620",
    role: "img",
    "aria-labelledby": "document-graph-heading",
  });
  const defs = svgElement(document, "defs");
  const marker = svgElement(document, "marker", {
    id: "document-graph-arrow",
    markerWidth: 10,
    markerHeight: 10,
    refX: 9,
    refY: 5,
    orient: "auto",
    markerUnits: "strokeWidth",
    viewBox: "0 0 10 10",
  });
  marker.append(svgElement(document, "path", { d: "M0,0 L10,5 L0,10 Z" }));
  defs.append(marker);

  const viewport = svgElement(document, "g", { "data-graph-viewport": "" });
  const edgeGroup = svgElement(document, "g", { class: "document-graph-edges" });
  for (const edge of edges) {
    edgeGroup.append(
      svgElement(document, "line", {
        class: "document-graph-edge",
        "data-source-id": edge.source,
        "data-target-id": edge.target,
        "marker-end": "url(#document-graph-arrow)",
      }),
    );
  }

  const nodeGroup = svgElement(document, "g", { class: "document-graph-nodes" });
  for (const node of nodes) {
    const id = String(node.id);
    const title = String(node.title ?? "");
    const link = svgElement(document, "a", {
      href: graphNodeHref(node),
      class: "document-graph-node",
      "data-node-id": id,
      "data-title": title,
      "data-deck-id": id,
      "aria-label": "Open " + title,
    });
    const hitArea = svgElement(document, "rect", {
      class: "document-graph-node-hit-area",
      fill: "transparent",
      "pointer-events": "all",
      "aria-hidden": "true",
    });
    const circle = svgElement(document, "circle", { r: 14 });
    const label = svgElement(document, "text", { x: 22, y: 5 });
    label.textContent = title;
    const tooltip = svgElement(document, "title");
    tooltip.textContent = title;
    link.append(hitArea, circle, label, tooltip);
    nodeGroup.append(link);
  }

  viewport.append(edgeGroup, nodeGroup);
  svg.append(defs, viewport);
  return svg;
}

export function renderGraphView(root: Element, graph: GraphData): void {
  const document = root.ownerDocument;
  if (!root || !document || !Array.isArray(graph?.nodes) || !Array.isArray(graph?.edges)) {
    throw new TypeError("A document graph root, nodes, and edges are required.");
  }

  const nodes = graph.nodes;
  const edges = graph.edges;

  const heading = element(
    document,
    "div",
    "mb-4 flex items-end justify-between gap-4 max-[920px]:flex-col max-[920px]:items-stretch",
  );
  const introduction = element(document, "div");
  introduction.append(
    element(document, "p", "eyebrow mb-1 text-xs font-extrabold uppercase tracking-[0.12em] text-[#6d4aff]", "Document relationships"),
    element(document, "h2", "mb-1 text-2xl font-bold", "Document network"),
    element(document, "p", "text-[#6f675c]", "Select a document to open it."),
  );
  const headingTitle = introduction.querySelector("h2");
  if (headingTitle) headingTitle.id = "document-graph-heading";

  const legend = element(document, "div", "document-graph-legend text-sm text-[#6f675c]");
  const linkLegend = element(document, "span");
  linkLegend.append(element(document, "i", "document-graph-key-arrow"), document.createTextNode("Links to a document"));
  legend.append(linkLegend, element(document, "span", null, nodes.length + (nodes.length === 1 ? " document" : " documents")));
  heading.append(introduction, legend);

  const graphContainer = element(document, "div", "document-graph");
  const navigation = element(document, "div", "document-graph-navigation");
  const search = element(document, "div", "document-graph-search");
  const label = element(document, "label", "sr-only", "Find a document");
  label.setAttribute("for", "document-graph-search");
  const input = element(document, "input") as HTMLInputElement;
  input.id = "document-graph-search";
  input.type = "search";
  input.placeholder = "Find a document…";
  input.dataset.graphSearch = "";
  const results = element(document, "div", "document-graph-results");
  results.hidden = true;
  search.append(label, input, results);

  const controls = element(document, "div", "document-graph-controls");
  controls.setAttribute("aria-label", "Graph controls");
  const zoomOut = element(document, "button", null, "−") as HTMLButtonElement;
  zoomOut.type = "button";
  zoomOut.setAttribute("aria-label", "Zoom out");
  const reset = element(document, "button", null, "100%") as HTMLButtonElement;
  reset.type = "button";
  reset.setAttribute("aria-label", "Reset graph view");
  reset.title = "Reset to 100%";
  const zoomIn = element(document, "button", null, "+") as HTMLButtonElement;
  zoomIn.type = "button";
  zoomIn.setAttribute("aria-label", "Zoom in");
  controls.append(zoomOut, reset, zoomIn);
  navigation.append(search, controls);

  const status = element(document, "span", "sr-only");
  status.setAttribute("aria-live", "polite");

  const canvas = element(document, "div", "document-graph-canvas");
  canvas.tabIndex = 0;
  canvas.setAttribute("aria-label", "Document network graph");
  canvas.append(renderGraphSvg(document, nodes, edges));
  if (!nodes.length) {
    canvas.append(element(document, "p", "document-graph-empty", "Create a document to start your network."));
  }
  graphContainer.append(navigation, status, canvas);

  const help = element(document, "p", "document-graph-help", "Drag the canvas to pan. Use the controls or your trackpad to zoom.");
  root.replaceChildren(heading, graphContainer, help);
}
