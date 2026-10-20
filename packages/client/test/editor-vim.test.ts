import { test } from "node:test";
import assert from "node:assert/strict";
import { EditorEngine } from "../src/features/editor/engine.js";

// handleVimKey guards: the live-Vim path needs a bound Vim handle and view.
// Full key-to-command behavior runs through the real vim extension and is
// covered by the Vim system suites on both hosts.
function route(double: Record<string, unknown>, key = "j"): boolean {
  return EditorEngine.prototype.handleVimKey.call(
    double as unknown as EditorEngine,
    { key, ctrlKey: false, altKey: false, metaKey: false, shiftKey: false },
  );
}

test("visual Vim routing declines without a bound Vim handle", () => {
  assert.equal(route({ vim: null, destroyed: false, view: {} }), false);
  assert.equal(
    route({ vim: { state: {} }, destroyed: false, view: {} }),
    false,
  );
});

test("visual Vim routing declines when the engine is gone", () => {
  assert.equal(
    route({ vim: { state: { vim: {} } }, destroyed: true, view: {} }),
    false,
  );
  assert.equal(
    route({ vim: { state: { vim: {} } }, destroyed: false, view: null }),
    false,
  );
});
