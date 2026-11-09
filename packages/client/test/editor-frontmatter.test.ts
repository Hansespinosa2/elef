import { test } from "node:test";
import assert from "node:assert/strict";
import { EditorSelection, EditorState, type TransactionSpec } from "@codemirror/state";
import { foldEffect, foldedRanges, foldState } from "@codemirror/language";
import { EditorEngine } from "../src/features/editor/engine.js";

const SOURCE = "---\ntitle: x\n---\nbody";
const RANGE = { from: 0, to: 16 };

function stateAt(offset: number): EditorState {
  return EditorState.create({ doc: SOURCE, selection: EditorSelection.cursor(offset), extensions: [foldState] });
}

function foldedRangesOf(state: EditorState): Array<[number, number]> {
  const ranges: Array<[number, number]> = [];
  foldedRanges(state).between(RANGE.from, RANGE.to, (from, to) => {
    ranges.push([from, to]);
  });
  return ranges;
}

interface EngineDouble {
  engine: EditorEngine;
  calls: TransactionSpec[];
  setViewState(state: EditorState): void;
}

function engineDouble({ visible = false, auto = false, mode = "source" }: { visible?: boolean; auto?: boolean; mode?: string } = {}): EngineDouble {
  const calls: TransactionSpec[] = [];
  const engine = new EditorEngine({ querySelector: () => null } as unknown as HTMLElement);
  const viewStub = {
    state: stateAt(0).update({ effects: foldEffect.of(RANGE) }).state,
    dispatch: (spec: TransactionSpec) => {
      calls.push(spec);
    },
  };
  Object.assign(engine, {
    editingMode: mode,
    frontmatterRange: RANGE,
    metadataVisible: visible,
    frontmatterAutoRevealed: auto,
    view: viewStub,
  });
  return { engine, calls, setViewState: (state) => { viewStub.state = state; } };
}

test("entering folded frontmatter unfolds it in place", () => {
  const { engine, calls } = engineDouble();
  assert.deepEqual(foldedRangesOf(engine.view.state), [[0, 16]]);

  engine.revealFrontmatterOnEntry(stateAt(5));

  assert.equal(calls.length, 1);
  assert.equal(engine.frontmatterAutoRevealed, true);
  const spec = calls[0];
  assert.ok(spec);
  const next = engine.view.state.update(spec).state;
  assert.deepEqual(foldedRangesOf(next), []);
});

test("leaving auto-revealed frontmatter refolds it", () => {
  const { engine, calls, setViewState } = engineDouble({ auto: true });
  setViewState(stateAt(5));

  engine.revealFrontmatterOnEntry(stateAt(20));

  assert.equal(calls.length, 1);
  assert.equal(engine.frontmatterAutoRevealed, false);
  const spec = calls[0];
  assert.ok(spec);
  const next = engine.view.state.update(spec).state;
  assert.deepEqual(foldedRangesOf(next), [[0, 16]]);
});

test("frontmatter reveal respects mode, visibility, and resting state", () => {
  const visual = engineDouble({ mode: "visual" });
  visual.engine.revealFrontmatterOnEntry(stateAt(5));
  assert.deepEqual(visual.calls, []);

  const visible = engineDouble({ visible: true, auto: true });
  visible.setViewState(stateAt(20));
  visible.engine.revealFrontmatterOnEntry(visible.engine.view.state);
  assert.deepEqual(visible.calls, []);

  const resting = engineDouble();
  assert.equal(resting.engine.frontmatterIsFolded(), true);
  resting.engine.revealFrontmatterOnEntry(stateAt(20));
  assert.deepEqual(resting.calls, []);
  assert.equal(resting.engine.frontmatterAutoRevealed, false);

  const absent = engineDouble();
  absent.engine.frontmatterRange = null;
  absent.engine.revealFrontmatterOnEntry(stateAt(5));
  assert.deepEqual(absent.calls, []);
});

test("setExternalValue applies minimal diffs, preserves folded frontmatter, and maps the caret instead of jumping to the end", () => {
  const frontmatter = "---\ntitle: Demo\n---\n";
  const initial = `${frontmatter}# Heading\n\nMiddle paragraph.\n\nFooter.\n`;
  const cursorInMiddle = initial.indexOf("Middle") + 3;
  let state = EditorState.create({
    doc: initial,
    selection: EditorSelection.cursor(cursorInMiddle),
    extensions: [foldState],
  }).update({
    effects: foldEffect.of({ from: 0, to: frontmatter.length - 1 }),
  }).state;
  let inputValue = initial;
  let inputSelection = { start: cursorInMiddle, end: cursorInMiddle };
  const inputTarget = {
    get value() {
      return inputValue;
    },
    set value(next: string) {
      inputValue = next;
      // DOM textareas reset selectionStart/End to value.length when .value is assigned.
      inputSelection = { start: next.length, end: next.length };
    },
    get selectionStart() {
      return inputSelection.start;
    },
    get selectionEnd() {
      return inputSelection.end;
    },
    setSelectionRange(start: number, end: number) {
      inputSelection = { start, end };
    },
  };
  const engine = new EditorEngine({
    querySelector: (selector: string) =>
      selector.includes("input") ? inputTarget : null,
  } as unknown as HTMLElement);
  Object.assign(engine, {
    lineSeparator: "\n",
    frontmatterRange: { from: 0, to: frontmatter.length - 1, end: frontmatter.length },
    view: {
      get state() {
        return state;
      },
      dispatch(spec: TransactionSpec) {
        state = state.update(spec).state;
      },
    },
  });

  // No-op external value must keep the current caret on both CodeMirror and the proxy input.
  engine.setExternalValue(initial);
  assert.equal(engine.selectionStart, cursorInMiddle);
  assert.deepEqual(inputSelection, { start: cursorInMiddle, end: cursorInMiddle });

  // Prepending text before the caret shifts the caret by the inserted length instead of jumping to doc.length.
  const updated = `${frontmatter}# Updated Heading\n\nMiddle paragraph.\n\nFooter.\n`;
  const delta = updated.length - initial.length;
  engine.setExternalValue(updated);
  assert.equal(engine.value, updated);
  assert.equal(engine.selectionStart, cursorInMiddle + delta);
  assert.deepEqual(inputSelection, {
    start: cursorInMiddle + delta,
    end: cursorInMiddle + delta,
  });
  const foldedRanges: Array<[number, number]> = [];
  foldedRanges.push(
    ...(() => {
      const out: Array<[number, number]> = [];
      state.field(foldState).between(0, state.doc.length, (from, to) => {
        out.push([from, to]);
      });
      return out;
    })()
  );
  assert.deepEqual(foldedRanges, [[0, frontmatter.length - 1]]);
});
