import { test } from "node:test";
import assert from "node:assert/strict";
import { parseHTML } from "linkedom";
import {
  translateProjectionInput,
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

test("visible block text excludes screen-reader and hidden runs", () => {
  const { document } = parseHTML(
    `<div data-editor-block-id="b1">E<span class="katex-mathml">E = mc^2</span><span aria-hidden="true">×</span></div>`,
  );
  const block = document.querySelector("[data-editor-block-id]") as unknown as Element;

  assert.equal(visibleBlockText(block), "E");
});
