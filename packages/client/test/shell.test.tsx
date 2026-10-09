import { test } from "node:test";
import assert from "node:assert/strict";
import { click, mountInto, typedHost, ws } from "./helpers.js";

test("fake host mounts the client shell with no Rails/Tauri process", async () => {
  const host = typedHost();
  await host.library.createWork({
    workspaceId: ws("ws-1"),
    title: "Shell deck",
    kind: "document",
    text: "# Shell deck\n",
  });
  const { element, shell } = await mountInto(host);
  try {
    const items = element.querySelectorAll("article.library-card");
    assert.equal(items.length, 1, "shell lists the fake work");
    const first = items[0];
    assert.ok(first, "first item exists");
    assert.match(first.textContent ?? "", /Shell deck/, "shell shows the work title");
    assert.match(
      element.querySelector("#library-count")?.textContent ?? "",
      /1 work/,
      "shell shows the work count",
    );
  } finally {
    shell.unmount();
  }
  assert.equal(element.querySelector("[data-elef-shell]"), null, "unmount removes the shell");
});

test("initialUrl selects the library filter", async () => {
  const host = typedHost();
  await host.library.createWork({ workspaceId: ws("ws-1"), title: "Doc", kind: "document" });
  await host.library.createWork({ workspaceId: ws("ws-1"), title: "Deck", kind: "presentation" });
  const { element, shell } = await mountInto(host, { initialUrl: "/documents" });
  try {
    const items = element.querySelectorAll("article.library-card");
    assert.equal(items.length, 1, "only documents shown");
    const only = items[0];
    assert.ok(only, "only item exists");
    assert.match(only.textContent ?? "", /Doc/, "the document is shown");
  } finally {
    shell.unmount();
  }
});

test("opening a work calls the host navigate seam with the work id", async () => {
  const host = typedHost();
  const created = await host.library.createWork({
    workspaceId: ws("ws-1"),
    title: "Open me",
    kind: "document",
  });
  const seen: unknown[] = [];
  const { element, shell } = await mountInto(host, { navigate: (target: unknown) => seen.push(target) });
  try {
    const link = element.querySelector(".library-card-title a");
    await click(link);
    assert.deepEqual(seen, [{ workId: created.id, kind: "document" }]);
  } finally {
    shell.unmount();
  }
});

test("shell adopts host slot templates and gates the graph panel on the documents filter", async () => {
  const host = typedHost();
  const slots =
    '<template data-client-slot="actions"><button id="host-action">Load samples</button></template>' +
    '<template data-client-slot="graph"><div id="host-graph">Graph</div></template>';
  const { element, shell } = await mountInto(host, { initialUrl: "/documents" }, slots);
  try {
    assert.ok(
      element.querySelector('[data-client-slot-target="actions"] #host-action'),
      "actions slot content is adopted",
    );
    const graph = element.querySelector("#document-graph-view") as unknown as {
      hidden: boolean;
    };
    assert.ok(element.querySelector("#document-graph-view #host-graph"), "graph content is adopted");
    assert.equal(graph.hidden, false, "graph panel shows on the documents filter");
    assert.equal(
      element.querySelector("template[data-client-slot]"),
      null,
      "adopted templates are removed",
    );
  } finally {
    shell.unmount();
  }
});
