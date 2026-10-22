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
    restoredRanges: [] as Array<[number, number, string | null]>,
    selectionsRestored: 0,
    dispatched: [] as string[],
    flushPendingProjectionEdits: () => {
      host.flushed += 1;
    },
    restoreCaret: (sourceOffset: number, preferredBlockId: string | null) => {
      host.restored.push([sourceOffset, preferredBlockId]);
      return true;
    },
    restoreSelection: (anchor: number, head: number, preferredBlockId: string | null) => {
      host.restoredRanges.push([anchor, head, preferredBlockId]);
      return true;
    },
    refreshVimNormalCaret: () => {},
    restoreSelections: () => {
      host.selectionsRestored += 1;
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
    restoredRanges: Array<[number, number, string | null]>;
    selectionsRestored: number;
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

test("multi-range Vim outcomes survive and repaint on the projection", () => {
  const editor = stubEditor({ selectionHead: 4 });
  editor.handleVimKey = () => {
    (editor as unknown as { selectionRangeCount: number }).selectionRangeCount = 3;
    return true;
  };
  const host = stubHost(editor);

  assert.equal(routeProjectionVimKey(host, keyEvent("v"), host.block), true);
  assert.deepEqual(editor.rangesSet, []);
  assert.deepEqual(host.restored, [[4, "b1"]]);
  assert.equal(host.selectionsRestored, 1);
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

test("multi-range keymap outcomes survive and repaint on the projection", () => {
  const editor = stubEditor({ selectionHead: 4 });
  editor.runKeymap = () => {
    (editor as unknown as { selectionRangeCount: number }).selectionRangeCount = 2;
    return true;
  };
  const host = stubHost(editor);

  assert.equal(routeProjectionKeymapKey(host, keyEvent("ArrowUp", { metaKey: true, altKey: true }), host.block), true);
  assert.deepEqual(editor.rangesSet, []);
  assert.deepEqual(host.restored, [[4, "b1"]]);
  assert.equal(host.selectionsRestored, 1);
});

test("multi-range structural keys route through the shared keymap", () => {
  for (const key of ["Backspace", "Delete", "Enter"]) {
    const editor = stubEditor({ selectionHead: 4, selectionRangeCount: 2, runKeymap: () => true });
    const host = stubHost(editor);
    assert.equal(routeProjectionKeymapKey(host, keyEvent(key), host.block), true);
    assert.deepEqual(host.restored, [[4, "b1"]]);
  }

  const editor = stubEditor({ selectionHead: 4 });
  editor.runKeymap = () => true;
  const host = stubHost(editor);
  assert.equal(routeProjectionKeymapKey(host, keyEvent("Backspace"), host.block), false);
});

test("panel and completion shortcuts use the engine keymap", () => {
  const events = [
    keyEvent("f", { metaKey: true }),
    keyEvent("f", { ctrlKey: true }),
    keyEvent("g", { metaKey: true }),
    keyEvent("g", { metaKey: true, altKey: true }),
    keyEvent(" ", { ctrlKey: true }),
  ];
  for (const event of events) {
    const editor = stubEditor({ runKeymap: () => true });
    const host = stubHost(editor);
    assert.equal(routeProjectionKeymapKey(host, event, host.block), true);
    assert.equal(event.defaultPrevented, true);
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

test("ranged keymap outcomes paint the engine range on the projection", () => {
  const editor = stubEditor({ selectionStart: 2, selectionEnd: 2, selectionHead: 2 });
  editor.runKeymap = () => {
    editor.setSelectionRange(0, 5);
    return true;
  };
  const host = stubHost(editor);
  const event = keyEvent("a", { metaKey: true });

  assert.equal(routeProjectionKeymapKey(host, event, host.block), true);
  assert.equal(event.defaultPrevented, true);
  assert.deepEqual(editor.rangesSet, [[0, 5]]);
  assert.deepEqual(host.restored, [[5, "b1"]]);
  assert.deepEqual(host.restoredRanges, [[0, 5, "b1"]]);
  assert.equal(host.selectionsRestored, 1);
});

test("ranged keymap outcomes preserve reversed selections when painting", () => {
  const editor = stubEditor({ selectionStart: 5, selectionEnd: 9, selectionHead: 5 });
  editor.runKeymap = () => {
    editor.setSelectionRange(5, 0);
    return true;
  };
  const host = stubHost(editor);

  assert.equal(routeProjectionKeymapKey(host, keyEvent("a", { metaKey: true }), host.block), true);
  assert.deepEqual(editor.rangesSet, [[5, 0]]);
  assert.deepEqual(host.restored, [[0, "b1"]]);
  assert.deepEqual(host.restoredRanges, [[5, 0, "b1"]]);
});

test("occurrence selection routes through the engine keymap and paints", () => {
  const editor = stubEditor({ selectionStart: 2, selectionEnd: 2, selectionHead: 2 });
  editor.runKeymap = () => {
    editor.setSelectionRange(2, 5);
    return true;
  };
  const host = stubHost(editor);
  const event = keyEvent("d", { ctrlKey: true });

  assert.equal(routeProjectionKeymapKey(host, event, host.block), true);
  assert.equal(event.defaultPrevented, true);
  assert.deepEqual(editor.rangesSet, [[2, 5]]);
  assert.deepEqual(host.restored, [[5, "b1"]]);
  assert.deepEqual(host.restoredRanges, [[2, 5, "b1"]]);
  assert.equal(host.selectionsRestored, 1);
});

test("keymap routing flushes pending projection edits first", () => {
  const editor = stubEditor();
  editor.runKeymap = () => true;
  const host = stubHost(editor);
  host.pendingProjectionEdits = { size: 1 };
  assert.equal(routeProjectionKeymapKey(host, keyEvent("z", { metaKey: true }), host.block), true);
  assert.equal(host.flushed, 1);
});


test("opening an engine panel preserves its input focus", () => {
  const editor = stubEditor({ runKeymap: () => true, projectionPanelFocused: true });
  const host = stubHost(editor);
  const event = keyEvent("f", { ctrlKey: true });
  assert.equal(routeProjectionKeymapKey(host, event, host.block), true);
  assert.equal(event.defaultPrevented, true);
  assert.deepEqual(host.restored, []);
});

test("Vim routing syncs the engine selection from the native caret before handling", () => {
  const editor = stubEditor();
  const host = stubHost(editor) as unknown as ProjectionKeyHost & { syncs: number; syncEngineSelectionFromCaret: () => void };
  host.syncs = 0;
  host.syncEngineSelectionFromCaret = () => {
    host.syncs += 1;
  };
  assert.equal(routeProjectionVimKey(host, keyEvent("j"), (host as unknown as { block: Element }).block), true);
  assert.equal(host.syncs, 1);
  assert.deepEqual(editor.vimCalls, ["j"]);
});

test("cross-block motions drop the stale block preference", () => {
  const editor = stubEditor({ selectionHead: 11 });
  editor.handleVimKey = () => {
    (editor as unknown as { selectionHead: number }).selectionHead = 14;
    return true;
  };
  const host = stubHost(editor) as unknown as ProjectionKeyHost & {
    regionRangeForBlock: (blockId: string | null) => { start: number; end: number } | null;
  };
  host.regionRangeForBlock = () => ({ start: 0, end: 11 });
  assert.equal(routeProjectionVimKey(host, keyEvent("j"), (host as unknown as { block: Element }).block), true);
  assert.deepEqual((host as unknown as { restored: Array<[number, string | null]> }).restored, [[14, null]]);
});

test("table column adjustment preserves the Vim visual anchor", () => {
  const editor = stubEditor({ selectionHead: 4 });
  (editor as unknown as { value: string }).value = "|aaaa|b|\n|c|dd|\n";
  (editor as unknown as { selectionStart: number }).selectionStart = 2;
  (editor as unknown as { selectionEnd: number }).selectionEnd = 4;
  editor.handleVimKey = () => {
    (editor as unknown as { selectionHead: number }).selectionHead = 14;
    (editor as unknown as { selectionStart: number }).selectionStart = 2;
    (editor as unknown as { selectionEnd: number }).selectionEnd = 14;
    return true;
  };
  const host = stubHost(editor);
  assert.equal(routeProjectionVimKey(host, keyEvent("j"), (host as unknown as { block: Element }).block), true);
  const ranges = (editor as unknown as { rangesSet: Array<[number, number]> }).rangesSet;
  assert.deepEqual(ranges[ranges.length - 1], [2, 10]);
});

test("table column adjustment keeps normal-mode motions collapsed", () => {
  // Same engine landing as the visual-anchor case, but the selection was
  // collapsed at entry: the adjustment must not invent an anchor from the
  // raw line-wise landing (which would paint a phantom range and flip the
  // mode pill to visual).
  const editor = stubEditor({ selectionHead: 4, selectionStart: 4, selectionEnd: 4 });
  (editor as unknown as { value: string }).value = "|aaaa|b|\n|c|dd|\n";
  editor.handleVimKey = () => {
    (editor as unknown as { selectionHead: number }).selectionHead = 14;
    (editor as unknown as { selectionStart: number }).selectionStart = 14;
    (editor as unknown as { selectionEnd: number }).selectionEnd = 14;
    return true;
  };
  const host = stubHost(editor);
  assert.equal(routeProjectionVimKey(host, keyEvent("j"), (host as unknown as { block: Element }).block), true);
  const ranges = (editor as unknown as { rangesSet: Array<[number, number]> }).rangesSet;
  assert.deepEqual(ranges[ranges.length - 1], [10, 10]);
});

test("in-block motions keep the originating block preference", () => {
  const editor = stubEditor({ selectionHead: 4 });
  editor.handleVimKey = () => {
    (editor as unknown as { selectionHead: number }).selectionHead = 5;
    return true;
  };
  const host = stubHost(editor) as unknown as ProjectionKeyHost & {
    regionRangeForBlock: (blockId: string | null) => { start: number; end: number } | null;
  };
  host.regionRangeForBlock = () => ({ start: 0, end: 11 });
  assert.equal(routeProjectionVimKey(host, keyEvent("j"), (host as unknown as { block: Element }).block), true);
  assert.deepEqual((host as unknown as { restored: Array<[number, string | null]> }).restored, [[5, "b1"]]);
});

test("cross-block visual ranges drop the stale block preference", () => {
  // A visual motion that leaves the originating block must not pin the
  // painted range to it: forcing the origin preference strands the head
  // at the old block's edge, so vjj paints only the first block.
  const editor = stubEditor({ selectionHead: 2 });
  editor.handleVimKey = () => {
    (editor as unknown as { selectionHead: number }).selectionHead = 14;
    (editor as unknown as { selectionStart: number }).selectionStart = 2;
    (editor as unknown as { selectionEnd: number }).selectionEnd = 14;
    return true;
  };
  const host = stubHost(editor) as unknown as ProjectionKeyHost & {
    regionRangeForBlock: (blockId: string | null) => { start: number; end: number } | null;
    restoredRanges: Array<[number, number, string | null]>;
  };
  host.regionRangeForBlock = () => ({ start: 0, end: 11 });
  assert.equal(routeProjectionVimKey(host, keyEvent("j"), (host as unknown as { block: Element }).block), true);
  assert.deepEqual(host.restoredRanges, [[2, 14, null]]);
});

test("keymap ranges keep the originating block preference", () => {
  // Select-all style ranges stay bridge-consumable: the input bridge
  // replaces block-scoped native ranges, so the keymap path must not
  // drop the origin preference the way the Vim path does.
  const editor = stubEditor({ selectionHead: 2 });
  editor.runKeymap = () => {
    (editor as unknown as { selectionHead: number }).selectionHead = 14;
    (editor as unknown as { selectionStart: number }).selectionStart = 2;
    (editor as unknown as { selectionEnd: number }).selectionEnd = 14;
    return true;
  };
  const host = stubHost(editor) as unknown as ProjectionKeyHost & {
    regionRangeForBlock: (blockId: string | null) => { start: number; end: number } | null;
    restoredRanges: Array<[number, number, string | null]>;
  };
  host.regionRangeForBlock = () => ({ start: 0, end: 11 });
  assert.equal(routeProjectionKeymapKey(host, keyEvent("a", { metaKey: true }), (host as unknown as { block: Element }).block), true);
  assert.deepEqual(host.restoredRanges, [[2, 14, "b1"]]);
});
