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

test("fragmented table input commits native edits only after input, including composition and edge spaces", () => {
  const { document, Node: DomNode } = parseHTML(`<main id="host"><div id="projection">
    <div data-editor-block-id="table"><table><thead><tr><th>H</th></tr></thead><tbody><tr><td>one</td></tr></tbody></table></div>
    <div data-editor-block-id="table"><table><thead><tr><th>H</th></tr></thead><tbody><tr><td>two</td></tr></tbody></table></div>
  </div></main>`);
  const host = document.querySelector("#host")!;
  const projection = document.querySelector("#projection")!;
  const blocks = [...projection.querySelectorAll<HTMLElement>("[data-editor-block-id]")];
  const block = blocks[1]!;
  Object.defineProperty(block, "contentEditable", { value: "true" });
  const cell = block.querySelector("td")!;
  let value = "| H |\n| --- |\n| one |\n| two |";
  const editor = new DocumentEditor({ element: host, projection, deps: {} as DocumentEditorDeps });
  const region = { id: "r", block_id: "table", kind: "table", editable: true, content_range: { start: 0, end: value.length } };
  editor.map = { editable_regions: [region] };
  editor.readyEditor = { get value() { return value; }, replaceRange(insert: string, from: number, to: number) {
    value = value.slice(0, from) + insert + value.slice(to);
  } } as unknown as NonNullable<typeof editor.editorController>;
  editor.shiftMapAfterEdit = (_from, _to, length) => { region.content_range.end += length; };
  editor.blockFragments = () => blocks;
  editor.restoreCaret = () => true;
  const oldWindow = Object.getOwnPropertyDescriptor(globalThis, "window");
  const oldNode = Object.getOwnPropertyDescriptor(globalThis, "Node");
  let selectionNode = () => cell.firstChild;
  Object.defineProperty(globalThis, "Node", { configurable: true, value: DomNode });
  Object.defineProperty(globalThis, "window", { configurable: true, value: { getSelection: () => ({
    isCollapsed: true, anchorNode: selectionNode(), focusNode: selectionNode(),
    anchorOffset: cell.textContent!.length, focusOffset: cell.textContent!.length,
  }) } });
  const before = (inputType: string, cancelable = true, data?: string | null, dataTransfer?: { types: string[]; getData(type: string): string }) => {
    let prevented = false;
    editor.projectionBeforeinput({ target: block, inputType, cancelable, data, dataTransfer, preventDefault() { prevented = true; } });
    return prevented;
  };
  try {
    before("insertText"); // An externally cancelled event has no input.
    assert.equal(value, "| H |\n| --- |\n| one |\n| two |");
    before("insertText"); cell.textContent = "two ";
    editor.projectionInput({ target: block, preventDefault() {} });
    assert.match(value, /\| two  \|$/);
    before("insertCompositionText", false); cell.textContent = "two 字";
    editor.projectionInput({ target: block, preventDefault() {} });
    assert.match(value, /\| two 字 \|$/);
    value = value.replace("two 字", "**two 字**");
    region.content_range.end = value.length;
    cell.innerHTML = "<strong>two 字</strong>";
    selectionNode = () => cell.firstElementChild!.firstChild;
    before("insertCompositionText", false);
    cell.firstElementChild!.textContent = "two 字文";
    editor.projectionInput({ target: block, preventDefault() {} });
    assert.match(value, /\| \*\*two 字文\*\* \|$/);
    let refreshed = false;
    (host as any).previewController = { refreshNow() { refreshed = true; } };
    assert.equal(before("insertFromPaste", true, "", { types: ["text/plain"], getData: () => "bad|pipe" }), true);
    before("insertCompositionText", false);
    cell.firstElementChild!.textContent = "two 字文|";
    editor.projectionInput({ target: block, preventDefault() {} });
    assert.equal(refreshed, false);
    assert.equal(cell.textContent, "two 字文");
    assert.match(value, /\| \*\*two 字文\*\* \|$/);
  } finally {
    if (oldWindow) Object.defineProperty(globalThis, "window", oldWindow); else delete (globalThis as Record<string, unknown>).window;
    if (oldNode) Object.defineProperty(globalThis, "Node", oldNode); else delete (globalThis as Record<string, unknown>).Node;
  }
});

test("fragmented table key routing refuses an unmappable caret and rolls back unmappable motion", () => {
  const { editor, projection } = mountDocument();
  const block = projection.querySelector<HTMLElement>("[data-editor-block-id]")!;
  block.innerHTML = "<table></table>";
  editor.blockFragments = () => [block, block];
  let head = 4, prevented = false, called = false;
  editor.readyEditor = {
    value: "source", get selectionStart() { return head; }, get selectionEnd() { return head; },
    get selectionHead() { return head; }, vimEnabled: true, insertMode: false,
    setSelectionRange(_anchor: number, next: number) { head = next; },
  } as unknown as NonNullable<typeof editor.editorController>;
  const event = { key: "h", target: block, defaultPrevented: false, isComposing: false,
    altKey: false, ctrlKey: false, metaKey: false, shiftKey: false, preventDefault() { prevented = true; } };
  editor.captureCaret = () => null;
  assert.equal(editor.routeTableSafeKey(event, block, () => { called = true; return true; }), true);
  assert.equal(prevented, true);
  assert.equal(called, false);
  editor.captureCaret = () => ({ blockId: "b1", sourceOffset: 4 });
  editor.selectionPointForSourceOffset = () => null;
  editor.restoreCaret = () => true;
  editor.routeTableSafeKey(event, block, () => { head = 3; return true; });
  assert.equal(head, 4);
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

test("projection caret syncs reveal state once per block visit", () => {
  // Holding j/arrows fires selectionchange per step; the math/inline syncs
  // scan the whole projection, so repeats inside the same block and span
  // must not re-sync. Any block or span change re-syncs fully.
  const { editor, projection } = mountDocument();
  const blocks = [...projection.querySelectorAll("[data-editor-block-id]")];
  const first = blocks[0]; const second = blocks[1];
  assert.ok(first && second);
  let mathSyncs = 0; let inlineSyncs = 0;
  editor.deps.syncActiveMath = () => { mathSyncs += 1; };
  editor.deps.syncActiveInline = () => { inlineSyncs += 1; };
  editor.deps.visibleOffsetAtPoint = () => 1;
  let focus = { node: first.firstChild as unknown, offset: 0 };
  const previousNode = Object.getOwnPropertyDescriptor(globalThis, "Node");
  Object.defineProperty(globalThis, "Node", { configurable: true, writable: true, value: { ELEMENT_NODE: 1, TEXT_NODE: 3 } });
  const previousCss = Object.getOwnPropertyDescriptor(globalThis, "CSS");
  Object.defineProperty(globalThis, "CSS", { configurable: true, writable: true, value: { escape: (value: string) => value } });
  const previous = Object.getOwnPropertyDescriptor(globalThis, "window");
  Object.defineProperty(globalThis, "window", { configurable: true, value: { getSelection: () => ({
    isCollapsed: true, anchorNode: focus.node, anchorOffset: focus.offset,
    focusNode: focus.node, focusOffset: focus.offset,
  }) } });
  try {
    editor.rememberProjectionCaret();
    assert.equal(mathSyncs, 1);
    assert.equal(inlineSyncs, 1);
    // Same block, different offset: no re-sync.
    focus = { node: first.firstChild as unknown, offset: 2 };
    editor.rememberProjectionCaret();
    assert.equal(mathSyncs, 1);
    assert.equal(inlineSyncs, 1);
    // Entering unrevealed syntax in the same block: re-sync. The revealable
    // construct exists before activation swaps it, so the key must notice
    // the ancestor even though no active span exists yet.
    first.innerHTML = `O<em>ne</em>`;
    const emText = first.querySelector("em")?.firstChild;
    assert.ok(emText);
    focus = { node: emText as unknown, offset: 0 };
    editor.rememberProjectionCaret();
    assert.equal(mathSyncs, 2);
    assert.equal(inlineSyncs, 2);
    // Entering an active span in the same block: re-sync.
    first.innerHTML = `O<span class="editor-math-active">ne</span>`;
    const spanText = first.querySelector(".editor-math-active")?.firstChild;
    assert.ok(spanText);
    focus = { node: spanText as unknown, offset: 0 };
    editor.rememberProjectionCaret();
    assert.equal(mathSyncs, 3);
    assert.equal(inlineSyncs, 3);
    // Same span again: no re-sync.
    editor.rememberProjectionCaret();
    assert.equal(mathSyncs, 3);
    assert.equal(inlineSyncs, 3);
    // Different block: re-sync.
    focus = { node: second.firstChild as unknown, offset: 0 };
    editor.rememberProjectionCaret();
    assert.equal(mathSyncs, 4);
    assert.equal(inlineSyncs, 4);
  } finally {
    if (previous) Object.defineProperty(globalThis, "window", previous);
    else delete (globalThis as Record<string, unknown>).window;
    if (previousNode) Object.defineProperty(globalThis, "Node", previousNode);
    else delete (globalThis as Record<string, unknown>).Node;
    if (previousCss) Object.defineProperty(globalThis, "CSS", previousCss);
    else delete (globalThis as Record<string, unknown>).CSS;
  }
  assert.deepEqual(editor.lastProjectionCaret, { blockId: "b2", visibleOffset: 1 });
});

test("a superseded pending caret drops instead of teleporting", () => {
  // A failed restore (block not yet in the map) stays armed for its own
  // reinstall, but once a newer transaction rewrites the source the entry
  // must drop: otherwise it fires on an unrelated update and yanks the
  // caret to a stale offset.
  const { editor } = mountDocument();
  let value = "One\n\nTwo";
  editor.readyEditor = {
    get value() { return value; },
  } as unknown as NonNullable<typeof editor.editorController>;
  editor.pendingCaret = { sourceOffset: 2, location: "block_end", sourceLength: 8 };
  editor.map = { slides: [{ blocks: [] }] } as unknown as typeof editor.map;
  editor.restorePendingCaret();
  assert.notEqual(editor.pendingCaret, null);
  value = "One\n\nTwo!";
  editor.restorePendingCaret();
  assert.equal(editor.pendingCaret, null);
});

test("structural edits request an immediate preview refresh", () => {
  // Enter splits must not wait out the typing debounce (each following
  // keystroke resets it, pushing the consequence back indefinitely).
  const { editor, host, projection } = mountDocument();
  const block = projection.querySelector("[data-editor-block-id]");
  assert.ok(block);
  (block as unknown as { blur?: () => void }).blur = () => {};
  let refreshed = 0;
  (host as unknown as { previewController?: unknown }).previewController = { refreshNow: () => { refreshed += 1; } };
  let value = "One";
  editor.readyEditor = {
    get value() { return value; },
    replaceRange(insert: string, from: number, to: number) {
      value = value.slice(0, from) + insert + value.slice(to);
    },
  } as unknown as NonNullable<typeof editor.editorController>;
  editor.replaceAndFocus(block as unknown as Element, 0, 3, "One\n\n", { sourceOffset: 5, location: "empty_block" });
  assert.equal(refreshed, 1);
  assert.deepEqual(editor.pendingCaret, { sourceOffset: 5, location: "empty_block", sourceLength: 5 });
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

test("intra-block caret steps skip repeated reveal syncs (measured)", () => {
  // Holding a navigation key fires rememberProjectionCaret per step. Each
  // math/inline sync scans the whole projection (the stubs below run one
  // full-projection query pass per sync, mirroring the real syncs' scan),
  // so the throttle key must collapse N intra-block steps into one sync
  // pair. Counts are asserted (deterministic); wall ms is measured and
  // printed for the PR evidence — the unthrottled loop replays the pre-fix
  // shape (sync on every step) by clearing the throttle key each step.
  const { editor, projection } = mountDocument();
  const doc = (projection as unknown as { ownerDocument: Document }).ownerDocument;
  for (let i = 3; i <= 50; i += 1) {
    const block = doc.createElement("div");
    block.setAttribute("class", "document-editor-block");
    block.setAttribute("data-editor-block-id", `b${i}`);
    block.textContent = `Block ${i} with `;
    const math = doc.createElement("span");
    math.setAttribute("data-editor-math-source", `x^${i}`);
    math.textContent = `x^${i}`;
    block.appendChild(math);
    (projection as unknown as { appendChild(node: unknown): void }).appendChild(block);
  }
  const first = projection.querySelector("[data-editor-block-id='b1']");
  assert.ok(first);
  let mathSyncs = 0; let inlineSyncs = 0;
  editor.deps.syncActiveMath = () => {
    mathSyncs += 1;
    projection.querySelectorAll("[data-editor-math-source], .editor-math-active");
  };
  editor.deps.syncActiveInline = () => {
    inlineSyncs += 1;
    projection.querySelectorAll("em, strong, del, s, code, a");
  };
  editor.deps.visibleOffsetAtPoint = () => 1;
  const focus = { node: first.firstChild as unknown, offset: 0 };
  const previousNode = Object.getOwnPropertyDescriptor(globalThis, "Node");
  Object.defineProperty(globalThis, "Node", { configurable: true, writable: true, value: { ELEMENT_NODE: 1, TEXT_NODE: 3 } });
  const previousCss = Object.getOwnPropertyDescriptor(globalThis, "CSS");
  Object.defineProperty(globalThis, "CSS", { configurable: true, writable: true, value: { escape: (value: string) => value } });
  const previous = Object.getOwnPropertyDescriptor(globalThis, "window");
  Object.defineProperty(globalThis, "window", { configurable: true, value: { getSelection: () => ({
    isCollapsed: true, anchorNode: focus.node, anchorOffset: focus.offset,
    focusNode: focus.node, focusOffset: focus.offset,
  }) } });
  const STEPS = 200;
  try {
    focus.offset = 0;
    const throttledStart = performance.now();
    for (let i = 0; i < STEPS; i += 1) {
      focus.offset = i % 3;
      editor.rememberProjectionCaret();
    }
    const throttledMs = performance.now() - throttledStart;
    const throttledMath = mathSyncs; const throttledInline = inlineSyncs;
    assert.equal(throttledMath, 1);
    assert.equal(throttledInline, 1);
    mathSyncs = 0; inlineSyncs = 0;
    const unthrottledStart = performance.now();
    for (let i = 0; i < STEPS; i += 1) {
      focus.offset = i % 3;
      editor.lastRevealSyncBlockId = null;
      editor.lastRevealSyncSpan = null;
      editor.rememberProjectionCaret();
    }
    const unthrottledMs = performance.now() - unthrottledStart;
    assert.equal(mathSyncs, STEPS);
    assert.equal(inlineSyncs, STEPS);
    console.log(
      `[perf] intra-block caret x${STEPS} over 50 blocks: ` +
      `throttled ${throttledMath}/${throttledInline} math/inline syncs in ${throttledMs.toFixed(2)}ms ` +
      `vs unthrottled ${mathSyncs}/${inlineSyncs} syncs in ${unthrottledMs.toFixed(2)}ms`,
    );
  } finally {
    if (previous) Object.defineProperty(globalThis, "window", previous);
    else delete (globalThis as Record<string, unknown>).window;
    if (previousNode) Object.defineProperty(globalThis, "Node", previousNode);
    else delete (globalThis as Record<string, unknown>).Node;
    if (previousCss) Object.defineProperty(globalThis, "CSS", previousCss);
    else delete (globalThis as Record<string, unknown>).CSS;
  }
});

test("gap offsets on a concealed marker resolve to the following block", () => {
  // A Vim w landing on block 2's concealed "#" marker (engine offset 10
  // in "# One two\n# Three four") belongs to no region; the old closest
  // fallback stranded it on block 1's end, so the caret never advanced.
  const { editor, projection } = mountDocument();
  const blocks = [...projection.querySelectorAll<HTMLElement>("[data-editor-block-id]")];
  const first = blocks[0]; const second = blocks[1];
  assert.ok(first && second);
  editor.readyEditor = {
    get value() { return "# One two\n# Three four"; },
  } as unknown as NonNullable<typeof editor.editorController>;
  editor.map = { editable_regions: [
    { id: "r1", block_id: "b1", kind: "heading", editable: true, content_range: { start: 2, end: 9 } },
    { id: "r2", block_id: "b2", kind: "heading", editable: true, content_range: { start: 12, end: 22 } },
  ] };
  editor.blockFragments = (blockId) => [blocks.find((block) => block.dataset.editorBlockId === blockId) ?? first as HTMLElement];
  editor.visibleTextLength = () => 3;
  editor.deps.visibleOffsetForSourceOffset = (_source, relative) => Math.max(0, relative);
  editor.deps.pointAtVisibleOffset = (block, offset) => [(block as HTMLElement).firstChild, offset];
  const marker = editor.selectionPointForSourceOffset(10, null);
  assert.equal(marker?.blockId, "b2");
  assert.equal(marker?.offset, 0);
  // End-of-line (offset 9, the previous region's end) still belongs to
  // the first block: only strictly-interior gap offsets move forward.
  const eol = editor.selectionPointForSourceOffset(9, null);
  assert.equal(eol?.blockId, "b1");
});

test("document visual wrapping on an opaque selection prevents default without committing, blurring, or stranding caret restore", () => {
  const { document } = parseHTML(
    `<div id="host" data-editor-mode="visual"><div id="projection">` +
      `<div class="document-editor-block" data-editor-block-id="b1" contenteditable="true">---</div>` +
    `</div></div>`,
  );
  const host = document.querySelector("#host") as unknown as HTMLElement;
  const projection = document.querySelector("#projection") as unknown as Element;
  const block = projection.querySelector<HTMLElement>("[data-editor-block-id='b1']")!;
  Object.defineProperty(block, "contentEditable", { value: "true" });
  let blurred = 0;
  block.blur = () => { blurred += 1; };
  let value = "---";
  let wrapCalls = 0;
  let rangeCalls = 0;
  const editor = new DocumentEditor({
    element: host,
    projection,
    deps: {
      sourceOffsetForVisibleOffset: (_slice: string, offset: number) => offset,
      visibleOffsetAtPoint: (_block: Element, _node: Node | null, offset: number) => offset,
    } as unknown as DocumentEditorDeps,
  });
  editor.readyEditor = {
    get value() { return value; },
    replaceRange() { rangeCalls += 1; },
    replaceRangeWithSelection() { wrapCalls += 1; },
  } as unknown as NonNullable<typeof editor.editorController>;
  editor.map = { editable_regions: [
    { id: "r1", block_id: "b1", kind: "paragraph", editable: true, content_range: { start: 0, end: 3 } },
  ] };
  editor.visibleOffsetInBlockGroup = (_block, _node, offset) => offset;
  editor.combinedBlockForId = () => block;

  const previousWindow = Object.getOwnPropertyDescriptor(globalThis, "window");
  const previousNode = Object.getOwnPropertyDescriptor(globalThis, "Node");
  const previousCss = Object.getOwnPropertyDescriptor(globalThis, "CSS");
  Object.defineProperty(globalThis, "Node", { configurable: true, writable: true, value: { ELEMENT_NODE: 1, TEXT_NODE: 3 } });
  Object.defineProperty(globalThis, "CSS", { configurable: true, writable: true, value: { escape: (candidate: string) => candidate } });
  Object.defineProperty(globalThis, "window", { configurable: true, value: { getSelection: () => ({
    isCollapsed: false, anchorNode: block.firstChild, anchorOffset: 0, focusNode: block.firstChild, focusOffset: 3,
  }) } });
  try {
    for (const data of ["*", "`"]) {
      let prevented = false;
      withActiveElement(block, () => editor.projectionBeforeinput({
        target: block, inputType: "insertText", data, preventDefault() { prevented = true; },
      }));
      assert.equal(prevented, true);
      assert.equal(value, "---");
      assert.equal(wrapCalls, 0);
      assert.equal(rangeCalls, 0);
      assert.equal(blurred, 0);
      assert.equal(editor.pendingCaretRestore, undefined);
    }
  } finally {
    if (previousWindow) Object.defineProperty(globalThis, "window", previousWindow);
    else delete (globalThis as Record<string, unknown>).window;
    if (previousNode) Object.defineProperty(globalThis, "Node", previousNode);
    else delete (globalThis as Record<string, unknown>).Node;
    if (previousCss) Object.defineProperty(globalThis, "CSS", previousCss);
    else delete (globalThis as Record<string, unknown>).CSS;
  }
});

test("document visual wrapping declines code blocks and active display math spans", () => {
  const { document } = parseHTML(
    `<div id="host" data-editor-mode="visual"><div id="projection">` +
      `<div class="document-editor-block" data-editor-block-id="c1" contenteditable="true">const x = 1</div>` +
      `<div class="document-editor-block" data-editor-block-id="m1" contenteditable="true"><span class="editor-math-active editor-live-math-display" data-editor-math-active="true" data-editor-math-source="x + y">$$x + y$$</span></div>` +
    `</div></div>`,
  );
  const host = document.querySelector("#host") as unknown as HTMLElement;
  const projection = document.querySelector("#projection") as unknown as Element;
  const codeBlock = projection.querySelector<HTMLElement>("[data-editor-block-id='c1']")!;
  const mathBlock = projection.querySelector<HTMLElement>("[data-editor-block-id='m1']")!;
  const mathSpan = mathBlock.querySelector(".editor-math-active")!;
  Object.defineProperty(codeBlock, "contentEditable", { value: "true" });
  Object.defineProperty(mathBlock, "contentEditable", { value: "true" });
  let value = "```js\nconst x = 1\n```\n\n$$x + y$$";
  let wrapCalls = 0;
  let blurred = 0;
  codeBlock.blur = () => { blurred += 1; };
  mathBlock.blur = () => { blurred += 1; };
  const editor = new DocumentEditor({
    element: host,
    projection,
    deps: {
      sourceOffsetForVisibleOffset: (_slice: string, offset: number) => offset,
      visibleOffsetAtPoint: (_block: Element, _node: Node | null, offset: number) => offset,
    } as unknown as DocumentEditorDeps,
  });
  editor.readyEditor = {
    get value() { return value; },
    replaceRange() {},
    replaceRangeWithSelection() { wrapCalls += 1; },
  } as unknown as NonNullable<typeof editor.editorController>;
  editor.map = { editable_regions: [
    { id: "r1", block_id: "c1", kind: "code", editable: true, content_range: { start: 0, end: 21 } },
    { id: "r2", block_id: "m1", kind: "paragraph", editable: true, content_range: { start: 23, end: 32 } },
  ] };
  editor.visibleOffsetInBlockGroup = (_block, _node, offset) => offset;
  editor.combinedBlockForId = (id) => (id === "c1" ? codeBlock : mathBlock);

  const previousWindow = Object.getOwnPropertyDescriptor(globalThis, "window");
  const previousNode = Object.getOwnPropertyDescriptor(globalThis, "Node");
  const previousCss = Object.getOwnPropertyDescriptor(globalThis, "CSS");
  Object.defineProperty(globalThis, "Node", { configurable: true, writable: true, value: { ELEMENT_NODE: 1, TEXT_NODE: 3 } });
  Object.defineProperty(globalThis, "CSS", { configurable: true, writable: true, value: { escape: (candidate: string) => candidate } });
  let currentSelection: { anchorNode: Node | null; focusNode: Node | null; anchorOffset: number; focusOffset: number } = {
    anchorNode: codeBlock.firstChild, anchorOffset: 0, focusNode: codeBlock.firstChild, focusOffset: 5,
  };
  Object.defineProperty(globalThis, "window", { configurable: true, value: { getSelection: () => ({
    isCollapsed: false, ...currentSelection,
  }) } });
  try {
    withActiveElement(codeBlock, () => editor.projectionBeforeinput({
      target: codeBlock, inputType: "insertText", data: "*", preventDefault() {},
    }));
    assert.equal(wrapCalls, 0);
    assert.equal(blurred, 0);
    assert.equal(editor.pendingCaretRestore, undefined);

    currentSelection = {
      anchorNode: mathSpan.firstChild, anchorOffset: 2, focusNode: mathSpan.firstChild, focusOffset: 3,
    };
    withActiveElement(mathBlock, () => editor.projectionBeforeinput({
      target: mathBlock, inputType: "insertText", data: "*", preventDefault() {},
    }));
    assert.equal(wrapCalls, 0);
    assert.equal(blurred, 0);
    assert.equal(editor.pendingCaretRestore, undefined);
  } finally {
    if (previousWindow) Object.defineProperty(globalThis, "window", previousWindow);
    else delete (globalThis as Record<string, unknown>).window;
    if (previousNode) Object.defineProperty(globalThis, "Node", previousNode);
    else delete (globalThis as Record<string, unknown>).Node;
    if (previousCss) Object.defineProperty(globalThis, "CSS", previousCss);
    else delete (globalThis as Record<string, unknown>).CSS;
  }
});
