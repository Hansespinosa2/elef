import { test } from "node:test";
import assert from "node:assert/strict";
import { parseHTML } from "linkedom";

import { EditorEngine } from "../src/features/editor/engine.js";

interface Harness {
  engine: EditorEngine;
  block: Element;
  selection: {
    anchorNode: unknown;
    anchorOffset: number;
    focusNode: unknown;
    focusOffset: number;
  };
  flushRaf: () => void;
}

function withHarness(run: (harness: Harness) => void) {
  const { document } = parseHTML(
    `<form><div class="editor-projection">` +
      `<div class="document-editor-block" data-editor-block-id="b1"><p>See docs now.</p></div>` +
      `</div></form>`,
  );
  const view = (document as unknown as { defaultView: Record<string, unknown> }).defaultView;
  const form = document.querySelector("form") as unknown as HTMLElement;
  const block = document.querySelector(".document-editor-block") as unknown as Element;
  const text = document.querySelector("p")?.firstChild ?? null;

  const engine = new EditorEngine(form);
  engine.editingMode = "visual";
  engine.form = form;
  engine.projectionNavigationOccurred = false;
  engine.pendingProjectionInteraction = null;
  Object.defineProperty(engine, "value", { value: "See docs now.", configurable: true });

  const selection = { anchorNode: text, anchorOffset: 0, focusNode: text, focusOffset: 0 };
  const rafs: FrameRequestCallback[] = [];
  const saved = new Map<string, PropertyDescriptor | undefined>();
  for (const key of ["window", "document", "Element", "KeyboardEvent", "requestAnimationFrame"]) {
    saved.set(key, Object.getOwnPropertyDescriptor(globalThis, key));
  }
  class TestKeyboardEvent {}
  Object.defineProperty(globalThis, "window", {
    configurable: true, writable: true, value: { getSelection: () => selection },
  });
  Object.defineProperty(globalThis, "document", { configurable: true, writable: true, value: document });
  Object.defineProperty(globalThis, "Element", { configurable: true, writable: true, value: view.Element });
  Object.defineProperty(globalThis, "KeyboardEvent", { configurable: true, writable: true, value: TestKeyboardEvent });
  Object.defineProperty(globalThis, "requestAnimationFrame", {
    configurable: true, writable: true, value: (callback: FrameRequestCallback) => { rafs.push(callback); return rafs.length; },
  });
  try {
    run({
      engine,
      block,
      selection,
      flushRaf: () => { while (rafs.length) rafs.shift()?.(0); },
    });
  } finally {
    for (const [key, descriptor] of saved) {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor);
      else delete (globalThis as Record<string, unknown>)[key];
    }
  }
}

function inputEvent(target: Element, isTrusted: boolean): Event {
  return { type: "input", target, isTrusted } as unknown as Event;
}

function keyEvent(target: Element, key: string, overrides: Record<string, unknown> = {}): Event {
  const event = { type: "keydown", key, target, ctrlKey: false, metaKey: false, ...overrides };
  const keyboardEvent = (globalThis as Record<string, unknown>).KeyboardEvent as { prototype: object };
  Object.setPrototypeOf(event, keyboardEvent.prototype);
  return event as unknown as Event;
}

test("synthetic input does not mark projection navigation", () => {
  withHarness(({ engine, block }) => {
    // Engine-driven visual keys dispatch an untrusted input while the
    // block DOM still shows old text; trusting it would read the lossy
    // native caret over the exact engine head at the next mode switch.
    engine.noteProjectionNavigation(inputEvent(block, false));
    assert.equal(engine.projectionNavigationOccurred, false);
  });
});

test("trusted input marks projection navigation", () => {
  withHarness(({ engine, block }) => {
    engine.noteProjectionNavigation(inputEvent(block, true));
    assert.equal(engine.projectionNavigationOccurred, true);
  });
});

test("Tab snapshots the selection for navigation tracking", () => {
  withHarness(({ engine, block }) => {
    engine.noteProjectionNavigation(keyEvent(block, "Tab"));
    // Compare a boolean: asserting on the snapshot object would hand
    // linkedom nodes to util.inspect on failure, which exhausts memory.
    assert.equal(engine.pendingProjectionInteraction !== null, true);
  });
});

test("Tab marks navigation only when the selection actually moved", () => {
  withHarness(({ engine, block, selection, flushRaf }) => {
    engine.noteProjectionNavigation(keyEvent(block, "Tab"));
    flushRaf();
    assert.equal(engine.projectionNavigationOccurred, false);

    engine.noteProjectionNavigation(keyEvent(block, "Tab"));
    selection.focusOffset = 3;
    flushRaf();
    assert.equal(engine.projectionNavigationOccurred, true);
  });
});

test("non-navigation keys still skip the snapshot", () => {
  withHarness(({ engine, block }) => {
    engine.noteProjectionNavigation(keyEvent(block, "x"));
    // Boolean comparison for the same util.inspect reason as above.
    assert.equal(engine.pendingProjectionInteraction === null, true);
    assert.equal(engine.projectionNavigationOccurred, false);
  });
});
