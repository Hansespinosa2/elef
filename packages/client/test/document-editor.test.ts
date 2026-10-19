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

test("document leaves assist-consumed keys out of block handling", () => {
  const { editor, projection } = mountDocument();
  const block = projection.querySelector("[data-editor-block-id]");
  let mathKeys = 0;
  editor.deps.handleMathKeydown = () => { mathKeys += 1; return false; };
  editor.deps.moveCaretBetweenBlocks = () => false;
  editor.blockKeydown({
    key: "Tab", target: block, defaultPrevented: true,
    isComposing: false, altKey: false, ctrlKey: false, metaKey: false, shiftKey: false,
    preventDefault() {},
  });
  assert.equal(mathKeys, 0);
});

test("document cross-block beforeinput commits one source edit and releases stale projection focus", () => {
  const { editor, projection } = mountDocument();
  const blocks = [...projection.querySelectorAll<HTMLElement>("[data-editor-block-id]")];
  const first = blocks[0]; const second = blocks[1];
  assert.ok(first && second);
  for (const block of blocks) block.setAttribute("contenteditable", "true");
  Object.defineProperty(first, "contentEditable", { value: "true" });
  let blurred = 0; first.blur = () => { blurred++; };
  let value = "One\n\nTwo";
  let flushed = false;
  const changes: unknown[] = [];
  editor.readyEditor = {
    get value() { return value; },
    replaceRange(insert: string, from: number, to: number) {
      assert.equal(flushed, true, "prior typing must commit before the selected range resolves");
      changes.push({ insert, from, to }); value = value.slice(0, from) + insert + value.slice(to);
    },
  } as unknown as NonNullable<typeof editor.editorController>;
  editor.map = { editable_regions: [
    { id: "r1", block_id: "b1", kind: "paragraph", editable: true, content_range: { start: 0, end: 3 } },
    { id: "r2", block_id: "b2", kind: "paragraph", editable: true, content_range: { start: 5, end: 8 } },
  ] };
  editor.pendingProjectionEdits = new Map([["r1", {
    from: 0, to: 3, source: "One", kind: "paragraph", blockId: "b1", blockElement: first,
  }]]);
  editor.flushPendingProjectionEdits = () => { flushed = true; editor.pendingProjectionEdits?.clear(); };
  editor.visibleOffsetInBlockGroup = (_block, _node, offset) => offset;
  editor.combinedBlockForId = id => blocks.find(block => block.dataset.editorBlockId === id) ?? null;
  const previous = Object.getOwnPropertyDescriptor(globalThis, "window");
  Object.defineProperty(globalThis, "window", { configurable: true, value: { getSelection: () => ({
    isCollapsed: false, anchorNode: second.firstChild, anchorOffset: 2, focusNode: first.firstChild, focusOffset: 1,
  }) } });
  let prevented = false;
  try {
    withActiveElement(first, () => editor.projectionBeforeinput({
      target: first, inputType: "deleteContentBackward", preventDefault() { prevented = true; },
    }));
    assert.equal(prevented, true);
    assert.equal(value, "Oo");
    assert.deepEqual(changes, [{ insert: "", from: 1, to: 7 }]);
    assert.deepEqual(editor.pendingCaretRestore, { sourceOffset: 1, preferredBlockId: null });
    assert.equal(blurred, 1);
  } finally {
    if (previous) Object.defineProperty(globalThis, "window", previous);
    else delete (globalThis as Record<string, unknown>).window;
  }
});

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

function fakeSelectionRoot(existing: { remove(): void } | null = null) {
  const appended: Array<{ className: string; children: unknown[] }> = [];
  const root = {
    ownerDocument: {
      createRange: () => ({
        setStart() {},
        setEnd() {},
        getClientRects: () => [{ left: 0, top: 0, width: 5, height: 10 }],
      }),
      createElement: () => {
        const children: unknown[] = [];
        return {
          className: "",
          style: { cssText: "" },
          children,
          setAttribute() {},
          append: (child: unknown) => {
            children.push(child);
          },
        };
      },
    },
    querySelector: () => existing,
    append: (child: { className: string; children: unknown[] }) => {
      appended.push(child);
    },
  };
  return { root: root as unknown as Element, appended };
}

function stubSelectionPoints(editor: DocumentEditor, mapped: number[]) {
  editor.selectionPointForSourceOffset = (offset: number) => {
    mapped.push(offset);
    return {
      element: {} as unknown as HTMLElement,
      node: { offset } as unknown as Node,
      offset,
      visibleOffset: offset,
      blockId: "b1",
    };
  };
}

test("document restoreSelections paints every engine range through the caret point machinery", () => {
  const { editor } = mountDocument();
  const { root, appended } = fakeSelectionRoot();
  editor.projection = root;
  editor.readyEditor = {
    selectionRanges: [{ anchor: 0, head: 3 }, { anchor: 8, head: 5 }],
  } as unknown as NonNullable<typeof editor.editorController>;
  const mapped: number[] = [];
  stubSelectionPoints(editor, mapped);

  editor.restoreSelections();

  assert.deepEqual(mapped, [0, 3, 8, 5]);
  assert.equal(appended.length, 1);
  assert.equal(appended[0]?.className, "elef-projection-selections");
  assert.equal(appended[0]?.children.length, 2);
});

test("document restoreSelections clears the stale layer for a single range", () => {
  const { editor } = mountDocument();
  let removed = 0;
  const { root, appended } = fakeSelectionRoot({ remove: () => { removed += 1; } });
  editor.projection = root;
  editor.readyEditor = {
    selectionRanges: [{ anchor: 2, head: 2 }],
  } as unknown as NonNullable<typeof editor.editorController>;
  const mapped: number[] = [];
  stubSelectionPoints(editor, mapped);

  editor.restoreSelections();

  assert.equal(removed, 1);
  assert.equal(appended.length, 0);
  assert.deepEqual(mapped, []);
});

test("document restoreSelections clears without mapping in source mode", () => {
  const { editor } = mountDocument("source");
  let removed = 0;
  const { root, appended } = fakeSelectionRoot({ remove: () => { removed += 1; } });
  editor.projection = root;
  editor.readyEditor = {
    selectionRanges: [{ anchor: 0, head: 3 }, { anchor: 5, head: 8 }],
  } as unknown as NonNullable<typeof editor.editorController>;
  editor.selectionPointForSourceOffset = () => {
    throw new Error("source mode must not map selection points");
  };

  editor.restoreSelections();

  assert.equal(removed, 1);
  assert.equal(appended.length, 0);
});

test("document restoreSelections tolerates a missing projection or editor", () => {
  const { editor } = mountDocument();
  editor.projection = null;
  editor.readyEditor = {
    selectionRanges: [{ anchor: 0, head: 3 }, { anchor: 5, head: 8 }],
  } as unknown as NonNullable<typeof editor.editorController>;
  assert.doesNotThrow(() => editor.restoreSelections());

  const { editor: unbound } = mountDocument();
  assert.doesNotThrow(() => unbound.restoreSelections());

  const { root } = fakeSelectionRoot();
  const elementless = new DocumentEditor({ projection: root, deps: {} as unknown as DocumentEditorDeps });
  elementless.readyEditor = {
    selectionRanges: [{ anchor: 0, head: 3 }, { anchor: 5, head: 8 }],
  } as unknown as NonNullable<typeof elementless.editorController>;
  assert.doesNotThrow(() => elementless.restoreSelections());
});
