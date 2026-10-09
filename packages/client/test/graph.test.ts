import { test } from "node:test";
import assert from "node:assert/strict";
import { parseHTML } from "linkedom";

import { renderGraphView } from "../src/features/graph/graphView.js";
import { GraphController } from "../src/features/graph/graphController.js";
import {
  clampZoom,
  edgeGeometry,
  initNodeStates,
  searchMatches,
  stepSimulation,
  wrapLabel,
} from "../src/features/graph/graphLayout.js";

function render(graph: { nodes: never[] | { id: string | number; title?: string; url?: string }[]; edges: { source: string | number; target: string | number }[] }) {
  const { document } = parseHTML('<section><div id="graph-root"></div></section>');
  const root = document.querySelector("#graph-root") as unknown as Element;
  renderGraphView(root, graph);
  return { document, root };
}

const demo = {
  nodes: [
    { id: 12, title: "Planning", url: "/documents/12" },
    { id: "local-id", title: "Notes & diagrams" },
  ],
  edges: [{ source: 12, target: "local-id" }],
};

test("client graph view renders accessible nodes, edges, search, and controls", () => {
  const { document, root } = render(demo);

  assert.equal(root.querySelector("h2")?.textContent, "Document network");
  assert.equal(root.querySelector("#document-graph-heading")?.textContent, "Document network");
  assert.equal(root.querySelectorAll(".document-graph-node").length, 2);
  assert.equal(root.querySelector(".document-graph-node[href='/documents/12']")?.getAttribute("data-deck-id"), "12");
  assert.equal(
    root.querySelector(".document-graph-node[data-node-id='local-id']")?.getAttribute("aria-label"),
    "Open Notes & diagrams",
  );
  assert.equal(root.querySelector(".document-graph-edge")?.getAttribute("data-source-id"), "12");
  assert.equal(root.querySelector(".document-graph-edge")?.getAttribute("data-target-id"), "local-id");
  assert.equal(root.querySelector("label[for='document-graph-search']")?.textContent, "Find a document");
  assert.ok(root.querySelector(".document-graph-controls button[aria-label='Zoom in']"));
  assert.ok(root.querySelector(".document-graph-controls button[aria-label='Zoom out']"));
  assert.ok(root.querySelector(".document-graph-controls button[aria-label='Reset graph view']"));
  assert.ok(root.querySelector("[aria-live='polite']"));
  assert.equal(document.querySelectorAll("script, img").length, 0);
});

test("client graph view keeps titles inert and unsafe links local", () => {
  const { document, root } = render({
    nodes: [{ id: "safe-id", title: '<img src=x onerror="run()"><script>run()</script>', url: "javascript:run()" }],
    edges: [],
  });

  assert.equal(
    root.querySelector(".document-graph-node")?.getAttribute("href"),
    "#deck/safe-id",
  );
  assert.equal(document.querySelectorAll("script, img").length, 0);
});

test("client graph view shows the empty-network hint without nodes", () => {
  const { root } = render({ nodes: [], edges: [] });

  assert.equal(root.querySelector(".document-graph-empty")?.textContent, "Create a document to start your network.");
  assert.equal(root.querySelector(".document-graph-legend span:last-child")?.textContent, "0 documents");
});

test("client graph layout wraps labels, clamps zoom, and bounds simulation", () => {
  assert.deepEqual(wrapLabel("one two three", 7), ["one two", "three"]);
  assert.deepEqual(wrapLabel("supercalifragilistic", 5), ["super", "calif", "ragil", "istic"]);
  assert.deepEqual(wrapLabel("", 5), [""]);
  assert.equal(clampZoom(99), 2.5);
  assert.equal(clampZoom(0.01), 0.55);
  assert.equal(clampZoom(1.4), 1.4);

  const states = initNodeStates({ nodes: [{ id: "a", title: "A", x: 50000, y: -20 }], edges: [] });
  stepSimulation(states, []);
  const state = states.get("a");
  assert.ok(state);
  assert.ok(state.x <= 965 && state.y >= 35);

  const geometry = edgeGeometry(
    { id: "a", title: "A", x: 0, y: 0, vx: 0, vy: 0 },
    { id: "b", title: "B", x: 100, y: 0, vx: 0, vy: 0 },
  );
  assert.deepEqual(geometry, { x1: 18, y1: 0, x2: 82, y2: 0 });

  assert.deepEqual(
    searchMatches([{ id: 1, title: "Planning" }, { id: 2, title: "Notes" }], "plan").map((node) => node.id),
    [1],
  );
  assert.deepEqual(searchMatches([{ id: 1, title: "Planning" }], "   "), []);
});

test("client graph controller mounts status, zooms, highlights, and searches", () => {
  const { document, root } = render(demo);
  let opened: string | undefined;
  let cancelled = 0;
  const controller = new GraphController(
    root,
    { nodes: demo.nodes, edges: demo.edges },
    {
      onOpenDeck: (id) => {
        opened = id;
      },
      scheduleFrame: () => 0,
      cancelFrame: () => {
        cancelled += 1;
      },
    },
  );

  assert.equal(root.querySelector("[aria-live]")?.textContent, "2 documents");

  controller.zoomIn();
  assert.equal(root.querySelector(".document-graph-controls button[aria-label='Reset graph view']")?.textContent, "120%");
  controller.reset();
  assert.equal(root.querySelector(".document-graph-controls button[aria-label='Reset graph view']")?.textContent, "100%");

  controller.highlight(12);
  assert.ok(root.querySelector(".document-graph-node[data-node-id='12']")?.classList.contains("is-highlighted"));
  assert.ok(root.querySelector(".document-graph-node[data-node-id='local-id']")?.classList.contains("is-highlighted"));
  assert.ok(root.querySelector(".document-graph-edge")?.classList.contains("is-highlighted"));
  controller.highlight();
  assert.ok(!root.querySelector(".document-graph-node[data-node-id='12']")?.classList.contains("is-dimmed"));

  assert.equal(controller.search("plan"), 1);
  assert.equal(root.querySelector(".document-graph-results")?.childElementCount, 1);
  assert.ok(root.querySelector(".document-graph-node[data-node-id='12']")?.classList.contains("is-search-match"));
  controller.closeSearch();
  assert.equal((root.querySelector(".document-graph-results") as HTMLElement | null)?.hidden, true);

  controller.centerNode("local-id");
  assert.match(
    root.querySelector("[data-graph-viewport]")?.getAttribute("transform") ?? "",
    /translate\(/,
  );

  const node = root.querySelector(".document-graph-node[data-node-id='12']");
  const click = document.createEvent("Event") as unknown as Event & { initEvent: (t: string, b: boolean, c: boolean) => void };
  click.initEvent("click", true, true);
  node?.dispatchEvent(click);
  assert.equal(opened, "12");

  controller.destroy();
  assert.equal(cancelled, 0);
});
