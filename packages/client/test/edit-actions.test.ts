import { test } from "node:test";
import assert from "node:assert/strict";
import { parseHTML } from "linkedom";

import {
  EDIT_TRIGGER_ACTIONS,
  clickFollowsPointer,
  mountEditActions,
  renderKeyboardReference,
} from "../src/features/editor/edit_actions.js";
import { SHORTCUT_ACTIONS } from "../src/features/shortcuts/shortcuts.js";

function shell({ palettes = ["snippet", "link", "math", "diagram"], media = true } = {}) {
  const paletteTargets: Record<string, string> = {
    snippet: "snippet-palette",
    link: "document-link-palette",
    math: "math-shortcut-palette",
    diagram: "mermaid-assist",
  };
  const paletteDivs = palettes
    .map((id) => `<div data-${paletteTargets[id]}-target="palette" hidden></div>`)
    .join("");
  const { document } = parseHTML(
    `<form><div class="source-field"><div class="editor-toolbar"></div>` +
      `<button type="button" data-editor-view-target="mediaButton"${media ? "" : " disabled"}>Add image</button>` +
      `${paletteDivs}</div></form>`,
  );
  return document.querySelector(".source-field") as HTMLElement;
}

function fakeEditor({ mode = "visual", value = "Hello", caret = 5 } = {}) {
  const calls = { replaceRange: [] as Array<[string, number, number]>, focus: 0 };
  const editor = {
    value,
    selectionStart: caret,
    selectionEnd: caret,
    editingMode: mode,
    replaceRange(insert: string, from: number, to: number) {
      calls.replaceRange.push([insert, from, to]);
      editor.value = editor.value.slice(0, from) + insert + editor.value.slice(to);
      editor.selectionStart = editor.selectionEnd = from + insert.length;
    },
    focus() {
      calls.focus += 1;
    },
  };
  return { editor, calls };
}

function fakeHost() {
  const calls = { inserts: [] as Array<{ from: number; to: number; insert: string; caret: number }> };
  return {
    calls,
    host: {
      applyVisualAssistInsert: (edit: { from: number; to: number; insert: string; caret: number }) => {
        calls.inserts.push(edit);
        return true;
      },
    },
  };
}

// linkedom dispatches only its own events: build test-side input with
// createEvent like the other client suites. Client modules emit native
// CustomEvents (browser-correct), so capture those with a dispatch stub.
function mouseEvent(document: Document, type: string): Event {
  const event = document.createEvent("Event") as unknown as Event & {
    initEvent: (type: string, bubbles: boolean, cancelable: boolean) => void;
  };
  event.initEvent(type, true, true);
  return event;
}

function captureDispatched(field: HTMLElement) {
  const emitted: Array<{ type: string; bubbles: boolean; detail: unknown }> = [];
  (field as unknown as { dispatchEvent: unknown }).dispatchEvent = (event: {
    type: string;
    bubbles: boolean;
    detail: unknown;
  }) => {
    emitted.push({ type: event.type, bubbles: event.bubbles, detail: event.detail });
    return true;
  };
  return emitted;
}

function activeRow(mount: { root: HTMLElement }, row: string): HTMLElement {
  return mount.root.querySelector(`[data-edit-actions-row="${row}"]`) as HTMLElement;
}

test("the menu lists every available trigger with its keyboard chip", () => {
  const field = shell({});
  const { editor } = fakeEditor();
  const mounted = mountEditActions({ field, getEditor: () => editor });
  assert.ok(mounted);

  const rows = [...mounted.root.querySelectorAll("[data-edit-actions-row]")];
  const triggers = rows.map((row) => row.getAttribute("data-edit-actions-row"));
  assert.deepEqual(triggers, [
    "trigger:snippet",
    "trigger:link",
    "trigger:math",
    "trigger:diagram",
    "media",
    "keyboard-shortcuts",
  ]);
  for (const action of EDIT_TRIGGER_ACTIONS) {
    const row = activeRow(mounted, `trigger:${action.id}`);
    assert.equal(row?.querySelector("kbd")?.textContent, action.trigger);
  }
  mounted.dispose();
  assert.equal(field.querySelector(".edit-actions"), null);
});

test("rows without a palette element stay out of the menu", () => {
  const field = shell({ palettes: ["snippet"], media: false });
  const { editor } = fakeEditor();
  const mounted = mountEditActions({ field, getEditor: () => editor });
  assert.ok(mounted);

  const rows = [...mounted.root.querySelectorAll("[data-edit-actions-row]")].map((row) =>
    row.getAttribute("data-edit-actions-row"),
  );
  assert.deepEqual(rows, ["trigger:snippet", "keyboard-shortcuts"]);
  mounted.dispose();
});

test("a source trigger insert commits, focuses the engine, and refreshes palettes", () => {
  const field = shell({});
  const { editor, calls } = fakeEditor({ mode: "source", value: "Hello", caret: 5 });
  const { calls: hostCalls, host } = fakeHost();
  const emitted = captureDispatched(field);
  const mounted = mountEditActions({ field, getEditor: () => editor, host });
  assert.ok(mounted);

  activeRow(mounted, "trigger:snippet").dispatchEvent(
    mouseEvent(field.ownerDocument, "mousedown"),
  );

  assert.deepEqual(calls.replaceRange, [["/", 5, 5]]);
  assert.equal(editor.value, "Hello/");
  assert.equal(calls.focus, 1);
  assert.deepEqual(hostCalls.inserts, []);
  assert.deepEqual(emitted, [
    { type: "elef:assist-trigger-inserted", bubbles: true, detail: { trigger: "/" } },
  ]);
  mounted.dispose();
});

test("a visual trigger insert pipelines through the host without focusing the engine", () => {
  const field = shell({});
  const { editor, calls } = fakeEditor({ mode: "visual", value: "Hello", caret: 5 });
  const { calls: hostCalls, host } = fakeHost();
  captureDispatched(field);
  const mounted = mountEditActions({ field, getEditor: () => editor, host });
  assert.ok(mounted);

  activeRow(mounted, "trigger:link").dispatchEvent(
    mouseEvent(field.ownerDocument, "mousedown"),
  );

  assert.deepEqual(calls.replaceRange, [["[[", 5, 5]]);
  assert.deepEqual(hostCalls.inserts, [{ from: 5, to: 5, insert: "[[", caret: 7 }]);
  assert.equal(calls.focus, 0);
  mounted.dispose();
});

test("keyboard activation runs through the click path", () => {
  const field = shell({});
  const { editor, calls } = fakeEditor({ mode: "source", value: "Hi", caret: 2 });
  captureDispatched(field);
  const mounted = mountEditActions({ field, getEditor: () => editor });
  assert.ok(mounted);

  activeRow(mounted, "trigger:math").dispatchEvent(mouseEvent(field.ownerDocument, "click"));
  assert.deepEqual(calls.replaceRange, [["@", 2, 2]]);
  mounted.dispose();
});

test("pointer clicks after mousedown never run a row twice", () => {
  // linkedom cannot produce a detail >= 1 click, so the guard itself is a
  // tested unit: browsers always report the click count there.
  assert.equal(clickFollowsPointer({ detail: 0 }), false);
  assert.equal(clickFollowsPointer({}), false);
  assert.equal(clickFollowsPointer({ detail: 1 }), true);
  assert.equal(clickFollowsPointer({ detail: 2 }), true);
});

test("the media row clicks the shell media button", () => {
  const field = shell({ media: true });
  const { editor } = fakeEditor();
  let clicked = 0;
  field.querySelector('[data-editor-view-target="mediaButton"]')?.addEventListener("click", () => {
    clicked += 1;
  });
  const mounted = mountEditActions({ field, getEditor: () => editor });
  assert.ok(mounted);

  activeRow(mounted, "media").dispatchEvent(mouseEvent(field.ownerDocument, "mousedown"));
  assert.equal(clicked, 1);
  mounted.dispose();
});

test("the reference row opens the keyboard reference dialog", () => {
  const field = shell({});
  const { editor } = fakeEditor();
  const mounted = mountEditActions({ field, getEditor: () => editor, platform: "mac" });
  assert.ok(mounted);

  activeRow(mounted, "keyboard-shortcuts").dispatchEvent(
    mouseEvent(field.ownerDocument, "mousedown"),
  );

  const dialog = mounted.root.querySelector("dialog.keyboard-reference") as HTMLElement;
  assert.equal(dialog.hasAttribute("open"), true);
  assert.match(dialog.innerHTML, /Save current work/);
  assert.match(dialog.innerHTML, /⌘S/);
  mounted.dispose();
});

test("the reference renders every registry action plus the editor triggers", () => {
  const html = renderKeyboardReference("other");
  for (const action of SHORTCUT_ACTIONS) {
    assert.match(html, new RegExp(action.label.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")), `missing ${action.id}`);
  }
  for (const trigger of ["[[", "@", "/diagram", "Enter / Tab"]) {
    assert.ok(html.includes(trigger), `missing ${trigger}`);
  }
  assert.ok(html.includes("Ctrl+S"));
});
