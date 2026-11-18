import { test } from "node:test";
import assert from "node:assert/strict";
import { parseHTML } from "linkedom";
import { EditorState } from "@codemirror/state";
import { history, undo } from "@codemirror/commands";
import { projectionRangeEdit, projectionWrapSelection } from "../src/session/projection_range.js";

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

test("visual selections map both directions for Markdown wrapping", () => {
  for (const reversed of [false, true]) {
    const { root, selection, offset } = fixture(reversed);
    const edit = projectionWrapSelection({ inputType: "insertText", data: "*", preventDefault() {} }, root, selection, offset);
    assert.deepEqual(edit, { from: 3, to: 9, anchor: reversed ? 9 : 3, head: reversed ? 3 : 9, marker: "*" });
    assert.equal(projectionWrapSelection({ inputType: "insertCompositionText", data: "*", preventDefault() {} }, root, selection, offset), null);
  }
});

test("visual wrapping declines code, math, and cross-cell table ranges while allowing single-cell wrapping", () => {
  const { document } = parseHTML(
    `<main>` +
      `<div data-editor-block-id="code" contenteditable="true"><pre><code>const x = 1</code></pre></div>` +
      `<div data-editor-block-id="math" contenteditable="true">` +
        `<span data-elef-math-source="a+b">a+b</span>` +
        `<span class="editor-reveal-math">c+d</span>` +
        `<span class="katex">x^2</span>` +
        `<span data-editor-math-source="y" class="editor-math-active">$y$</span>` +
      `</div>` +
      `<div data-editor-block-id="table" contenteditable="true"><table><tbody><tr>` +
        `<td>alpha</td><td>beta</td>` +
      `</tr></tbody></table></div>` +
    `</main>`,
  );
  const root = document.querySelector("main") as unknown as Element;
  const offset = (_block: HTMLElement, _node: Node, position: number) => position;

  const codeText = root.querySelector("pre code")!.firstChild as Node;
  assert.equal(projectionWrapSelection(
    { inputType: "insertText", data: "*", preventDefault() {} },
    root,
    { isCollapsed: false, anchorNode: codeText, anchorOffset: 0, focusNode: codeText, focusOffset: 5 } as unknown as Selection,
    offset,
  ), null);

  for (const selector of ["[data-elef-math-source]", ".editor-reveal-math", ".katex", ".editor-math-active"]) {
    const mathText = root.querySelector(selector)!.firstChild as Node;
    assert.equal(projectionWrapSelection(
      { inputType: "insertText", data: "*", preventDefault() {} },
      root,
      { isCollapsed: false, anchorNode: mathText, anchorOffset: 0, focusNode: mathText, focusOffset: 2 } as unknown as Selection,
      offset,
    ), null, `expected ${selector} to decline visual wrapping`);
  }

  const cells = [...root.querySelectorAll("td")];
  const cellA = cells[0]!.firstChild as Node;
  const cellB = cells[1]!.firstChild as Node;
  assert.equal(projectionWrapSelection(
    { inputType: "insertText", data: "*", preventDefault() {} },
    root,
    { isCollapsed: false, anchorNode: cellA, anchorOffset: 0, focusNode: cellB, focusOffset: 4 } as unknown as Selection,
    offset,
  ), null);

  const tableBlock = root.querySelector('[data-editor-block-id="table"]') as Node;
  assert.equal(projectionWrapSelection(
    { inputType: "insertText", data: "*", preventDefault() {} },
    root,
    { isCollapsed: false, anchorNode: tableBlock, anchorOffset: 0, focusNode: cellA, focusOffset: 3 } as unknown as Selection,
    offset,
  ), null);

  assert.deepEqual(projectionWrapSelection(
    { inputType: "insertText", data: "*", preventDefault() {} },
    root,
    { isCollapsed: false, anchorNode: cellA, anchorOffset: 0, focusNode: cellA, focusOffset: 5 } as unknown as Selection,
    offset,
  ), { from: 0, to: 5, anchor: 0, head: 5, marker: "*" });
});
