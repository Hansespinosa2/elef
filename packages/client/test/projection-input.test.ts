import { test } from "node:test";
import assert from "node:assert/strict";
import { parseHTML } from "linkedom";
import {
  touchesConcealedBoundary,
  translateProjectionInput,
  vimPassthroughKey,
  visibleBlockText,
  type ProjectionInputIntent,
} from "../src/session/projection_input.js";

function intent(overrides: Partial<ProjectionInputIntent> = {}): ProjectionInputIntent {
  return {
    inputType: "insertText",
    data: null,
    transferText: null,
    transferHasHtml: false,
    anchorVisible: 0,
    focusVisible: 0,
    kind: "paragraph",
    ...overrides,
  };
}

test("insertText inserts at a collapsed caret", () => {
  assert.deepEqual(
    translateProjectionInput(intent({ data: "x", anchorVisible: 2, focusVisible: 2 }), "ab"),
    { fromVisible: 2, toVisible: 2, insert: "x" },
  );
});

test("insertText replaces a range regardless of endpoint order", () => {
  assert.deepEqual(
    translateProjectionInput(intent({ data: "xy", anchorVisible: 4, focusVisible: 1 }), "abcdef"),
    { fromVisible: 1, toVisible: 4, insert: "xy" },
  );
});

test("insertText without data falls back to reconstruction", () => {
  assert.equal(translateProjectionInput(intent({ data: null }), "ab"), null);
});

test("plain-text paste and drop translate; rich transfers fall back", () => {
  assert.deepEqual(
    translateProjectionInput(
      intent({ inputType: "insertFromPaste", transferText: "hi", anchorVisible: 1, focusVisible: 1 }),
      "ab",
    ),
    { fromVisible: 1, toVisible: 1, insert: "hi" },
  );
  assert.deepEqual(
    translateProjectionInput(
      intent({ inputType: "insertFromDrop", transferText: "hi", anchorVisible: 0, focusVisible: 2 }),
      "ab",
    ),
    { fromVisible: 0, toVisible: 2, insert: "hi" },
  );
  assert.equal(
    translateProjectionInput(intent({ inputType: "insertFromPaste", transferText: "hi", transferHasHtml: true })),
    null,
  );
  assert.equal(
    translateProjectionInput(intent({ inputType: "insertFromPaste", transferText: null })),
    null,
  );
});

test("backward deletion removes one grapheme cluster", () => {
  assert.deepEqual(
    translateProjectionInput(intent({ inputType: "deleteContentBackward", anchorVisible: 2, focusVisible: 2 }), "abc"),
    { fromVisible: 1, toVisible: 2, insert: "" },
  );
  assert.deepEqual(
    translateProjectionInput(intent({ inputType: "deleteContentBackward", anchorVisible: 3, focusVisible: 3 }), "a😀b"),
    { fromVisible: 1, toVisible: 3, insert: "" },
  );
  assert.deepEqual(
    translateProjectionInput(
      intent({ inputType: "deleteContentBackward", anchorVisible: 2, focusVisible: 2 }),
      "éx",
    ),
    { fromVisible: 0, toVisible: 2, insert: "" },
  );
});

test("forward deletion removes one grapheme cluster", () => {
  assert.deepEqual(
    translateProjectionInput(intent({ inputType: "deleteContentForward", anchorVisible: 1, focusVisible: 1 }), "abc"),
    { fromVisible: 1, toVisible: 2, insert: "" },
  );
  assert.deepEqual(
    translateProjectionInput(intent({ inputType: "deleteContentForward", anchorVisible: 1, focusVisible: 1 }), "a😀b"),
    { fromVisible: 1, toVisible: 3, insert: "" },
  );
});

test("ranged deletions remove the visible range", () => {
  for (const inputType of ["deleteContentBackward", "deleteContentForward"]) {
    assert.deepEqual(
      translateProjectionInput(intent({ inputType, anchorVisible: 1, focusVisible: 3 }), "abcd"),
      { fromVisible: 1, toVisible: 3, insert: "" },
    );
  }
});

test("block-boundary deletions stay on the structural path", () => {
  assert.equal(
    translateProjectionInput(intent({ inputType: "deleteContentBackward", anchorVisible: 0, focusVisible: 0 }), "ab"),
    null,
  );
  assert.equal(
    translateProjectionInput(intent({ inputType: "deleteContentForward", anchorVisible: 2, focusVisible: 2 }), "ab"),
    null,
  );
});

test("structural, composition, and history intents stay on the legacy path", () => {
  for (const inputType of [
    "insertParagraph",
    "insertLineBreak",
    "insertCompositionText",
    "deleteWordBackward",
    "deleteWordForward",
    "historyUndo",
    "historyRedo",
    "formatBold",
  ]) {
    assert.equal(
      translateProjectionInput(intent({ inputType, data: "x", anchorVisible: 1, focusVisible: 1 }), "ab"),
      null,
      `${inputType} must fall back`,
    );
  }
});

test("unconsumed normal-mode keys pass through only navigation and focus keys", () => {
  for (const key of ["ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight", "Home", "End", "PageUp", "PageDown", "Tab", "F1", "F12"]) {
    assert.equal(vimPassthroughKey(key), true, `${key} must keep native behavior`);
  }
  for (const key of ["j", "G", "$", "Enter", "Backspace", "Delete", "Escape", " ", ":"]) {
    assert.equal(vimPassthroughKey(key), false, `${key} must never reach native editing in normal mode`);
  }
});

test("visible block text excludes screen-reader and hidden runs", () => {
  const { document } = parseHTML(
    `<div data-editor-block-id="b1">E<span class="katex-mathml">E = mc^2</span><span aria-hidden="true">×</span></div>`,
  );
  const block = document.querySelector("[data-editor-block-id]") as unknown as Element;

  assert.equal(visibleBlockText(block), "E");
});

test("edits forming whitespace runs decline to the collapsing legacy path", () => {
  // Typing a space next to a space would leave a run the legacy path
  // collapses; only the legacy path may own that normalization.
  assert.equal(
    translateProjectionInput(intent({ data: " ", anchorVisible: 1, focusVisible: 1 }), "a b"),
    null,
  );
  assert.equal(
    translateProjectionInput(intent({ data: "\t", anchorVisible: 2, focusVisible: 2 }), "a\tb"),
    null,
  );
  assert.equal(
    translateProjectionInput(
      intent({ inputType: "insertFromPaste", transferText: "a  b", anchorVisible: 1, focusVisible: 1 }),
      "ab",
    ),
    null,
  );
  assert.equal(
    translateProjectionInput(intent({ inputType: "deleteContentBackward", anchorVisible: 3, focusVisible: 3 }), "a b "),
    null,
  );
});

test("content-edge whitespace declines outside code", () => {
  assert.equal(
    translateProjectionInput(intent({ data: " ", anchorVisible: 0, focusVisible: 0 }), ""),
    null,
  );
  assert.equal(
    translateProjectionInput(intent({ data: "x ", anchorVisible: 3, focusVisible: 3 }), "abc"),
    null,
  );
  assert.equal(
    translateProjectionInput(intent({ inputType: "deleteContentBackward", anchorVisible: 2, focusVisible: 2 }), " a"),
    null,
  );
  assert.equal(
    translateProjectionInput(intent({ inputType: "deleteContentBackward", anchorVisible: 3, focusVisible: 3 }), "a b"),
    null,
  );
  // Non-whitespace at edges and all code edits stay precise.
  assert.deepEqual(
    translateProjectionInput(intent({ data: "X", anchorVisible: 0, focusVisible: 0 }), "abc"),
    { fromVisible: 0, toVisible: 0, insert: "X" },
  );
  assert.deepEqual(
    translateProjectionInput(intent({ data: " ", anchorVisible: 0, focusVisible: 0, kind: "code" }), ""),
    { fromVisible: 0, toVisible: 0, insert: " " },
  );
  assert.deepEqual(
    translateProjectionInput(intent({ data: "  ", anchorVisible: 1, focusVisible: 1, kind: "code" }), "ab"),
    { fromVisible: 1, toVisible: 1, insert: "  " },
  );
});

test("edits without whitespace runs stay precise", () => {
  assert.deepEqual(
    translateProjectionInput(intent({ data: " ", anchorVisible: 1, focusVisible: 1 }), "ab"),
    { fromVisible: 1, toVisible: 1, insert: " " },
  );
  assert.deepEqual(
    translateProjectionInput(intent({ data: "x", anchorVisible: 1, focusVisible: 1 }), "a b"),
    { fromVisible: 1, toVisible: 1, insert: "x" },
  );
  assert.deepEqual(
    translateProjectionInput(intent({ inputType: "deleteContentBackward", anchorVisible: 2, focusVisible: 2 }), "a b"),
    { fromVisible: 1, toVisible: 2, insert: "" },
  );
});

test("concealed boundaries decline leading marker prefixes and interior delimiter jumps", () => {
  const leading = (_source: string, offset: number) => [2, 3, 4][offset] ?? 4;
  assert.equal(touchesConcealedBoundary(leading, "# x", 0, 0), true);
  assert.equal(touchesConcealedBoundary(leading, "# x", 1, 1), false);
  assert.equal(touchesConcealedBoundary(leading, "# x", 1, 2), false);

  const interior = (_source: string, offset: number) => [2, 5, 6, 7][offset] ?? 7;
  assert.equal(touchesConcealedBoundary(interior, "**a**b", 1, 1), true);
  assert.equal(touchesConcealedBoundary(interior, "**a**b", 2, 2), false);

  const identity = (_source: string, offset: number) => offset;
  assert.equal(touchesConcealedBoundary(identity, "abc", 0, 0), false);
  assert.equal(touchesConcealedBoundary(identity, "abc", 1, 3), false);
  assert.equal(touchesConcealedBoundary(identity, "", 0, 0), false);
});

test("visible block text skips all newlines to agree with the source map", () => {
  const { document } = parseHTML(
    `<div data-editor-block-id="b1"><ul>\n<li>one</li>\n<li>two</li>\n</ul>\n</div>`,
  );
  const block = document.querySelector("[data-editor-block-id]") as unknown as Element;

  assert.equal(visibleBlockText(block), "onetwo");

  const { document: softbreakDocument } = parseHTML(
    `<div data-editor-block-id="b1"><p>This uses most:\n<strong>emphasis</strong></p></div>`,
  );
  const softbreak = softbreakDocument.querySelector("[data-editor-block-id]") as unknown as Element;

  assert.equal(visibleBlockText(softbreak), "This uses most:emphasis");

  const { document: preDocument } = parseHTML(
    `<div data-editor-block-id="b1"><pre><span>a</span>\n<span>b</span></pre></div>`,
  );
  const pre = preDocument.querySelector("[data-editor-block-id]") as unknown as Element;

  assert.equal(visibleBlockText(pre), "ab");
});
