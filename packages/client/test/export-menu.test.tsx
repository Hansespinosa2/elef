import { test } from "node:test";
import assert from "node:assert/strict";
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { parseHTML } from "linkedom";

import {
  ExportMenu,
  exportMenuOptionsFor,
  mountExportMenu,
} from "../src/features/export/ExportMenu.js";
import type { ExportMenuEditionSeams } from "../src/features/export/ExportMenu.js";

(globalThis as Record<string, unknown>)["IS_REACT_ACT_ENVIRONMENT"] = true;

function testDocument() {
  const { document } = parseHTML("<html><body><div id=\"app\"></div></body></html>");
  const view = (document as unknown as { defaultView?: unknown }).defaultView;
  (globalThis as Record<string, unknown>)["window"] = view ?? { document };
  (globalThis as Record<string, unknown>)["document"] = document;
  if ((globalThis as Record<string, unknown>)["navigator"] === undefined) {
    (globalThis as Record<string, unknown>)["navigator"] = { userAgent: "node" };
  }
  return document as unknown as Document;
}

function draftSeams(overrides: Partial<ExportMenuEditionSeams> = {}): ExportMenuEditionSeams {
  return {
    edition: "draft",
    onPrint: () => {},
    onExportPptx: () => {},
    printOptionId: "print-work",
    pptxOptionId: "export-pptx",
    ...overrides,
  };
}

test("draft-only presentation offers Print / Save PDF plus Download PPTX", () => {
  const options = exportMenuOptionsFor({ kind: "presentation", editions: [draftSeams()] });
  assert.deepEqual(
    options.map((option) => [option.format, option.label, option.id]),
    [
      ["print", "Print / Save PDF", "print-work"],
      ["pptx", "Download PPTX", "export-pptx"],
    ],
  );
});

test("draft plus published editions qualify every label", () => {
  const options = exportMenuOptionsFor({
    kind: "presentation",
    editions: [
      draftSeams(),
      {
        edition: "published",
        printHref: "/presentations/1/print?version=published",
        onExportPptx: () => {},
        printOptionId: "print-published",
        pptxOptionId: "pptx-published",
      },
    ],
  });
  assert.deepEqual(
    options.map((option) => option.label),
    ["Print draft / save PDF", "Download PPTX draft", "Print published release", "Download published PPTX"],
  );
  assert.equal(options[2]?.href, "/presentations/1/print?version=published");
});

test("documents never offer PPTX even when a seam is passed", () => {
  const options = exportMenuOptionsFor({ kind: "document", editions: [draftSeams()] });
  assert.deepEqual(
    options.map((option) => [option.format, option.label]),
    [["print", "Print / Save PDF"]],
  );
});

test("editions without delivery contribute no options", () => {
  const options = exportMenuOptionsFor({
    kind: "presentation",
    editions: [draftSeams({ onPrint: null, printHref: null, onExportPptx: null })],
  });
  assert.deepEqual(options, []);
});

test("menu activation runs the seam and closes the menu", async () => {
  const document = testDocument();
  const seen: Array<string> = [];
  const options = exportMenuOptionsFor({
    kind: "presentation",
    editions: [
      draftSeams({
        onPrint: () => void seen.push("print"),
        onExportPptx: () => void seen.push("pptx"),
      }),
    ],
  });
  const container = document.getElementById("app") as unknown as Element;
  let root: ReturnType<typeof createRoot> | undefined;
  await act(async () => {
    root = createRoot(container);
    root.render(
      createElement(ExportMenu, {
        menuId: "export-menu",
        buttonId: "export-menu-button",
        menuLabel: "Export",
        statusId: "export-status",
        options,
      }),
    );
  });
  try {
    const menu = document.getElementById("export-menu") as unknown as HTMLDetailsElement;
    assert.ok(menu, "menu renders");
    menu.open = true;
    const pptx = document.getElementById("export-pptx") as unknown as HTMLButtonElement;
    assert.equal(pptx?.textContent, "Download PPTX");
    await act(async () => {
      pptx.click();
    });
    assert.deepEqual(seen, ["pptx"]);
    assert.equal(menu.open, false, "menu closes on activation");
    assert.ok(document.getElementById("export-status"), "status region renders");
  } finally {
    await act(async () => {
      root?.unmount();
    });
  }
});

test("print href options render as anchors", async () => {
  const document = testDocument();
  const options = exportMenuOptionsFor({
    kind: "document",
    editions: [draftSeams({ edition: "draft", printHref: "/documents/1/print", onPrint: null, onExportPptx: null })],
  });
  const container = document.getElementById("app") as unknown as Element;
  let root: ReturnType<typeof createRoot> | undefined;
  await act(async () => {
    root = createRoot(container);
    root.render(
      createElement(ExportMenu, {
        menuId: "export-menu",
        buttonId: "export-menu-button",
        menuLabel: "Export",
        statusId: "export-status",
        options,
      }),
    );
  });
  try {
    const anchor = document.getElementById("print-work") as unknown as HTMLAnchorElement;
    assert.equal(anchor?.tagName, "A");
    assert.equal(anchor?.getAttribute("href"), "/documents/1/print");
  } finally {
    await act(async () => {
      root?.unmount();
    });
  }
});

test("mountExportMenu update swaps options as the open Work changes", async () => {
  const document = testDocument();
  const container = document.getElementById("app") as unknown as Element;
  const base = {
    menuId: "export-menu",
    buttonId: "export-menu-button",
    menuLabel: "Export",
    statusId: "export-status",
  };
  let handle: ReturnType<typeof mountExportMenu> | undefined;
  await act(async () => {
    handle = mountExportMenu(
      container,
      { ...base, options: exportMenuOptionsFor({ kind: "document", editions: [draftSeams({ onExportPptx: null })] }) },
    );
  });
  try {
    assert.equal(document.getElementById("export-pptx"), null, "no PPTX option for documents");
    await act(async () => {
      handle?.update({
        ...base,
        options: exportMenuOptionsFor({ kind: "presentation", editions: [draftSeams()] }),
      });
    });
    assert.equal(document.getElementById("export-pptx")?.textContent, "Download PPTX");
  } finally {
    await act(async () => {
      handle?.unmount();
    });
  }
  assert.equal(document.getElementById("export-menu"), null, "unmount removes the menu");
});

test("empty options render no menu", async () => {
  const document = testDocument();
  const container = document.getElementById("app") as unknown as Element;
  let root: ReturnType<typeof createRoot> | undefined;
  await act(async () => {
    root = createRoot(container);
    root.render(
      createElement(ExportMenu, {
        menuId: "export-menu",
        buttonId: "export-menu-button",
        menuLabel: "Export",
        statusId: "export-status",
        options: [],
      }),
    );
  });
  try {
    assert.equal(document.getElementById("export-menu"), null, "no trigger without options");
  } finally {
    await act(async () => {
      root?.unmount();
    });
  }
});
