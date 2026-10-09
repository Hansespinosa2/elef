import { test } from "node:test";
import assert from "node:assert/strict";
import { parseHTML } from "linkedom";

import {
  mountPresentationEditor,
  PresentationEditor,
} from "../src/features/presentation/editor.js";

const SOURCE = "# Alpha\n\nFirst\n\n---\n\n# Beta\n\nSecond\n";

function slideRanges() {
  const firstDelim = SOURCE.indexOf("---");
  const secondStart = SOURCE.indexOf("# Beta");
  return { firstDelim, secondStart };
}

function testMap() {
  const { firstDelim, secondStart } = slideRanges();
  const block = (id: string, start: number, end: number) => ({
    id,
    range: { start, end },
    source_range: { start, end },
    content_range: { start, end },
    position_scope: "slide",
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
    editable_regions: [],
  };
}

function fakeEditor() {
  const state = {
    value: SOURCE,
    inputTarget: null,
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
    handleMathKeydown: () => false,
    syncActiveMath: (_element: unknown, flush: () => void) => flush(),
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
