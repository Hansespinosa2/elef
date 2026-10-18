import { test } from "node:test";
import assert from "node:assert/strict";
import { EditorEngine } from "../src/features/editor/engine.js";

// runKeymap guards: routing a shortcut through the engine keymap needs a
// live view. Command-level behavior runs through the real keymap and is
// covered by the browser suites on both hosts.
function run(double: Record<string, unknown>): boolean {
  return EditorEngine.prototype.runKeymap.call(double as unknown as EditorEngine, {
    key: "z",
    ctrlKey: false,
    altKey: false,
    metaKey: true,
    shiftKey: false,
  });
}

test("keymap routing declines without a live engine view", () => {
  assert.equal(run({ destroyed: true, view: {} }), false);
  assert.equal(run({ destroyed: false, view: null }), false);
});

test("an assist-consumed proxy Tab is never replayed into CodeMirror", () => {
  let focused = 0;
  const editor = {
    value: "[[Research target]]",
    inputTarget: { value: "[[Research target]]", selectionStart: 19, selectionEnd: 19 },
    normalizeLineEndings: (value: string) => value,
    setSelectionRange() {},
    focus() { focused += 1; },
    view: { contentDOM: { dispatchEvent() { assert.fail("consumed Tab reached CodeMirror"); } } },
  };
  // The palette accepts the original textarea event during document
  // capture. Its source insertion has landed before the proxy's listener.
  const event = Object.assign(new Event("keydown", { cancelable: true }), { key: "Tab" });
  event.preventDefault();

  EditorEngine.prototype.forwardProxyKeydown.call(editor as unknown as EditorEngine, event as KeyboardEvent);

  assert.equal(focused, 0);
  assert.equal(editor.value, "[[Research target]]");
});
