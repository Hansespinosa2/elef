import { test } from "node:test";
import assert from "node:assert/strict";
import { parseHTML } from "linkedom";

import {
  DocumentEditor,
  type DocumentEditorDeps,
} from "../src/features/document/document_editor.js";

function mountDocument(mode = "visual") {
  const { document } = parseHTML(
    `<div id="host" data-editor-mode="${mode}"><div id="projection">` +
      `<div class="document-editor-block" data-editor-block-id="b1">One</div>` +
      `<div class="document-editor-block" data-editor-block-id="b2">Two</div>` +
      `</div></div>`,
  );
  const host = document.querySelector("#host") as unknown as HTMLElement;
  const projection = document.querySelector("#projection") as unknown as Element;
  const calls: Array<{ block: unknown; editable: boolean }> = [];
  const deps = {
    setProjectionBlockEditable: (block: unknown, editable: boolean) => {
      calls.push({ block, editable });
    },
  } as unknown as DocumentEditorDeps;
  const editor = new DocumentEditor({ element: host, projection, deps });
  return { editor, host, projection, calls };
}

function withActiveElement(activeElement: unknown, run: () => void) {
  // focusedProjectionBlock reads the global document; linkedom elements
  // supply closest/contains while the stub supplies the focused element.
  const previous = Object.getOwnPropertyDescriptor(globalThis, "document");
  Object.defineProperty(globalThis, "document", {
    configurable: true,
    writable: true,
    value: { activeElement },
  });
  try {
    run();
  } finally {
    if (previous) Object.defineProperty(globalThis, "document", previous);
    else delete (globalThis as Record<string, unknown>).document;
  }
}

test("document editor stale sync touches only the focused block", () => {
  // T1: while a projection block holds DOM focus, preview-stale must not
  // re-sweep every block (measured 400-850ms on 100-page fixtures); only
  // the focused block's editability is observable until blur reinstalls.
  const { editor, host, projection, calls } = mountDocument();
  (host as unknown as { previewController?: unknown }).previewController = { projectionFresh: false };
  const second = (projection as unknown as Element).querySelector('[data-editor-block-id="b2"]');

  withActiveElement(second, () => editor.previewStale({ preserveActive: true }));

  assert.equal(calls.length, 1);
  assert.equal(calls[0]?.block, second);
  assert.equal(calls[0]?.editable, true);
});

test("document editor stale sync still sweeps without a focused block", () => {
  const { editor, host, calls } = mountDocument();
  (host as unknown as { previewController?: unknown }).previewController = { projectionFresh: false };

  withActiveElement(null, () => editor.previewStale({}));

  assert.equal(calls.length, 2);
  assert.ok(calls.every((call) => call.editable === false));
});

test("document editor stale sync still sweeps in source mode", () => {
  const { editor, host, projection, calls } = mountDocument("source");
  const second = (projection as unknown as Element).querySelector('[data-editor-block-id="b2"]');

  withActiveElement(second, () => editor.previewStale({ preserveActive: true }));

  assert.equal(calls.length, 2);
  assert.ok(calls.every((call) => call.editable === false));
});
