import { test, after } from "node:test";
import assert from "node:assert/strict";
import { parseHTML } from "linkedom";

import {
  mountPresentationEditor,
  PresentationEditor,
} from "../src/features/presentation/editor.js";

// The assist-insert patch reads Node.TEXT_NODE (linkedom provides nodeType
// values but no global Node).
const nodeDescriptor = Object.getOwnPropertyDescriptor(globalThis, "Node");
Object.defineProperty(globalThis, "Node", { configurable: true, writable: true, value: { ELEMENT_NODE: 1, TEXT_NODE: 3 } });
after(() => {
  if (nodeDescriptor) Object.defineProperty(globalThis, "Node", nodeDescriptor);
  else delete (globalThis as Record<string, unknown>).Node;
});


const SOURCE = "# Alpha\n\nFirst\n\n---\n\n# Beta\n\nSecond\n";

function slideRanges() {
  const firstDelim = SOURCE.indexOf("---");
  const secondStart = SOURCE.indexOf("# Beta");
  return { firstDelim, secondStart };
}

interface TestRegion {
  id: string;
  block_id: string;
  kind: string;
  editable: boolean;
  content_range: { start: number; end: number };
}

interface TestBlock {
  id: string;
  range: { start: number; end: number };
  source_range: { start: number; end: number };
  content_range: { start: number; end: number };
  empty_placeholder?: boolean;
}

function testMap() {
  const { firstDelim, secondStart } = slideRanges();
  const block = (id: string, start: number, end: number): TestBlock => ({
    id,
    range: { start, end },
    source_range: { start, end },
    content_range: { start, end },
  });
  // SOURCE layout: "# Alpha"(0..7) "\n\n"(7..9) "First"(9..14) "\n\n"(14..16)
  // "---"(16..19) "\n\n"(19..21) "# Beta"(21..27) "\n\n"(27..29)
  // "Second"(29..35) "\n"(35..36).
  return {
    source_length: SOURCE.length,
    slides: [
      {
        range: { start: 0, end: firstDelim },
        delimiter_range: { start: firstDelim, end: secondStart },
        blocks: [block("b1", 0, 7), block("b2", 9, 14)],
        directives: [],
      },
      {
        range: { start: secondStart, end: SOURCE.length },
        blocks: [block("b3", secondStart, secondStart + 6), block("b4", secondStart + 8, secondStart + 14)],
        directives: [],
      },
    ],
    directives: [],
    editable_regions: [] as TestRegion[],
  };
}

function fakeEditor() {
  const state = {
    value: SOURCE,
    commits: [] as string[],
    ranges: [] as Array<[number, number]>,
    selectionStart: 0,
    selectionEnd: 0,
    selectionHead: 0,
    selectionRangeCount: 1,
    vimEnabled: false,
    insertMode: true,
    editingMode: "visual",
    focusCalls: 0,
    focus() {
      state.focusCalls += 1;
    },
    vimKeys: [] as string[],
    inputTarget: null,
    setSelectionRange(anchor: number, head: number = anchor) {
      state.selectionStart = anchor;
      state.selectionEnd = head;
      state.ranges.push([anchor, head]);
    },
    handleVimKey(event: { key: string }) {
      state.vimKeys.push(event.key);
      return false;
    },
    keymapCalls: [] as string[],
    runKeymap(event: { key: string }) {
      state.keymapCalls.push(event.key);
      return false;
    },
    commitSource(text: string) {
      state.commits.push(text);
      state.value = text;
      return Promise.resolve(true);
    },
    replaceRange(text: string, from: number, to: number) {
      state.value = state.value.slice(0, from) + text + state.value.slice(to);
    },
    replaceRanges(changes: { from: number; to: number; insert: string }[]) {
      [...changes]
        .sort((left, right) => right.from - left.from)
        .forEach((change) => {
          state.value = state.value.slice(0, change.from) + change.insert + state.value.slice(change.to);
        });
    },
  };
  return state;
}

function stubDeps() {
  return {
    moveCaretBetweenBlocks: () => false,
    pointAtVisibleOffset: () => [null, 0],
    removeEmptyBlockSource: (source: string) => source,
    sourceOffsetForVisibleOffset: () => 0,
    visibleOffsetAtPoint: () => 0,
    visibleOffsetForSourceOffset: () => 0,
    markdownForVisibleText: (source: string) => source,
    renderInlineMath: () => {},
    handleMathClick: () => false,
    recordMathMousedown: () => {},
    handleMathKeydown: () => false,
    syncActiveMath: (_element: unknown, flush: () => void) => flush(),
    syncActiveInline: () => {},
    setProjectionBlockEditable: () => {},
  };
}

function stubEnv(confirm = true) {
  return {
    confirm: () => confirm,
    scheduleFrame: (callback: () => void) => {
      callback();
      return 0;
    },
    cancelFrame: () => {},
    getSelection: () => null,
    activeElement: () => null,
    Node: { ELEMENT_NODE: 1 },
  };
}

function mountForm(buttons = "") {
  const { document } = parseHTML(
    `<form data-editor-mode="visual"><div class="toolbar">${buttons}</div><output data-presentation-editor-target="status"></output></form>`,
  );
  return { document, form: document.querySelector("form") as unknown as HTMLFormElement };
}

function mountEditor(form: HTMLFormElement, editorMap = testMap(), editor = fakeEditor(), confirm = true) {
  return mountPresentationEditor(form as unknown as Parameters<typeof mountPresentationEditor>[0], {
    editorMap,
    getEditor: () => editor,
    deps: stubDeps(),
    env: stubEnv(confirm),
  });
}

test("client presentation editor appends a slide after the last one", () => {
  const { form } = mountForm();
  const editorState = fakeEditor();
  const mount = mountEditor(form, testMap(), editorState);

  mount.editor.addSlide(2);

  assert.ok(editorState.value.endsWith("---\n# New slide\n\nStart writing here."));
  mount.destroy();
});

test("client presentation editor deletes the middle slide range", () => {
  const three = "# A\n\n---\n\n# B\n\n---\n\n# C\n";
  const firstDelim = three.indexOf("---");
  const secondStart = three.indexOf("# B");
  const secondDelim = three.indexOf("---", secondStart);
  const thirdStart = three.indexOf("# C");
  const map = {
    source_length: three.length,
    slides: [
      { range: { start: 0, end: firstDelim }, delimiter_range: { start: firstDelim, end: secondStart }, blocks: [], directives: [] },
      { range: { start: secondStart, end: secondDelim }, delimiter_range: { start: secondDelim, end: thirdStart }, blocks: [], directives: [] },
      { range: { start: thirdStart, end: three.length }, blocks: [], directives: [] },
    ],
    directives: [],
    editable_regions: [],
  };
  const { form } = mountForm();
  const editorState = fakeEditor();
  editorState.value = three;
  map.source_length = three.length;
  const mount = mountEditor(form, map, editorState);

  mount.editor.deleteSlide(1);

  assert.ok(!editorState.value.includes("# B"));
  assert.ok(editorState.value.includes("# A"));
  assert.ok(editorState.value.includes("# C"));
  mount.destroy();
});

test("client presentation editor moves slides by rewriting sections", () => {
  const { form } = mountForm();
  const editorState = fakeEditor();
  const mount = mountEditor(form, testMap(), editorState);

  mount.editor.moveSlide(0, 1);

  assert.ok(editorState.value.indexOf("# Beta") < editorState.value.indexOf("# Alpha"));
  mount.destroy();
});

test("structural operations commit through the session pipeline", () => {
  const { form } = mountForm();
  const editorState = fakeEditor();
  const mount = mountEditor(form, testMap(), editorState);

  mount.editor.moveSlide(0, 1);
  mount.editor.addBlock(0, 1);

  assert.equal(editorState.commits.length, 2);
  assert.equal(editorState.commits[1], editorState.value);
  mount.destroy();
});

test("client presentation editor inserts and removes blocks", () => {
  const { form } = mountForm();
  const editorState = fakeEditor();
  const mount = mountEditor(form, testMap(), editorState);

  mount.editor.addBlock(0, 1);

  assert.ok(editorState.value.includes("New block\n\nFirst"));
  mount.destroy();
});

test("client presentation editor removes blocks with surrounding blank cleanup", () => {
  const { form } = mountForm();
  const editorState = fakeEditor();
  const mount = mountEditor(form, testMap(), editorState);

  mount.editor.deleteBlock(0, 1);

  assert.ok(!editorState.value.includes("First"));
  assert.ok(editorState.value.includes("# Alpha"));
  assert.ok(editorState.value.includes("# Beta"));
  mount.destroy();
});

test("client presentation editor routes toolbar actions and confirms deletes", () => {
  const { form } = mountForm(
    `<button type="button" data-presentation-editor-action="add-slide-after" data-slide-index="1">Add</button>` +
      `<button type="button" data-presentation-editor-action="delete-slide" data-slide-index="0">Delete</button>`,
  );
  const editorState = fakeEditor();
  const mount = mountEditor(form, testMap(), editorState);

  const buttons = [...form.querySelectorAll("button")] as unknown as HTMLButtonElement[];
  mount.editor.handleAction({ target: buttons[0], preventDefault: () => {} });
  assert.ok(editorState.value.includes("# New slide"));
  mount.destroy();
});

test("client presentation editor refuses deletes when confirm denies", () => {
  const { form } = mountForm(
    `<button type="button" data-presentation-editor-action="delete-slide" data-slide-index="0">Delete</button>`,
  );
  const editorState = fakeEditor();
  const map = testMap();
  const mount = mountEditor(form, map, editorState, false);

  const button = form.querySelector("button") as unknown as HTMLButtonElement;
  mount.editor.handleAction({ target: button, preventDefault: () => {} });

  assert.equal(editorState.value, SOURCE);
  mount.destroy();
});

test("client presentation editor inserts alignment directives", () => {
  const { document, form } = mountForm();
  const editorState = fakeEditor();
  const mount = mountEditor(form, testMap(), editorState);

  const select = document.createElement("select");
  Object.defineProperty(select, "value", { value: "center", configurable: true });
  select.setAttribute("data-presentation-editor-align", "");
  select.setAttribute("data-slide-index", "0");
  select.setAttribute("data-block-index", "0");
  form.append(select);
  mount.editor.handleAction({ target: form, preventDefault: () => {} });
  const change = { target: select, preventDefault: () => {} };
  mount.editor.alignmentChanged(change);

  assert.ok(editorState.value.includes(":::align{center}"));
  mount.destroy();
});

test("client presentation editor pauses controls while the preview is stale", () => {
  const { form } = mountForm(
    `<button type="button" data-presentation-editor-action="add-slide-after" data-slide-index="0">Add</button>`,
  );
  const editorState = fakeEditor();
  editorState.value += "див";
  const mount = mountEditor(form, testMap(), editorState);

  mount.editor.previewStale({});

  const button = form.querySelector("button") as unknown as HTMLButtonElement;
  assert.equal(button.disabled, true);
  mount.destroy();
});

test("client presentation editor listens for input at capture phase", () => {
  // Projection edits must be read before form bubble-phase actions (notably
  // input->preview#schedule) mark the projection stale. Linkedom dispatches
  // listeners in registration order, so event-phase precedence itself is
  // covered by the visual-edit system tests in a real browser; here we pin
  // the capture registration that provides it.
  const { form } = mountForm();
  const registrations: Array<{ type: string; capture: unknown }> = [];
  const originalAdd = form.addEventListener.bind(form);
  (form as unknown as { addEventListener: unknown }).addEventListener = (
    type: string,
    handler: unknown,
    capture: unknown,
  ) => {
    registrations.push({ type, capture });
    return (originalAdd as (...args: Array<unknown>) => unknown)(type, handler, capture);
  };
  const mount = mountEditor(form);

  const inputRegistrations = registrations.filter((registration) => registration.type === "input");
  assert.ok(inputRegistrations.length > 0);
  assert.ok(inputRegistrations.every((registration) => registration.capture === true));
  mount.destroy();
});

test("client presentation editor publishes itself for the code editor host", () => {
  const { form } = mountForm();
  const mount = mountEditor(form);

  assert.equal(
    (form as unknown as Record<string, unknown>).presentationEditorController,
    mount.editor,
  );
  assert.ok(mount.editor instanceof PresentationEditor);
  mount.destroy();
  assert.equal((form as unknown as Record<string, unknown>).presentationEditorController, undefined);
});

// Input-bridge selection leg, shared with the document editor: a collapsed
// native caret inside an editable block drives the engine selection.
function syncFixture({ editable = true, collapsed = true }: { editable?: boolean; collapsed?: boolean } = {}) {
  const { document } = parseHTML(
    `<form data-editor-mode="visual"><div data-presentation-editor-target="canvas"><div data-editor-block-id="b1">First</div></div><output data-presentation-editor-target="status"></output></form>`,
  );
  const form = document.querySelector("form") as unknown as HTMLFormElement;
  const block = document.querySelector('[data-editor-block-id="b1"]') as unknown as HTMLElement;
  // Browsers reflect contenteditable as "true"/"false"; linkedom coerces to
  // boolean, so shadow the property with the browser string value.
  Object.defineProperty(block, "contentEditable", { configurable: true, value: editable ? "true" : "false" });
  const textNode = block.firstChild as unknown as Text;
  const editor = fakeEditor();
  const mount = mountPresentationEditor(form as unknown as Parameters<typeof mountPresentationEditor>[0], {
    editorMap: {
      source_length: SOURCE.length,
      slides: [],
      directives: [],
      editable_regions: [{ id: "r1", block_id: "b1", kind: "paragraph", editable: true, content_range: { start: 9, end: 14 } }],
    },
    getEditor: () => editor,
    deps: {
      ...stubDeps(),
      syncActiveMath: () => {},
      syncActiveInline: () => {},
      visibleOffsetAtPoint: () => 2,
      sourceOffsetForVisibleOffset: (_source: string, offset: number) => offset,
      visibleOffsetForSourceOffset: (source: string) => source.length,
      markdownForVisibleText: (_source: string, text: string) => `${text}!`,
    },
    env: {
      ...stubEnv(),
      getSelection: () =>
        ({
          isCollapsed: collapsed,
          anchorNode: textNode,
          anchorOffset: 2,
          focusNode: textNode,
          focusOffset: 2,
          setPosition: () => {},
        }) as unknown as Selection,
    },
  });
  mount.editor.editorController = editor;
  return { mount, editor, block };
}

test("presentation caret in an editable block drives the engine selection", () => {
  const { mount, editor } = syncFixture();

  mount.editor.rememberProjectionCaret();

  assert.deepEqual(mount.editor.lastProjectionCaret, { blockId: "b1", visibleOffset: 2 });
  assert.deepEqual(editor.ranges, [[11, 11]]);
  mount.destroy();
});

test("presentation readonly blocks never move the engine selection", () => {
  const { mount, editor } = syncFixture({ editable: false });

  mount.editor.rememberProjectionCaret();

  assert.deepEqual(mount.editor.lastProjectionCaret, { blockId: "b1", visibleOffset: 2 });
  assert.deepEqual(editor.ranges, []);
  mount.destroy();
});

test("presentation ranged selections stay projection-side", () => {
  const { mount, editor } = syncFixture({ collapsed: false });

  mount.editor.rememberProjectionCaret();

  assert.deepEqual(editor.ranges, []);
  mount.destroy();
});

test("presentation flush commits then syncs the engine selection", () => {
  const { mount, editor, block } = syncFixture();
  mount.editor.pendingProjectionEdits = new Map([
    ["r1", { id: "r1", blockId: "b1", from: 9, to: 14, source: "First", kind: "paragraph", blockElement: block as unknown as Element }],
  ]);

  mount.editor.rememberProjectionCaret();
  assert.deepEqual(editor.ranges, []);

  mount.editor.flushPendingProjectionEdits();
  assert.equal(editor.value.slice(9, 15), "First!");
  assert.deepEqual(editor.ranges, [[11, 11]]);
  mount.destroy();
});

test("presentation flush discards pending edits whose base no longer matches", () => {
  const { mount, editor, block } = syncFixture();
  editor.value = `${"x".repeat(9)}First!${"x".repeat(5)}`;
  mount.editor.map!.editable_regions![0]!.content_range = { start: 9, end: 15 };
  mount.editor.pendingProjectionEdits = new Map([
    ["r1", { id: "r1", blockId: "b1", from: 9, to: 14, source: "First", kind: "paragraph", blockElement: block as unknown as Element }],
  ]);

  mount.editor.flushPendingProjectionEdits();

  assert.equal(editor.value, `${"x".repeat(9)}First!${"x".repeat(5)}`);
  assert.equal(mount.editor.pendingProjectionEdits!.size, 0);
  mount.destroy();
});

test("presentation typing commits a precise source transaction without pending", () => {
  const { mount, editor, block } = syncFixture();
  const replaced: Array<{ text: string; from: number; to: number }> = [];
  const double = editor as unknown as Record<string, unknown>;
  double.replaceRange = (text: string, from: number, to: number) => {
    replaced.push({ text, from, to });
  };

  mount.editor.projectionBeforeinput({
    target: block as unknown as EventTarget,
    inputType: "insertText",
    data: "X",
  });

  assert.deepEqual(replaced, [{ text: "X", from: 11, to: 11 }]);
  assert.equal(mount.editor.pendingProjectionEdits, undefined);
  mount.destroy();
});

test("presentation precise commit suppresses only the following input event", () => {
  const { mount, editor, block } = syncFixture();
  (mount.editor.map as unknown as { slides: Array<{ blocks: Array<{ id: string }> }> }).slides = [{ blocks: [{ id: "b1" }] }];
  mount.editor.canEditBlock = () => true;
  mount.editor.scheduleProjectionFlush = () => {};
  const replaced: Array<{ text: string; from: number; to: number }> = [];
  (editor as unknown as Record<string, unknown>).replaceRange = (text: string, from: number, to: number) => {
    replaced.push({ text, from, to });
  };

  mount.editor.projectionBeforeinput({
    target: block as unknown as EventTarget,
    inputType: "insertText",
    data: "X",
  });

  assert.deepEqual(replaced, [{ text: "X", from: 11, to: 11 }]);
  assert.equal(mount.editor.suppressProjectionInput, true);

  mount.editor.blockInput({ target: block, preventDefault: () => {} } as unknown as Parameters<typeof mount.editor.blockInput>[0]);
  assert.equal(mount.editor.pendingProjectionEdits, undefined);
  assert.equal(mount.editor.suppressProjectionInput, false);

  mount.editor.blockInput({ target: block, preventDefault: () => {} } as unknown as Parameters<typeof mount.editor.blockInput>[0]);
  assert.equal(mount.editor.pendingProjectionEdits!.size, 1);
  mount.destroy();
});

test("presentation structural intents stay on the reconstruction path", () => {
  const { mount, editor, block } = syncFixture();
  const before = editor.value;

  for (const inputType of ["insertParagraph", "insertCompositionText", "historyUndo"]) {
    mount.editor.projectionBeforeinput({
      target: block as unknown as EventTarget,
      inputType,
      data: "x",
    });
  }

  assert.equal(editor.value, before);
  assert.equal(mount.editor.pendingProjectionEdits, undefined);
  mount.destroy();
});

function vimKeyEvent(block: Element, key: string, overrides: Record<string, unknown> = {}) {
  const event = {
    key,
    target: block as unknown as EventTarget,
    isComposing: false,
    altKey: false,
    ctrlKey: false,
    metaKey: false,
    shiftKey: false,
    defaultPrevented: false,
    preventDefault: () => {
      event.defaultPrevented = true;
    },
    ...overrides,
  };
  return event;
}

test("presentation Vim routes normal keys and follows with the caret", () => {
  const { mount, editor, block } = syncFixture();
  editor.vimEnabled = true;
  editor.insertMode = false;
  editor.selectionHead = 13;
  editor.handleVimKey = (event: { key: string }) => {
    editor.vimKeys.push(event.key);
    return true;
  };
  const inputEvents: string[] = [];
  (block as unknown as { dispatchEvent: unknown }).dispatchEvent = (event: { type: string }) => {
    inputEvents.push(event.type);
  };
  const event = vimKeyEvent(block as unknown as Element, "l");

  assert.equal(mount.editor.routeVimKey(event, block as unknown as Element), true);
  assert.deepEqual(editor.vimKeys, ["l"]);
  assert.equal(event.defaultPrevented, true);
  assert.deepEqual(mount.editor.lastProjectionCaret?.blockId, "b1");
  assert.deepEqual(inputEvents.filter((type) => type === "input"), []);
  assert.equal(mount.editor.pendingCaretRestore, undefined);
  mount.destroy();
});

test("presentation Vim edits schedule a refresh with caret restoration", () => {
  const { mount, editor, block } = syncFixture();
  editor.vimEnabled = true;
  editor.insertMode = false;
  editor.handleVimKey = () => {
    editor.value = `${editor.value}!`;
    editor.selectionHead = 12;
    return true;
  };
  const inputEvents: string[] = [];
  (block as unknown as { dispatchEvent: unknown }).dispatchEvent = (event: { type: string }) => {
    inputEvents.push(event.type);
  };

  assert.equal(mount.editor.routeVimKey(vimKeyEvent(block as unknown as Element, "x"), block as unknown as Element), true);
  assert.deepEqual(mount.editor.pendingCaretRestore, { sourceOffset: 12, preferredBlockId: "b1" });
  assert.deepEqual(inputEvents.filter((type) => type === "input"), ["input"]);
  mount.destroy();
});

test("presentation modified keys reach Vim first and fall through when declined", () => {
  // Source precedence (verified in the vendor bundle): the Vim plugin sees
  // every keydown before the keymaps. Visual routing mirrors it, so e.g.
  // Ctrl-r redoes through Vim rather than through history.
  const modified = syncFixture();
  modified.editor.vimEnabled = true;
  modified.editor.insertMode = false;
  assert.equal(
    modified.mount.editor.routeVimKey(vimKeyEvent(modified.block as unknown as Element, "j", { ctrlKey: true }), modified.block as unknown as Element),
    false,
  );
  assert.deepEqual(modified.editor.vimKeys, ["j"]);
  modified.mount.destroy();
});

test("presentation Vim bypasses disabled, insert, and navigation input", () => {
  const disabled = syncFixture();
  assert.equal(disabled.mount.editor.routeVimKey(vimKeyEvent(disabled.block as unknown as Element, "j"), disabled.block as unknown as Element), false);
  assert.deepEqual(disabled.editor.vimKeys, []);
  disabled.mount.destroy();

  const insert = syncFixture();
  insert.editor.vimEnabled = true;
  insert.editor.insertMode = true;
  assert.equal(insert.mount.editor.routeVimKey(vimKeyEvent(insert.block as unknown as Element, "j"), insert.block as unknown as Element), false);
  assert.deepEqual(insert.editor.vimKeys, []);
  insert.mount.destroy();

  const arrow = syncFixture();
  arrow.editor.vimEnabled = true;
  arrow.editor.insertMode = false;
  const arrowEvent = vimKeyEvent(arrow.block as unknown as Element, "ArrowLeft");
  assert.equal(arrow.mount.editor.routeVimKey(arrowEvent, arrow.block as unknown as Element), false);
  assert.equal(arrowEvent.defaultPrevented, false);
  arrow.mount.destroy();
});

test("presentation shortcuts run through the shared keymap", () => {
  const { mount, editor, block } = syncFixture();
  editor.runKeymap = (event: { key: string }) => {
    editor.keymapCalls.push(event.key);
    editor.value = `${editor.value}!`;
    editor.selectionHead = 12;
    return true;
  };
  const inputEvents: string[] = [];
  (block as unknown as { dispatchEvent: unknown }).dispatchEvent = (event: { type: string }) => {
    inputEvents.push(event.type);
  };
  const event = vimKeyEvent(block as unknown as Element, "z", { metaKey: true });

  assert.equal(mount.editor.routeKeymapKey(event, block as unknown as Element), true);
  assert.deepEqual(editor.keymapCalls, ["z"]);
  assert.equal(event.defaultPrevented, true);
  assert.deepEqual(mount.editor.pendingCaretRestore, { sourceOffset: 12, preferredBlockId: "b1" });
  assert.deepEqual(inputEvents.filter((type) => type === "input"), ["input"]);
  mount.destroy();
});

test("presentation blockKeydown wires shortcuts after Vim", () => {
  const { mount, editor, block } = syncFixture();
  mount.editor.blockKeydown(vimKeyEvent(block as unknown as Element, "z", { metaKey: true }));
  assert.deepEqual(editor.keymapCalls, ["z"]);

  mount.editor.blockKeydown(vimKeyEvent(block as unknown as Element, "a"));
  assert.deepEqual(editor.keymapCalls, ["z"]);
  mount.destroy();
});

test("presentation suppressed block input clears the flag without reconciling", () => {
  const { mount, block } = syncFixture();
  mount.editor.suppressProjectionInput = true;

  mount.editor.blockInput({ target: block } as never);

  assert.equal(mount.editor.suppressProjectionInput, false);
  assert.equal(mount.editor.pendingProjectionEdits, undefined);
  mount.destroy();
});

test("presentation Vim visual ranges survive projection caret sync", () => {
  const { mount, editor } = syncFixture();
  editor.vimEnabled = true;
  editor.insertMode = false;
  editor.selectionStart = 5;
  editor.selectionEnd = 9;

  mount.editor.rememberProjectionCaret();

  assert.deepEqual(editor.ranges, []);
  mount.destroy();
});

test("presentation map shifting grows the edited block end on appends", () => {
  const edited = { id: "b2", block_id: "b2", range: { start: 9, end: 14 }, content_range: { start: 9, end: 14 } };
  const after = { id: "b3", block_id: "b3", range: { start: 14, end: 20 }, content_range: { start: 14, end: 20 } };
  const { form } = mountForm();
  const mount = mountEditor(form, {
    source_length: 20,
    slides: [{ blocks: [edited, after] }],
    editable_regions: [edited, after],
  } as unknown as Parameters<typeof mountEditor>[1]);
  const editor = mount.editor;

  // Pure insert at the edited end (appending one char): the edited end
  // must advance or later offsets clamp and prepend (reversed ghost).
  editor.shiftMapAfterEdit(14, 14, 1, "b2");

  assert.equal(editor.map?.source_length, 21);
  assert.deepEqual(edited.content_range, { start: 9, end: 15 });
  assert.deepEqual(after.content_range, { start: 14, end: 21 });
});

test("presentation map shifting pins the edited block start on replacement", () => {
  const edited = { id: "b2", block_id: "b2", range: { start: 9, end: 14 }, content_range: { start: 9, end: 14 } };
  const { form } = mountForm();
  const mount = mountEditor(form, {
    source_length: 20,
    slides: [{ blocks: [edited] }],
    editable_regions: [edited],
  } as unknown as Parameters<typeof mountEditor>[1]);
  const editor = mount.editor;

  editor.shiftMapAfterEdit(9, 14, 2, "b2");

  assert.deepEqual(edited.content_range, { start: 9, end: 11 });
  assert.equal(editor.map?.source_length, 17);
});

test("presentation assist insert shifts the map and patches the canvas block", () => {
  const edited = { id: "b2", block_id: "b2", range: { start: 9, end: 14 }, content_range: { start: 9, end: 14 } };
  const { document, form } = mountForm();
  const mount = mountEditor(form, {
    source_length: 20,
    slides: [{ blocks: [edited] }],
    editable_regions: [edited],
  } as unknown as Parameters<typeof mountEditor>[1]);
  const editor = mount.editor;

  const canvas = document.createElement("div");
  canvas.innerHTML = `<div data-editor-block-id="b2"><p>First /q</p></div>`;
  editor.canvasElement = canvas as unknown as Element;
  const text = canvas.querySelector("p")?.firstChild as unknown as Text;
  const positions: Array<[Node, number]> = [];
  editor.getSelection = () => ({ focusNode: text, focusOffset: 8, setPosition: (node: Node, offset: number) => { positions.push([node, offset]); } } as unknown as Selection);

  const patched = editor.applyVisualAssistInsert({ from: 12, to: 14, insert: "xy!", caret: 15 });

  assert.equal(patched, true);
  assert.equal(text.data, "First xy!");
  assert.equal(positions.length, 1);
  assert.equal(positions[0]?.[0], text);
  assert.equal(positions[0]?.[1], 9);
  assert.deepEqual(edited.content_range, { start: 9, end: 15 });
  assert.equal(editor.map?.source_length, 21);
  assert.deepEqual(editor.pendingCaretRestore, { sourceOffset: 15, preferredBlockId: "b2" });
});

test("menu block actions run against the caret block with caret restore", () => {
  const regions = () => ([
    { id: "r1", block_id: "b1", kind: "heading", editable: true, content_range: { start: 0, end: 7 } },
    { id: "r2", block_id: "b2", kind: "paragraph", editable: true, content_range: { start: 9, end: 14 } },
  ]);

  // Add below a mid-slide block inserts before the next block's start.
  {
    const { form } = mountForm();
    const editorState = fakeEditor();
    const map = testMap();
    map.editable_regions = regions();
    const mount = mountEditor(form, map, editorState);
    mount.editor.lastProjectionCaret = { blockId: "b1", visibleOffset: 0 };

    assert.equal(mount.editor.applyVisualBlockAction("add-block-after"), true);
    assert.equal(editorState.value, `${SOURCE.slice(0, 9)}New block\n\n${SOURCE.slice(9)}`);
    assert.deepEqual(mount.editor.pendingCaretRestore, { sourceOffset: 9, preferredBlockId: null });
    mount.destroy();
  }

  // Add below the last block accounts for the joining newline.
  {
    const { form } = mountForm();
    const editorState = fakeEditor();
    const map = testMap();
    map.editable_regions = regions();
    const mount = mountEditor(form, map, editorState);
    mount.editor.lastProjectionCaret = { blockId: "b2", visibleOffset: 5 };

    assert.equal(mount.editor.applyVisualBlockAction("add-block-after"), true);
    assert.ok(editorState.value.includes("First\n\n\nNew block\n---"));
    assert.deepEqual(mount.editor.pendingCaretRestore, { sourceOffset: 17, preferredBlockId: null });
    mount.destroy();
  }

  // Delete confirms, excises the block span, and stages the action site.
  {
    const { form } = mountForm();
    const editorState = fakeEditor();
    const map = testMap();
    map.editable_regions = regions();
    const mount = mountEditor(form, map, editorState, true);
    mount.editor.lastProjectionCaret = { blockId: "b2", visibleOffset: 5 };

    assert.equal(mount.editor.applyVisualBlockAction("delete-block"), true);
    assert.ok(!editorState.value.includes("First"));
    assert.ok(editorState.value.includes("# Alpha"));
    const restore = mount.editor.pendingCaretRestore as { sourceOffset: number; preferredBlockId: null };
    assert.ok(restore.sourceOffset >= 0 && restore.sourceOffset <= editorState.value.length);
    assert.equal(restore.preferredBlockId, null);
    mount.destroy();
  }

  // Moves follow the caret: the moved block inherits its neighbor's id
  // and the relative caret resolves against the fresh map.
  {
    const { form } = mountForm();
    const editorState = fakeEditor();
    const map = testMap();
    map.editable_regions = regions();
    const mount = mountEditor(form, map, editorState);
    mount.editor.lastProjectionCaret = { blockId: "b1", visibleOffset: 0 };

    assert.equal(mount.editor.applyVisualBlockAction("move-block-down"), true);
    assert.ok(editorState.value.indexOf("First") < editorState.value.indexOf("# Alpha"));
    assert.deepEqual(mount.editor.pendingCaretRestore, { sourceOffset: 0, preferredBlockId: "b2", relativeOffset: 0 });
    mount.destroy();
  }

  // Move refusals (boundaries, empty placeholders) leave source and caret alone.
  {
    const { form } = mountForm();
    const editorState = fakeEditor();
    const map = testMap();
    map.editable_regions = regions();
    const mount = mountEditor(form, map, editorState);
    mount.editor.lastProjectionCaret = { blockId: "b1", visibleOffset: 0 };

    assert.equal(mount.editor.moveCaretBlock(-1), false);
    assert.deepEqual(editorState.commits, []);
    assert.equal(mount.editor.pendingCaretRestore ?? null, null);
    mount.destroy();
  }
  {
    const { form } = mountForm();
    const editorState = fakeEditor();
    const map = testMap();
    map.editable_regions = regions();
    map.slides[0]!.blocks.splice(1, 0, {
      id: "slide-1-empty-1",
      range: { start: 7, end: 7 },
      source_range: { start: 7, end: 7 },
      content_range: { start: 7, end: 7 },
      empty_placeholder: true,
    });
    const mount = mountEditor(form, map, editorState);
    mount.editor.lastProjectionCaret = { blockId: "b1", visibleOffset: 0 };

    assert.equal(mount.editor.moveCaretBlock(1), false);
    assert.deepEqual(editorState.commits, []);
    mount.destroy();
  }

  // Relative restores clamp into the inherited block on the fresh map.
  {
    const { document, form } = mountForm();
    const editorState = fakeEditor();
    editorState.value = "First\n\n# Alpha\n";
    const map = testMap();
    map.editable_regions = [
      { id: "r2", block_id: "b2", kind: "paragraph", editable: true, content_range: { start: 0, end: 5 } },
    ];
    const mount = mountEditor(form, map, editorState);
    const canvas = document.createElement("div");
    canvas.innerHTML = `<div data-editor-block-id="b2" contenteditable="true"><p>First</p></div>`;
    // linkedom does not reflect contenteditable to contentEditable.
    Object.defineProperty(canvas.firstElementChild, "contentEditable", { value: "true" });
    mount.editor.canvasElement = canvas as unknown as Element;
    mount.editor.pendingCaretRestore = { sourceOffset: 0, preferredBlockId: "b2", relativeOffset: 3 };

    mount.editor.restorePendingCaret();

    assert.deepEqual(mount.editor.lastProjectionCaret, { blockId: "b2", visibleOffset: 3 });
    mount.destroy();
  }
  // An unresolvable move id abandons the restore instead of jumping.
  {
    const { document, form } = mountForm();
    const editorState = fakeEditor();
    const map = testMap();
    map.editable_regions = [];
    const mount = mountEditor(form, map, editorState);
    const canvas = document.createElement("div");
    canvas.innerHTML = `<div data-editor-block-id="b2" contenteditable="true"><p>First</p></div>`;
    mount.editor.canvasElement = canvas as unknown as Element;
    mount.editor.pendingCaretRestore = { sourceOffset: 0, preferredBlockId: "b2", relativeOffset: 3 };

    mount.editor.restorePendingCaret();

    assert.equal(mount.editor.lastProjectionCaret, undefined);
    mount.destroy();
  }

  // Declined confirms, source mode, and an unresolvable caret refuse.
  {
    const { form } = mountForm();
    const editorState = fakeEditor();
    const map = testMap();
    map.editable_regions = regions();
    const mount = mountEditor(form, map, editorState, false);
    mount.editor.lastProjectionCaret = { blockId: "b2", visibleOffset: 5 };

    assert.equal(mount.editor.applyVisualBlockAction("delete-block"), false);
    assert.deepEqual(editorState.commits, []);
    mount.destroy();
  }
  {
    const { form } = mountForm();
    (form as unknown as HTMLElement).dataset.editorMode = "source";
    const editorState = fakeEditor();
    const map = testMap();
    map.editable_regions = regions();
    const mount = mountEditor(form, map, editorState);
    mount.editor.lastProjectionCaret = { blockId: "b2", visibleOffset: 5 };

    assert.equal(mount.editor.applyVisualBlockAction("add-block-after"), false);
    assert.deepEqual(editorState.commits, []);
    mount.destroy();
  }
  {
    const { form } = mountForm();
    const editorState = fakeEditor();
    const map = testMap();
    map.editable_regions = regions();
    const mount = mountEditor(form, map, editorState);
    mount.editor.lastProjectionCaret = undefined;

    assert.equal(mount.editor.applyVisualBlockAction("add-block-after"), false);
    assert.deepEqual(editorState.commits, []);
    mount.destroy();
  }
});

test("alignment pills flip sides by measured room", () => {
  const { document, form } = mountForm();
  const mount = mountEditor(form, testMap(), fakeEditor());
  const editor = mount.editor;
  const canvas = document.createElement("div") as unknown as HTMLElement;
  canvas.innerHTML = [
    `<section class="slide">`,
    `<div class="slide-block-shell" id="narrow"><div class="slide-block"></div><div class="presentation-editor-block-controls"></div></div>`,
    `<div class="slide-block-shell" id="right"><div class="slide-block"></div><div class="presentation-editor-block-controls"></div></div>`,
    `<div class="slide-block-shell" id="wide"><div class="slide-block"></div><div class="presentation-editor-block-controls"></div></div>`,
    `</section>`,
  ].join("");
  editor.canvasElement = canvas as unknown as Element;
  const rect = (left: number, right: number) => ({ left, right, top: 0, bottom: 10, width: right - left, height: 10, x: left, y: 0, toJSON: () => ({}) });
  const slide = canvas.querySelector(".slide") as unknown as HTMLElement;
  (slide as unknown as { getBoundingClientRect: () => unknown }).getBoundingClientRect = () => rect(0, 1000);
  const stub = (id: string, left: number, right: number) => {
    const shell = canvas.querySelector(`#${id}`) as unknown as HTMLElement;
    (shell as unknown as { getBoundingClientRect: () => unknown }).getBoundingClientRect = () => rect(left, right);
    const controls = shell.querySelector(".presentation-editor-block-controls") as unknown as HTMLElement;
    Object.defineProperty(controls, "offsetWidth", { value: 190 });
    return controls;
  };
  const narrow = stub("narrow", 100, 300);
  const right = stub("right", 700, 950);
  const wide = stub("wide", 100, 950);

  editor.placeAlignmentPills();

  assert.equal(narrow.classList.contains("pill-left"), false);
  assert.equal(narrow.classList.contains("pill-inside"), false);
  assert.equal(right.classList.contains("pill-left"), true);
  assert.equal(wide.classList.contains("pill-inside"), true);

  // Re-placement is idempotent (no class churn on repeated measures).
  editor.placeAlignmentPills();
  assert.equal(right.classList.contains("pill-left"), true);
  assert.equal(wide.classList.contains("pill-inside"), true);
  mount.destroy();
});
