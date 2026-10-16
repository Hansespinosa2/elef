import { test } from "node:test";
import assert from "node:assert/strict";
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { parseHTML } from "linkedom";
import type { ElefHost } from "@elef/contracts";
import { NewWorkMenu } from "../src/features/library/NewWorkMenu.js";
import { mountNewWorkMenu } from "../src/index.js";
import type { ElefMountOptions, LibraryPaletteCommand, LibraryPaletteSeam } from "../src/index.js";
import { click, mountInto, setInputValue, settled, typedHost, ws } from "./helpers.js";

async function seed(host: ReturnType<typeof typedHost>) {
  const alpha = await host.library.createWork({
    workspaceId: ws("ws-1"),
    title: "Alpha doc",
    kind: "document",
    text: "# Alpha\n",
  });
  const cafe = await host.library.createWork({
    workspaceId: ws("ws-1"),
    title: "Café Work",
    kind: "presentation",
    text: "# Café Work\n",
  });
  return { alpha, cafe };
}

function paletteSeam(ran: string[]): LibraryPaletteSeam {
  const commands: LibraryPaletteCommand[] = [
    {
      id: "new-presentation",
      label: "New presentation",
      description: "Create slide-based Markdown",
      chord: "⌘N",
      run: () => ran.push("new-presentation"),
    },
    {
      id: "new-document",
      label: "New document",
      description: "Create a continuous Markdown document",
      chord: null,
      run: () => ran.push("new-document"),
    },
  ];
  return { commands };
}

async function press(node: Element, key: string): Promise<void> {
  const view = node.ownerDocument.defaultView as unknown as { Event: typeof Event };
  await act(async () => {
    // Browsers focus the field before keys reach it. React resolves keydown
    // value tracking through that focusin, but its fallback path calls the
    // IE-only attachEvent/detachEvent host APIs, which linkedom lacks — so
    // shim them as no-ops first. Harness-only: product code is untouched.
    const host = node as unknown as Record<string, unknown>;
    if (typeof host["attachEvent"] !== "function") host["attachEvent"] = () => {};
    if (typeof host["detachEvent"] !== "function") host["detachEvent"] = () => {};
    node.dispatchEvent(new view.Event("focusin", { bubbles: true, cancelable: true }));
  });
  const event = new view.Event("keydown", { bubbles: true, cancelable: true }) as Event & { key?: string };
  event.key = key;
  await act(async () => {
    node.dispatchEvent(event);
  });
  await settled();
}

function optionLabels(element: Element): string[] {
  return [...element.querySelectorAll(".command-palette-option strong")].map(
    (node) => node.textContent?.trim() ?? "",
  );
}

test("new work menu mirrors the web dropdown contract", async () => {
  const seen: string[] = [];
  const { document } = parseHTML("<html><body><div id=\"app\"></div></body></html>");
  const view = (document as unknown as { defaultView?: unknown }).defaultView;
  (globalThis as Record<string, unknown>)["window"] = view ?? { document };
  (globalThis as Record<string, unknown>)["document"] = document;
  const element = document.getElementById("app") as unknown as HTMLElement;
  const root = createRoot(element);
  await act(async () => {
    root.render(createElement(NewWorkMenu, { onSelect: (kind) => seen.push(kind) }));
  });
  const trigger = element.querySelector(".new-work-trigger");
  assert.notEqual(trigger, null, "trigger keeps the web class");
  assert.equal(trigger?.textContent?.includes("New"), true);
  await click(trigger);
  assert.equal(
    element.querySelector(".new-work-menu")?.getAttribute("data-open"),
    "true",
    "open state drives the chevron rule",
  );
  const items = [...element.querySelectorAll('[role="menuitem"]')];
  assert.equal(items.length, 2);
  const copy = items.map((item) => item.textContent ?? "");
  assert.match(copy[0] ?? "", /Document/);
  assert.match(copy[0] ?? "", /Continuous Markdown for writing/);
  assert.match(copy[1] ?? "", /Presentation/);
  assert.match(copy[1] ?? "", /Slide-based Markdown for talks/);
  for (const item of items) assert.match(item.textContent ?? "", /→/);
  assert.deepEqual(
    [...items.map((item) => item.getAttribute("data-new-work-kind"))],
    ["document", "presentation"],
  );
  await click(items[0]);
  assert.deepEqual(seen, ["document"]);
  assert.equal(element.querySelector(".new-work-panel"), null, "choosing closes the panel");
  await act(async () => {
    root.unmount();
  });
});

test("new work menu keyboard: arrows move, Enter chooses, Escape closes", async () => {
  const seen: string[] = [];
  const { document } = parseHTML("<html><body><div id=\"app\"></div></body></html>");
  const view = (document as unknown as { defaultView?: unknown }).defaultView;
  (globalThis as Record<string, unknown>)["window"] = view ?? { document };
  (globalThis as Record<string, unknown>)["document"] = document;
  const element = document.getElementById("app") as unknown as HTMLElement;
  const root = createRoot(element);
  await act(async () => {
    root.render(createElement(NewWorkMenu, { onSelect: (kind) => seen.push(kind) }));
  });
  const trigger = element.querySelector(".new-work-trigger") as Element;
  await press(trigger, "Enter");
  assert.notEqual(element.querySelector(".new-work-panel"), null, "Enter opens the menu");
  const first = element.querySelector('[data-new-work-kind="document"]') as Element;
  await press(first, "ArrowDown");
  const options = [...element.querySelectorAll('[role="menuitem"]')];
  assert.equal(options[1]?.getAttribute("tabindex"), "0", "ArrowDown moves to Presentation");
  await press(options[1] as Element, "Enter");
  // Buttons fire click on Enter natively in browsers; linkedom needs the
  // explicit click, mirroring the mouse path after keyboard focus moves.
  await click(options[1]);
  assert.deepEqual(seen, ["presentation"]);
  await press(trigger, "Enter");
  const reopened = element.querySelector('[data-new-work-kind="document"]') as Element;
  await press(reopened, "Escape");
  assert.equal(element.querySelector(".new-work-panel"), null, "Escape closes the menu");
  await act(async () => {
    root.unmount();
  });
});

test("new work menu mount helper replaces the host button", async () => {
  const seen: string[] = [];
  const { document } = parseHTML(
    "<html><body><div id=\"actions\"><button id=\"new-work\">＋ New work</button></div></body></html>",
  );
  const view = (document as unknown as { defaultView?: unknown }).defaultView;
  (globalThis as Record<string, unknown>)["window"] = view ?? { document };
  (globalThis as Record<string, unknown>)["document"] = document;
  const host = document.getElementById("actions") as unknown as HTMLElement;
  const handle = mountNewWorkMenu(host, { onSelect: (kind) => seen.push(kind) });
  assert.equal(host.querySelector("#new-work"), null, "old button is gone");
  const trigger = host.querySelector(".new-work-trigger") as unknown as HTMLButtonElement;
  assert.notEqual(trigger, null);
  handle.setDisabled(true);
  assert.equal((host.querySelector(".new-work-trigger") as unknown as HTMLButtonElement).disabled, true);
  handle.setDisabled(false);
  await click(host.querySelector(".new-work-trigger"));
  await click(host.querySelector('[data-new-work-kind="presentation"]'));
  assert.deepEqual(seen, ["presentation"]);
  handle.unmount();
  assert.equal(host.childElementCount, 0);
});

test("palette opens through the shell control and quick-open navigates", async () => {
  const host: ElefHost = typedHost();
  const { cafe } = await seed(host);
  const ran: string[] = [];
  const seen: unknown[] = [];
  const options: ElefMountOptions = {
    navigate: (target) => seen.push(target),
    palette: paletteSeam(ran),
  };
  const { element, shell } = await mountInto(host, options);
  try {
    assert.equal(element.querySelector(".command-palette"), null, "palette starts closed");
    shell.openPalette("search");
    await settled();
    const palette = element.querySelector(".command-palette");
    assert.notEqual(palette, null, "shell control opens the palette");
    assert.match(palette?.querySelector("h2")?.textContent ?? "", /Search works/);
    await setInputValue(palette?.querySelector(".command-palette-panel > input"), "café");
    assert.deepEqual(optionLabels(element), ["Café Work"]);
    await press(palette?.querySelector(".command-palette-panel > input") as Element, "Enter");
    assert.deepEqual(seen, [{ workId: cafe.id, kind: "presentation" }]);
    assert.equal(element.querySelector(".command-palette"), null, "choosing closes the palette");
    assert.deepEqual(ran, []);
  } finally {
    shell.unmount();
  }
});

test("palette commands mode filters and runs through the keyboard", async () => {
  const host: ElefHost = typedHost();
  await seed(host);
  const ran: string[] = [];
  const { element, shell } = await mountInto(host, { palette: paletteSeam(ran) });
  try {
    shell.openPalette("commands");
    await settled();
    assert.deepEqual(optionLabels(element), ["New presentation", "New document"]);
    const input = element.querySelector(".command-palette-panel > input") as Element;
    await setInputValue(input, "document");
    assert.deepEqual(optionLabels(element), ["New document"]);
    await press(input, "Enter");
    assert.deepEqual(ran, ["new-document"]);
    assert.equal(element.querySelector(".command-palette"), null);
    shell.openPalette("commands");
    await settled();
    const reopened = element.querySelector(".command-palette-panel > input") as Element;
    await press(reopened, "Escape");
    await settled();
    assert.equal(element.querySelector(".command-palette"), null, "Escape closes the palette");
  } finally {
    shell.unmount();
  }
});

test("palette mode toggle switches between commands and search", async () => {
  const host: ElefHost = typedHost();
  await seed(host);
  const ran: string[] = [];
  const { element, shell } = await mountInto(host, { palette: paletteSeam(ran) });
  try {
    shell.openPalette("commands");
    await settled();
    const toggle = [...element.querySelectorAll(".command-palette-filters button")].find(
      (button) => button.textContent?.trim() === "Search works",
    );
    assert.notEqual(toggle, null);
    await click(toggle);
    assert.match(element.querySelector(".command-palette h2")?.textContent ?? "", /Search works/);
    assert.deepEqual(optionLabels(element), ["Alpha doc", "Café Work"]);
  } finally {
    shell.unmount();
  }
});

test("no palette surface without the seam", async () => {
  const host: ElefHost = typedHost();
  await seed(host);
  const { element, shell } = await mountInto(host);
  try {
    shell.openPalette("commands");
    await settled();
    assert.equal(element.querySelector(".command-palette"), null);
  } finally {
    shell.unmount();
  }
});
