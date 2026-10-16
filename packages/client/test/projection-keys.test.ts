import { test } from "node:test";
import assert from "node:assert/strict";
import {
  routeProjectionKeymapKey,
  routeProjectionVimKey,
} from "../src/session/projection_keys.js";
import type {
  ProjectionKeyEditor,
  ProjectionKeyEventLike,
  ProjectionKeyHost,
} from "../src/session/projection_keys.js";

function keyEvent(key: string, overrides: Partial<ProjectionKeyEventLike> = {}) {
  const event = {
    key,
    isComposing: false,
    altKey: false,
    ctrlKey: false,
    metaKey: false,
    shiftKey: false,
    defaultPrevented: false,
    preventDefault: () => {
      event.defaultPrevented = true;
    },
    ...overrides,
  };
  return event;
}

function stubEditor(overrides: Record<string, unknown> = {}) {
  const state = {
    value: "hello",
    selectionStart: 0,
    selectionEnd: 0,
    selectionHead: 0,
    selectionRangeCount: 1,
    vimEnabled: true,
    insertMode: false,
    vimCalls: [] as string[],
    keymapCalls: [] as string[],
    rangesSet: [] as Array<[number, number]>,
    setSelectionRange(anchor: number, head: number = anchor) {
      state.rangesSet.push([anchor, head]);
      state.selectionStart = Math.min(anchor, head);
      state.selectionEnd = Math.max(anchor, head);
      state.selectionHead = head;
      state.selectionRangeCount = 1;
    },
    handleVimKey: (event: ProjectionKeyEventLike) => {
      state.vimCalls.push(event.key);
      return true;
    },
    runKeymap: (event: ProjectionKeyEventLike) => {
      state.keymapCalls.push(event.key);
      return false;
    },
    ...overrides,
  };
  return state as unknown as ProjectionKeyEditor & {
    vimCalls: string[];
    keymapCalls: string[];
    rangesSet: Array<[number, number]>;
    handleVimKey: (event: ProjectionKeyEventLike) => boolean;
    runKeymap: (event: ProjectionKeyEventLike) => boolean;
  };
}

function stubHost(editor: ProjectionKeyEditor | null) {
  const host = {
    editorController: editor,
    pendingProjectionEdits: null as { readonly size: number } | null,
    pendingCaretRestore: null as { sourceOffset: number; preferredBlockId: string | null } | null,
    suppressProjectionInput: false,
    suppressedDuringDispatch: null as boolean | null,
    flushed: 0,
    restored: [] as Array<[number, string | null]>,
    dispatched: [] as string[],
    flushPendingProjectionEdits: () => {
      host.flushed += 1;
    },
    restoreCaret: (sourceOffset: number, preferredBlockId: string | null) => {
      host.restored.push([sourceOffset, preferredBlockId]);
      return true;
    },
    block: null as unknown as Element,
  };
  host.block = {
    contentEditable: "true",
    dataset: { editorBlockId: "b1" },
    dispatchEvent: (event: { type: string }) => {
      host.suppressedDuringDispatch = host.suppressProjectionInput;
      host.dispatched.push(event.type);
      return true;
    },
  } as unknown as Element;
  return host as unknown as ProjectionKeyHost & {
    flushed: number;
    restored: Array<[number, string | null]>;
    dispatched: string[];
    suppressedDuringDispatch: boolean | null;
    block: Element;
  };
}

// Vim routing.

test("Vim routing declines without an editor, Vim, or an editable block", () => {
  assert.equal(routeProjectionVimKey(stubHost(null), keyEvent("j"), stubHost(null).block), false);

  const disabled = stubEditor({ vimEnabled: false });
  const disabledHost = stubHost(disabled);
  assert.equal(routeProjectionVimKey(disabledHost, keyEvent("j"), disabledHost.block), false);
  assert.deepEqual(disabled.vimCalls, []);

  const host = stubHost(stubEditor());
  const readonly = { ...host.block, contentEditable: "false" } as unknown as Element;
  assert.equal(routeProjectionVimKey(host, keyEvent("j"), readonly), false);
});

test("Vim routing skips composition and clipboard copy", () => {
  for (const event of [
    keyEvent("j", { isComposing: true }),
    keyEvent("c", { ctrlKey: true }),
    keyEvent("c", { metaKey: true }),
    keyEvent("C", { ctrlKey: true, shiftKey: false }),
  ]) {
    const editor = stubEditor();
    const host = stubHost(editor);
    assert.equal(routeProjectionVimKey(host, event, host.block), false);
    assert.deepEqual(editor.vimCalls, []);
    assert.equal(event.defaultPrevented, false);
  }
});

test("insert mode keeps plain typing native but sends Escape and modified keys to Vim", () => {
  const editor = stubEditor({ insertMode: true });
  const host = stubHost(editor);
  assert.equal(routeProjectionVimKey(host, keyEvent("j"), host.block), false);
  assert.deepEqual(editor.vimCalls, []);

  const escape = keyEvent("Escape");
  assert.equal(routeProjectionVimKey(host, escape, host.block), true);
  const modified = keyEvent("r", { ctrlKey: true });
  assert.equal(routeProjectionVimKey(host, modified, host.block), true);
  assert.deepEqual(editor.vimCalls, ["Escape", "r"]);
});

test("handled Vim keys preventDefault and follow with the caret", () => {
  const editor = stubEditor({ selectionHead: 4 });
  const host = stubHost(editor);
  const event = keyEvent("l");

  assert.equal(routeProjectionVimKey(host, event, host.block), true);
  assert.equal(event.defaultPrevented, true);
  assert.deepEqual(host.restored, [[4, "b1"]]);
  assert.deepEqual(host.dispatched, []);
  assert.equal(host.pendingCaretRestore, null);
});

test("source-changing Vim commands schedule a refresh with caret restoration", () => {
  const editor = stubEditor();
  editor.handleVimKey = () => {
    (editor as unknown as { value: string }).value = "changed";
    (editor as unknown as { selectionHead: number }).selectionHead = 3;
    return true;
  };
  const host = stubHost(editor);

  assert.equal(routeProjectionVimKey(host, keyEvent("x"), host.block), true);
  assert.deepEqual(host.pendingCaretRestore, { sourceOffset: 3, preferredBlockId: "b1" });
  assert.deepEqual(host.dispatched, ["input"]);
});

test("multi-range Vim outcomes collapse to the main head", () => {
  const editor = stubEditor({ selectionHead: 4 });
  editor.handleVimKey = () => {
    (editor as unknown as { selectionRangeCount: number }).selectionRangeCount = 3;
    return true;
  };
  const host = stubHost(editor);

  assert.equal(routeProjectionVimKey(host, keyEvent("v"), host.block), true);
  assert.deepEqual(editor.rangesSet, [[4, 4]]);
  assert.deepEqual(host.restored, [[4, "b1"]]);
});

test("declined plain Vim keys swallow except navigation", () => {
  const editor = stubEditor();
  editor.handleVimKey = () => false;
  const host = stubHost(editor);

  const swallowed = keyEvent("j");
  assert.equal(routeProjectionVimKey(host, swallowed, host.block), true);
  assert.equal(swallowed.defaultPrevented, true);

  const arrow = keyEvent("ArrowLeft");
  assert.equal(routeProjectionVimKey(host, arrow, host.block), false);
  assert.equal(arrow.defaultPrevented, false);
});

test("declined modified Vim keys fall through to the shared keymap", () => {
  const editor = stubEditor();
  editor.handleVimKey = (event) => {
    editor.vimCalls.push(event.key);
    return false;
  };
  const host = stubHost(editor);

  const event = keyEvent("r", { ctrlKey: true });
  assert.equal(routeProjectionVimKey(host, event, host.block), false);
  assert.deepEqual(editor.vimCalls, ["r"]);
  assert.equal(event.defaultPrevented, false);
});

test("Vim routing flushes pending projection edits first", () => {
  const host = stubHost(stubEditor());
  host.pendingProjectionEdits = { size: 2 };
  assert.equal(routeProjectionVimKey(host, keyEvent("j"), host.block), true);
  assert.equal(host.flushed, 1);
});

// Shared keymap routing.

test("keymap routing declines without an editor, an editable block, or outside composition", () => {
  assert.equal(routeProjectionKeymapKey(stubHost(null), keyEvent("z", { metaKey: true }), stubHost(null).block), false);

  const host = stubHost(stubEditor());
  const readonly = { ...host.block, contentEditable: "false" } as unknown as Element;
  assert.equal(routeProjectionKeymapKey(host, keyEvent("z", { metaKey: true }), readonly), false);

  const editor = stubEditor();
  const composingHost = stubHost(editor);
  assert.equal(
    routeProjectionKeymapKey(composingHost, keyEvent("z", { metaKey: true, isComposing: true }), composingHost.block),
    false,
  );
  assert.deepEqual(editor.keymapCalls, []);
});

test("plain caret and structural keys never reach the shared keymap", () => {
  for (const key of ["a", "Enter", "Backspace", "Delete", "ArrowLeft", "ArrowUp", "Escape", "Home"]) {
    const editor = stubEditor();
    const host = stubHost(editor);
    assert.equal(routeProjectionKeymapKey(host, keyEvent(key), host.block), false);
    assert.deepEqual(editor.keymapCalls, []);
  }
});

test("Alt combinations route through the shared keymap", () => {
  const editor = stubEditor({ selectionHead: 6 });
  editor.runKeymap = (event) => {
    editor.keymapCalls.push(event.key);
    return true;
  };
  const host = stubHost(editor);
  const event = keyEvent("ArrowUp", { altKey: true });

  assert.equal(routeProjectionKeymapKey(host, event, host.block), true);
  assert.deepEqual(editor.keymapCalls, ["ArrowUp"]);
  assert.equal(event.defaultPrevented, true);
  assert.deepEqual(host.restored, [[6, "b1"]]);
});

test("unbound Alt combinations fall through to native input", () => {
  const editor = stubEditor();
  const host = stubHost(editor);
  const event = keyEvent("e", { altKey: true });

  assert.equal(routeProjectionKeymapKey(host, event, host.block), false);
  assert.deepEqual(editor.keymapCalls, ["e"]);
  assert.equal(event.defaultPrevented, false);
});

test("multi-range keymap outcomes collapse to the main head", () => {
  const editor = stubEditor({ selectionHead: 4 });
  editor.runKeymap = () => {
    (editor as unknown as { selectionRangeCount: number }).selectionRangeCount = 2;
    return true;
  };
  const host = stubHost(editor);

  assert.equal(routeProjectionKeymapKey(host, keyEvent("ArrowUp", { metaKey: true, altKey: true }), host.block), true);
  assert.deepEqual(editor.rangesSet, [[4, 4]]);
  assert.deepEqual(host.restored, [[4, "b1"]]);
});

test("panel-anchored shortcuts stay native", () => {
  const events = [
    keyEvent("f", { metaKey: true }),
    keyEvent("f", { ctrlKey: true }),
    keyEvent("g", { metaKey: true }),
    keyEvent("g", { metaKey: true, altKey: true }),
    keyEvent(" ", { ctrlKey: true }),
  ];
  for (const event of events) {
    const editor = stubEditor();
    const host = stubHost(editor);
    assert.equal(routeProjectionKeymapKey(host, event, host.block), false);
    assert.deepEqual(editor.keymapCalls, []);
  }
});

test("unhandled shortcuts fall through without preventDefault", () => {
  const editor = stubEditor();
  const host = stubHost(editor);
  const event = keyEvent("t", { metaKey: true });

  assert.equal(routeProjectionKeymapKey(host, event, host.block), false);
  assert.deepEqual(editor.keymapCalls, ["t"]);
  assert.equal(event.defaultPrevented, false);
});

test("handled shortcuts preventDefault and follow with the caret", () => {
  const editor = stubEditor({ selectionHead: 2 });
  editor.runKeymap = () => true;
  const host = stubHost(editor);
  const event = keyEvent("z", { metaKey: true });

  assert.equal(routeProjectionKeymapKey(host, event, host.block), true);
  assert.equal(event.defaultPrevented, true);
  assert.deepEqual(host.restored, [[2, "b1"]]);
  assert.deepEqual(host.dispatched, []);
});

test("Tab runs through the shared keymap", () => {
  const editor = stubEditor({ selectionHead: 5 });
  editor.runKeymap = (event) => {
    editor.keymapCalls.push(event.key);
    return true;
  };
  const host = stubHost(editor);

  assert.equal(routeProjectionKeymapKey(host, keyEvent("Tab"), host.block), true);
  assert.deepEqual(editor.keymapCalls, ["Tab"]);
  assert.deepEqual(host.restored, [[5, "b1"]]);
});

test("refresh dispatches suppress input reconciliation while stale", () => {
  const editor = stubEditor();
  editor.runKeymap = () => {
    (editor as unknown as { value: string }).value = "undone";
    return true;
  };
  const host = stubHost(editor);

  assert.equal(routeProjectionKeymapKey(host, keyEvent("z", { metaKey: true }), host.block), true);
  assert.equal(host.suppressedDuringDispatch, true);
  assert.equal(host.suppressProjectionInput, false);
});

test("source-changing shortcuts schedule a refresh with caret restoration", () => {
  const editor = stubEditor();
  editor.runKeymap = () => {
    (editor as unknown as { value: string }).value = "undone";
    (editor as unknown as { selectionHead: number }).selectionHead = 1;
    return true;
  };
  const host = stubHost(editor);

  assert.equal(routeProjectionKeymapKey(host, keyEvent("z", { metaKey: true }), host.block), true);
  assert.deepEqual(host.pendingCaretRestore, { sourceOffset: 1, preferredBlockId: "b1" });
  assert.deepEqual(host.dispatched, ["input"]);
});

test("ranged keymap outcomes restore the prior selection and keep native behavior", () => {
  const editor = stubEditor({ selectionStart: 2, selectionEnd: 2, selectionHead: 2 });
  editor.runKeymap = () => {
    editor.setSelectionRange(0, 5);
    return true;
  };
  const host = stubHost(editor);
  const event = keyEvent("a", { metaKey: true });

  assert.equal(routeProjectionKeymapKey(host, event, host.block), false);
  assert.equal(event.defaultPrevented, false);
  assert.deepEqual(editor.rangesSet, [[0, 5], [2, 2]]);
  assert.deepEqual(host.restored, []);
});

test("ranged keymap outcomes preserve reversed selections when restoring", () => {
  const editor = stubEditor({ selectionStart: 5, selectionEnd: 9, selectionHead: 5 });
  editor.runKeymap = () => {
    editor.setSelectionRange(0, 5);
    return true;
  };
  const host = stubHost(editor);

  assert.equal(routeProjectionKeymapKey(host, keyEvent("a", { metaKey: true }), host.block), false);
  assert.deepEqual(editor.rangesSet, [[0, 5], [9, 5]]);
});

test("occurrence selection swallows instead of opening the bookmark dialog", () => {
  const editor = stubEditor({ selectionStart: 2, selectionEnd: 2, selectionHead: 2 });
  editor.runKeymap = () => {
    editor.setSelectionRange(2, 5);
    return true;
  };
  const host = stubHost(editor);
  const event = keyEvent("d", { ctrlKey: true });

  assert.equal(routeProjectionKeymapKey(host, event, host.block), true);
  assert.equal(event.defaultPrevented, true);
  assert.deepEqual(editor.rangesSet, [[2, 5], [5, 5]]);
  assert.deepEqual(host.restored, [[5, "b1"]]);
});

test("keymap routing flushes pending projection edits first", () => {
  const editor = stubEditor();
  editor.runKeymap = () => true;
  const host = stubHost(editor);
  host.pendingProjectionEdits = { size: 1 };
  assert.equal(routeProjectionKeymapKey(host, keyEvent("z", { metaKey: true }), host.block), true);
  assert.equal(host.flushed, 1);
});
