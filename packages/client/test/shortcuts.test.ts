import { test } from "node:test";
import assert from "node:assert/strict";

import {
  PALETTE_ACTION_IDS,
  RESERVED_WEB_CHORDS,
  SHORTCUT_ACTIONS,
  chordDisplay,
  eventMatchesChord,
  shortcutById,
} from "../src/features/shortcuts/shortcuts.js";

function cmdEvent(key: string): {
  readonly key: string;
  readonly metaKey: boolean;
  readonly ctrlKey: boolean;
  readonly shiftKey: boolean;
  readonly altKey: boolean;
  readonly isComposing: boolean;
} {
  return { key, metaKey: true, ctrlKey: false, shiftKey: false, altKey: false, isComposing: false };
}

test("shortcut ids are unique", () => {
  const ids = SHORTCUT_ACTIONS.map((action) => action.id);
  assert.deepEqual([...new Set(ids)].sort(), [...ids].sort());
});

test("no two actions share a chord on the same host", () => {
  for (const host of ["webChord", "desktopChord"] as const) {
    const seen = new Map<string, string>();
    for (const action of SHORTCUT_ACTIONS) {
      const chord = action[host];
      if (chord === null) continue;
      const owner = seen.get(chord);
      assert.equal(
        owner,
        undefined,
        `${host} chord ${chord} is claimed by both ${owner} and ${action.id}`,
      );
      seen.set(chord, action.id);
    }
  }
});

test("no web chord collides with a browser-reserved chord", () => {
  const reserved = new Set(RESERVED_WEB_CHORDS);
  for (const action of SHORTCUT_ACTIONS) {
    if (action.webChord === null) continue;
    assert.equal(
      reserved.has(action.webChord),
      false,
      `web chord ${action.webChord} (${action.id}) is browser-reserved`,
    );
  }
});

test("every action is keyboard-reachable: chord or palette-listed", () => {
  for (const action of SHORTCUT_ACTIONS) {
    const reachable = action.webChord !== null || action.desktopChord !== null || action.palette;
    assert.equal(reachable, true, `${action.id} is neither chorded nor palette-listed`);
  }
});

test("every palette action carries a label and description", () => {
  for (const action of SHORTCUT_ACTIONS) {
    if (!action.palette) continue;
    assert.notEqual(action.label.trim(), "", `${action.id} palette label is empty`);
    assert.notEqual(action.description.trim(), "", `${action.id} palette description is empty`);
  }
});

test("palette id list matches the palette-flagged registry entries", () => {
  const expected = SHORTCUT_ACTIONS.filter((action) => action.palette).map((action) => action.id);
  assert.deepEqual([...PALETTE_ACTION_IDS].sort(), [...expected].sort());
});

test("new chords keep every pre-existing chord", () => {
  // Pre-existing web chords (command palette) and desktop menu chords must
  // survive: the registry only adds, never rebinds.
  assert.equal(shortcutById("open-commands")?.webChord, "cmdOrCtrl+k");
  assert.equal(shortcutById("quick-open")?.webChord, "cmdOrCtrl+p");
  assert.equal(shortcutById("save")?.desktopChord, "cmdOrCtrl+s");
  assert.equal(shortcutById("open-work")?.desktopChord, "cmdOrCtrl+o");
  assert.equal(shortcutById("new-presentation")?.desktopChord, "cmdOrCtrl+n");
  assert.equal(shortcutById("print")?.desktopChord, "cmdOrCtrl+p");
});

test("new document is palette-only with no direct chord", () => {
  const action = shortcutById("new-document");
  assert.notEqual(action, null);
  assert.equal(action?.webChord, null);
  assert.equal(action?.desktopChord, null);
  assert.equal(action?.palette, true);
});

test("keyboard shortcuts is palette-only and needs an editor", () => {
  const action = shortcutById("keyboard-shortcuts");
  assert.notEqual(action, null);
  assert.equal(action?.webChord, null);
  assert.equal(action?.desktopChord, null);
  assert.equal(action?.palette, true);
  assert.equal(action?.requiresEditor, true);
});

test("Cmd+S matches save and Cmd+Enter matches present", () => {
  assert.equal(eventMatchesChord(cmdEvent("s"), "cmdOrCtrl+s"), true);
  assert.equal(eventMatchesChord(cmdEvent("S"), "cmdOrCtrl+s"), true);
  assert.equal(eventMatchesChord(cmdEvent("Enter"), "cmdOrCtrl+Enter"), true);
  assert.equal(eventMatchesChord(cmdEvent("s"), "cmdOrCtrl+Enter"), false);
  // Unmodified keys never match a global chord: typing in the editor or a
  // Vim normal-mode motion must not trigger a global action.
  assert.equal(
    eventMatchesChord({ ...cmdEvent("s"), metaKey: false }, "cmdOrCtrl+s"),
    false,
  );
  // Alt combinations and IME compositions never match either.
  assert.equal(
    eventMatchesChord({ ...cmdEvent("s"), altKey: true }, "cmdOrCtrl+s"),
    false,
  );
  assert.equal(
    eventMatchesChord({ ...cmdEvent("s"), isComposing: true }, "cmdOrCtrl+s"),
    false,
  );
});

test("every global Cmd chord still matches with Vim mode enabled", () => {
  // Vim normal mode consumes unmodified keys; every registry chord requires
  // the Cmd/Ctrl modifier, so a Vim-enabled editor must not swallow one.
  // The matcher is Vim-agnostic on purpose: matching depends only on the
  // modifier plus key, never on editor mode. Palette fallback stays
  // available regardless (save and present are both palette-listed).
  for (const action of SHORTCUT_ACTIONS) {
    for (const chord of [action.webChord, action.desktopChord]) {
      if (chord === null) continue;
      const key = chord.split("+").pop() ?? "";
      const vimEnabledEvent = { ...cmdEvent(key), metaKey: true };
      assert.equal(
        eventMatchesChord(vimEnabledEvent, chord),
        true,
        `${action.id} chord ${chord} must fire with Vim mode enabled`,
      );
      if (action.webChord === chord) {
        // Web fallback: the command palette lists the action, so a swallowed
        // chord never strands the user. The palette itself is reachable
        // through its always-visible trigger button.
        assert.equal(action.palette || action.id === "open-commands", true,
          `${action.id} needs a palette fallback if a layer ever swallows ${chord}`);
      } else {
        // Desktop fallback: every desktop chord belongs to a native menu
        // item (menu bars stay keyboard-navigable), except search-focus,
        // which the Open Work menu covers (it shows the library and focuses
        // search).
        const menuCovered = ["save", "open-work", "new-presentation", "print", "desktop-search-focus"];
        assert.equal(menuCovered.includes(action.id), true,
          `${action.id} needs a native-menu fallback if a layer ever swallows ${chord}`);
      }
    }
  }
});

test("chord display follows the kbd-chip convention", () => {
  assert.equal(chordDisplay("cmdOrCtrl+s", "mac"), "⌘S");
  assert.equal(chordDisplay("cmdOrCtrl+s", "other"), "Ctrl+S");
  assert.equal(chordDisplay("cmdOrCtrl+Enter", "mac"), "⌘↵");
  assert.equal(chordDisplay("cmdOrCtrl+Enter", "other"), "Ctrl+↵");
  assert.equal(chordDisplay("cmdOrCtrl+k", "mac"), "⌘K");
  assert.equal(chordDisplay("cmdOrCtrl+p", "other"), "Ctrl+P");
});
