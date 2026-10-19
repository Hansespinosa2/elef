import { test } from "node:test";
import assert from "node:assert/strict";
import { parseHTML } from "linkedom";
import { EditorState } from "@codemirror/state";
import { history, undo } from "@codemirror/commands";
import { projectionRangeEdit } from "../src/session/projection_range.js";

function fixture(reversed = false, sameBlock = false) {
  const { document } = parseHTML(`<main><div data-editor-block-id="a" contenteditable="true">First</div><div data-editor-block-id="${sameBlock ? "a" : "b"}" contenteditable="true">Last</div></main>`);
  const root = document.querySelector("main") as unknown as Element;
  const blocks = [...root.children] as HTMLElement[];
  const first = blocks[0]?.firstChild as Node;
  const last = blocks[1]?.firstChild as Node;
  const selection = {
    isCollapsed: false, anchorNode: reversed ? last : first, anchorOffset: reversed ? 2 : 3,
    focusNode: reversed ? first : last, focusOffset: reversed ? 3 : 2,
  } as unknown as Selection;
  const offset = (block: HTMLElement, _node: Node, position: number) => (block === blocks[0] ? 0 : 7) + position;
  return { root, selection, offset };
}

for (const reversed of [false, true]) {
  test(`cross-block deletion replaces the canonical source range and undoes intact (${reversed ? "backward" : "forward"})`, () => {
    const { root, selection, offset } = fixture(reversed);
    const edit = projectionRangeEdit({ inputType: "deleteContentBackward", preventDefault() {} }, root, selection, offset);
    assert.deepEqual(edit, { from: 3, to: 9, insert: "" });
    let state = EditorState.create({ doc: "First\n\nLast", extensions: [history()] });
    state = state.update({ changes: edit ?? [], userEvent: "input" }).state;
    assert.equal(state.doc.toString(), "First");
    assert.equal(undo({ state, dispatch(transaction) { state = transaction.state; } }), true);
    assert.equal(state.doc.toString(), "First\n\nLast");
  });
}

test("cross-page fragments of the same source block still use one source range", () => {
  const { root, selection, offset } = fixture(false, true);
  assert.deepEqual(projectionRangeEdit({ inputType: "insertText", data: "X", preventDefault() {} }, root, selection, offset), { from: 3, to: 9, insert: "X" });
});

test("cross-block clipboard replacement keeps the plain source text", () => {
  const { root, selection, offset } = fixture();
  const edit = projectionRangeEdit({
    inputType: "insertFromPaste", preventDefault() {},
    dataTransfer: { getData: () => "One\n\nTwo" },
  }, root, selection, offset);
  assert.deepEqual(edit, { from: 3, to: 9, insert: "One\n\nTwo" });
});

test("noncancelable compositions and selections outside the projection never commit", () => {
  const { root, selection, offset } = fixture();
  assert.equal(projectionRangeEdit({ inputType: "insertCompositionText", data: "字", cancelable: false, preventDefault() {} }, root, selection, offset), null);
  assert.equal(projectionRangeEdit({ inputType: "deleteContentForward", preventDefault() {} }, root.ownerDocument.createElement("aside"), selection, offset), null);
});
