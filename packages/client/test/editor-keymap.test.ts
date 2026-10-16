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
