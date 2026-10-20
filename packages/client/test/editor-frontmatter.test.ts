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
