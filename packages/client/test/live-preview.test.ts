import { test } from "node:test";
import assert from "node:assert/strict";
import { EditorSelection, EditorState } from "@codemirror/state";
import { markdown } from "@codemirror/lang-markdown";
import { livePreviewField, livePreviewMode } from "../src/features/editor/live_preview.js";
import { elefMetadata } from "../src/features/editor/engine.js";

interface FoundDecoration {
  from: number;
  to: number;
  spec: string;
}

function previewState(doc: string, selection = EditorSelection.cursor(0)): EditorState {
  return EditorState.create({
    doc,
    selection,
    extensions: [markdown({ extensions: elefMetadata }), livePreviewField],
  });
}

function decorationsOf(state: EditorState): FoundDecoration[] {
  const found: FoundDecoration[] = [];
  state.field(livePreviewField).decorations.between(0, state.doc.length, (from, to, value) => {
    const spec = value.spec as { widget?: { kind?: string; value?: string }; class?: string };
    if (spec.widget) found.push({ from, to, spec: `widget:${spec.widget.kind ?? "?"}:${spec.widget.value ?? ""}` });
    else if (spec.class) found.push({ from, to, spec: `mark:${spec.class}` });
    else found.push({ from, to, spec: "replace:empty" });
  });
  return found;
}

function specsAt(found: FoundDecoration[], from: number, to: number): string[] {
  return found.filter((item) => item.from === from && item.to === to).map((item) => item.spec);
}

test("live preview hides emphasis delimiters until the caret enters", () => {
  const doc = "x\n\n**bold** and *soft*.\n";
  const inactive = decorationsOf(previewState(doc, EditorSelection.cursor(0)));

  assert.ok(specsAt(inactive, 3, 5).some((spec) => spec.startsWith("widget:syntax:**")));
  assert.ok(specsAt(inactive, 9, 11).some((spec) => spec.startsWith("widget:syntax:**")));
  assert.ok(specsAt(inactive, 16, 17).some((spec) => spec.startsWith("widget:syntax:*")));

  const active = decorationsOf(previewState(doc, EditorSelection.cursor(7)));
  assert.deepEqual(specsAt(active, 3, 5), ["mark:cm-live-active-syntax"]);
  assert.deepEqual(specsAt(active, 9, 11), ["mark:cm-live-active-syntax"]);
  assert.ok(specsAt(active, 16, 17).some((spec) => spec.startsWith("widget:syntax:*")));
});

test("live preview reveals link and code syntax on selection", () => {
  const doc = "See [label](https://example.com) and `code`.\n";
  const inactive = decorationsOf(previewState(doc, EditorSelection.cursor(0)));

  assert.ok(specsAt(inactive, 4, 5).some((spec) => spec.startsWith("widget:syntax:[")));
  assert.ok(specsAt(inactive, 10, 32).some((spec) => spec.startsWith("widget:syntax:](https://example.com)")));
  assert.ok(specsAt(inactive, 37, 38).some((spec) => spec.startsWith("widget:syntax:`")));

  const active = decorationsOf(previewState(doc, EditorSelection.range(4, 32)));
  assert.deepEqual(specsAt(active, 4, 5), ["mark:cm-live-active-syntax"]);
  assert.deepEqual(specsAt(active, 10, 32), ["mark:cm-live-active-syntax"]);
});

test("live preview renders math as a widget until entered", () => {
  const doc = "Before $x^2$ after.\n";
  const inactive = decorationsOf(previewState(doc, EditorSelection.cursor(0)));

  assert.ok(specsAt(inactive, 7, 12).some((spec) => spec === "widget:math:x^2"));

  const active = decorationsOf(previewState(doc, EditorSelection.cursor(9)));
  assert.deepEqual(specsAt(active, 7, 12), ["mark:cm-live-active-syntax"]);
});

test("live preview reveals heading and fence markers on their lines", () => {
  const doc = "# Title\n\n```js\ncode();\n```\n";
  const inactive = decorationsOf(previewState(doc, EditorSelection.cursor(doc.length)));

  assert.ok(inactive.some((item) => item.spec.includes("cm-live-heading-text-1")));
  assert.ok(specsAt(inactive, 0, 2).some((spec) => spec.startsWith("widget:syntax:# ")));

  const onHeading = decorationsOf(previewState(doc, EditorSelection.cursor(3)));
  assert.ok(specsAt(onHeading, 0, 2).includes("mark:cm-live-active-syntax"));

  const onFence = decorationsOf(previewState(doc, EditorSelection.cursor(10)));
  assert.ok(specsAt(onFence, 9, 12).includes("mark:cm-live-active-syntax"));
});

test("live preview can be disabled without decorations", () => {
  const state = previewState("**bold**\n", EditorSelection.cursor(0));
  const disabled = state.update({ effects: livePreviewMode.of(false) }).state;

  assert.deepEqual(decorationsOf(disabled), []);
});

test("invisible directives collapse until entered", () => {
  const doc = ":::align{center}\n\n# Solo\n\n:::\n";
  const end = previewState(doc, EditorSelection.cursor(18));
  const inactive = decorationsOf(end);

  assert.deepEqual(specsAt(inactive, 0, 17), ["replace:empty"]);
  assert.deepEqual(specsAt(inactive, 26, 30), ["replace:empty"]);

  const entered = decorationsOf(previewState(doc, EditorSelection.cursor(4)));
  assert.deepEqual(specsAt(entered, 0, 16), ["mark:cm-live-active-syntax"]);
  assert.deepEqual(specsAt(entered, 26, 30), ["replace:empty"]);
});

test("unknown directives stay visible so broken syntax is never hidden", () => {
  const doc = ":::frobnicate\n\nText\n";
  const inactive = decorationsOf(previewState(doc, EditorSelection.cursor(doc.length)));

  assert.ok(!specsAt(inactive, 0, 13).includes("replace:empty"));
  assert.ok(specsAt(inactive, 0, 13).includes("mark:cm-live-syntax-marker"));
});
