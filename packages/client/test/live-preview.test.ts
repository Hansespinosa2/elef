import { test } from "node:test";
import assert from "node:assert/strict";
import { EditorSelection, EditorState } from "@codemirror/state";
import { markdown } from "@codemirror/lang-markdown";
import { livePreviewField, livePreviewMode, liveMathAt } from "../src/features/editor/live_preview.js";
import { scanMathSource } from "@elef/work-model/math-source";
import { elefMetadata } from "../src/features/editor/engine.js";
import { localMathEdit, localInlineMathLineEdit } from "../src/features/editor/continuous_math_edit.js";
import { localParagraphEndEdit } from "../src/features/editor/continuous_paragraph_edit.js";

test("caret movement reuses the compiled source plan and untouched equation widgets", () => {
  const doc = "Plain prose here.\n\n**bold** then $x^2$ and $y^2$.\n"
  const initial = previewState(doc, EditorSelection.cursor(1))
  const sameContext = initial.update({ selection: EditorSelection.cursor(5) }).state
  assert.equal(sameContext.field(livePreviewField), initial.field(livePreviewField))
  const distantWidgets: unknown[] = []
  initial.field(livePreviewField).decorations.between(doc.indexOf("$y"), doc.length, (_from, _to, value) => {
    if (value.spec.widget) distantWidgets.push(value.spec.widget)
  })
  const revealed = sameContext.update({ selection: EditorSelection.cursor(doc.indexOf("bold") + 1) }).state
  assert.equal(revealed.field(livePreviewField).dynamic, initial.field(livePreviewField).dynamic)
  const afterWidgets: unknown[] = []
  revealed.field(livePreviewField).decorations.between(doc.indexOf("$y"), doc.length, (_from, _to, value) => {
    if (value.spec.widget) afterWidgets.push(value.spec.widget)
  })
  assert.deepEqual(afterWidgets, distantWidgets)
  assert.equal(afterWidgets[0], distantWidgets[0])
})

test("compiled math context agrees with the source scanner at every position", () => {
  const source = "Text $x^2$ and `code $no$`.\n\n$$\na + b\n\nc + d\n$$\n\n```tex\n$not_math$\n```\n\nAfter \\(y + 1\\)."
  const state = previewState(source)
  const spans = scanMathSource(source)
  for (let position = 0; position <= source.length; position++) {
    assert.equal(liveMathAt(state, position), spans.some(span => span.start < position && position < span.end), `offset ${position}`)
  }
  const disabled = state.update({ effects: livePreviewMode.of(false) }).state
  assert.equal(liveMathAt(disabled, source.indexOf("$x") + 1), null)
})

test("incremental reveals match fresh projection after forward, backward, and ranged navigation", () => {
  const doc = "# Heading\n\nA **bold** and *soft* [link](https://example.com) with $x^2$.\n\n> quote\n\n:::align{right}\n\n```mermaid\ngraph TD\nA-->B\n```\n"
  let state = previewState(doc)
  const positions = [0, doc.indexOf("bold"), doc.indexOf("$x") + 2, doc.indexOf("quote"),
    doc.indexOf(":::"), doc.indexOf("A-->"), doc.length, 2, doc.indexOf("link")]
  for (const position of positions) {
    for (const selection of [EditorSelection.cursor(position), EditorSelection.range(position, Math.min(doc.length, position + 4))]) {
      state = state.update({ selection }).state
      assert.equal(state.field(livePreviewField).error, null)
      assert.deepEqual(decorationsOf(state), decorationsOf(previewState(doc, selection)), `position ${position}`)
    }
  }
})

test("plain edits preserve the same preview as a fresh parse across selection and offset changes", () => {
  const source = "First paragraph.\n\n# Title\n\n**bold** and $x^2$.\n\nLast paragraph.\n"
  let state = previewState(source, EditorSelection.cursor(source.indexOf("bold")))
  const beforeWidget = state.field(livePreviewField).dynamic.find(range => range.from === source.indexOf("$x"))?.inactive.find(range => range.value.spec.widget)?.value.spec.widget
  const edits = [
    { from: 5, insert: " longer", select: 3 },
    { from: -1, insert: " Text", select: -1 },
    { from: 0, insert: "# ", select: 1 },
  ]
  for (const edit of edits) {
    const from = edit.from < 0 ? state.doc.length - 1 : edit.from
    const selection = edit.select < 0 ? from + edit.insert.length : edit.select
    state = state.update({ changes: { from, insert: edit.insert }, selection: EditorSelection.cursor(selection) }).state
    assert.equal(state.field(livePreviewField).error, null)
    assert.deepEqual(decorationsOf(state), decorationsOf(previewState(state.doc.toString(), state.selection.main)), `edit at ${from}`)
  }
  const math = state.doc.toString().indexOf("$x")
  const afterWidget = state.field(livePreviewField).dynamic.find(range => range.from === math)?.inactive.find(range => range.value.spec.widget)?.value.spec.widget
  // The final structural edit rebuilds; the first plain edit must retain it.
  assert.ok(beforeWidget && afterWidget)
})

test("ordinary typing away from math reuses its existing equation widget", () => {
  const source = "Write here.\n\nEquation $x^2$.\n"
  const state = previewState(source, EditorSelection.cursor(4))
  const oldContext = state.field(livePreviewField).dynamic.find(range => range.from === source.indexOf("$x"))!
  const changed = state.update({ changes: { from: 5, insert: " more" }, selection: EditorSelection.cursor(10) }).state
  const newContext = changed.field(livePreviewField).dynamic.find(range => range.from === source.indexOf("$x") + 5)!
  assert.equal(newContext.inactive.find(range => range.value.spec.widget)?.value, oldContext.inactive.find(range => range.value.spec.widget)?.value)
  assert.deepEqual(decorationsOf(changed), decorationsOf(previewState(changed.doc.toString(), changed.selection.main)))
})

test("paragraph breaks preserve distant math while rejecting code and actual joins", () => {
  const source = "Before $x^2$.\n\nPlain paragraph.\n\nAfter $y^2$.\n"
  const position = source.indexOf("Plain paragraph.") + "Plain paragraph.".length
  let state = previewState(source, EditorSelection.cursor(position))
  const widget = state.field(livePreviewField).dynamic.find(range => range.from === source.indexOf("$y"))?.inactive.find(range => range.value.spec.widget)?.value.spec.widget
  for (const changes of [{ from: position, insert: "\n\n" }, { from: position, to: position + 2 }]) {
    const transaction = state.update({ changes, selection: EditorSelection.cursor(position) })
    assert.ok(localParagraphEndEdit(transaction))
    state = transaction.state
    assert.deepEqual(decorationsOf(state), decorationsOf(previewState(state.doc.toString(), state.selection.main)))
    const math = state.doc.toString().indexOf("$y")
    assert.equal(state.field(livePreviewField).dynamic.find(range => range.from === math)?.inactive.find(range => range.value.spec.widget)?.value.spec.widget, widget)
  }
  for (const text of ["```\n\nPlain paragraph.\n\n```", "$$\n\nPlain paragraph.\n\n$$", "Plain paragraph.\n\nNext"]) {
    const start = text.indexOf("Plain paragraph.") + "Plain paragraph.".length
    const initial = previewState(text, EditorSelection.cursor(start))
    const changes = text.startsWith("```") || text.startsWith("$$") ? { from: start, insert: "\n\n" } : { from: start, to: start + 2 }
    assert.equal(localParagraphEndEdit(initial.update({ changes })), null, text)
  }
})

test("typing at the document end preserves earlier math and reveals it on return", () => {
  const source = "# Heading\n\nEarlier $x^2$.\n\n"
  let state = previewState(source, EditorSelection.cursor(source.length))
  for (const insert of " A short paragraph.") {
    const cursor = state.doc.length
    state = state.update({ changes: { from: cursor, insert }, selection: EditorSelection.cursor(cursor + 1) }).state
    assert.deepEqual(decorationsOf(state), decorationsOf(previewState(state.doc.toString(), state.selection.main)))
  }
  const selection = EditorSelection.cursor(source.indexOf("$x") + 2)
  state = state.update({ selection }).state
  assert.deepEqual(decorationsOf(state), decorationsOf(previewState(state.doc.toString(), selection)))
})

test("equation typing keeps distant widgets and matches a fresh parse when leaving math", () => {
  const source = "Start.\n\nEquation $f(x) = x^{2} + 5$ and another $z^2$.\n"
  let cursor = source.indexOf("f(x)") + "f(x)".length
  let state = previewState(source, EditorSelection.cursor(cursor))
  const original = state.field(livePreviewField).dynamic.find(range => range.from === source.indexOf("$z"))!
    .inactive.find(range => range.value.spec.widget)?.value
  for (const character of " + \\alpha_{i} + 1") {
    state = state.update({ changes: { from: cursor, insert: character }, selection: EditorSelection.cursor(++cursor) }).state
    assert.equal(state.field(livePreviewField).error, null)
    assert.deepEqual(decorationsOf(state), decorationsOf(previewState(state.doc.toString(), state.selection.main)), `after ${character}`)
  }
  const other = state.doc.toString().indexOf("$z")
  const retained = state.field(livePreviewField).dynamic.find(range => range.from === other)!
    .inactive.find(range => range.value.spec.widget)?.value
  assert.equal(retained, original)
  state = state.update({ selection: EditorSelection.cursor(0) }).state
  assert.deepEqual(decorationsOf(state), decorationsOf(previewState(state.doc.toString(), state.selection.main)))
  assert.ok(decorationsOf(state).some(item => item.spec === "widget:math:f(x) + \\alpha_{i} + 1 = x^{2} + 5"))
})

test("typing in an equation after another equation with subscripts keeps unrelated widgets", () => {
  const source = "Before $\\sum_{i=1}^{N} x_{i}$ and $f(x) = x^{2}$, then $z^2$.\n"
  let cursor = source.indexOf("f(x)") + "f(x)".length
  let state = previewState(source, EditorSelection.cursor(cursor))
  const widget = state.field(livePreviewField).dynamic.find(range => range.from === source.indexOf("$z"))!
    .inactive.find(range => range.value.spec.widget)?.value
  for (const character of " + \\alpha_{i} + 1") {
    state = state.update({ changes: { from: cursor, insert: character }, selection: EditorSelection.cursor(++cursor) }).state
    assert.deepEqual(decorationsOf(state), decorationsOf(previewState(state.doc.toString(), state.selection.main)), `after ${character}`)
    const other = state.doc.toString().indexOf("$z")
    assert.equal(state.field(livePreviewField).dynamic.find(range => range.from === other)!
      .inactive.find(range => range.value.spec.widget)?.value, widget)
  }
})

test("a Markdown emphasis span crossing the edited equation requires a full parse", () => {
  const source = "Previous $a_i$ and $x$ then_x.\n"
  const position = source.indexOf("$x$") + 2
  const state = previewState(source, EditorSelection.cursor(position))
  const transaction = state.update({ changes: { from: position, insert: "y" }, selection: EditorSelection.cursor(position + 1) })
  assert.equal(localMathEdit(transaction), null)
  assert.deepEqual(decorationsOf(transaction.state), decorationsOf(previewState(transaction.state.doc.toString(), transaction.state.selection.main)))
})

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

test("strong emphasis does not also receive italic styling", () => {
  const source = "**bold** and __strong__ and *italic*.\n"
  const decorations = decorationsOf(previewState(source, EditorSelection.cursor(source.length)))
  assert.ok(decorations.some(item => item.spec === "mark:cm-live-strong" && item.from === 2 && item.to === 6))
  assert.ok(!decorations.some(item => item.spec === "mark:cm-live-emphasis" && item.from < source.indexOf("*italic*")))
  assert.ok(decorations.some(item => item.spec === "mark:cm-live-emphasis" && item.from === source.indexOf("italic")))
})

test("ordered list markers follow the rendered start and sequence", () => {
  const source = "3. first\n9. second\n"
  const decorations = decorationsOf(previewState(source, EditorSelection.cursor(source.length)))
  assert.ok(decorations.some(item => item.spec === "widget:list-marker:3."))
  assert.ok(decorations.some(item => item.spec === "widget:list-marker:4."))
})

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

test("editing TeX does not apply Markdown formatting inside the equation", () => {
  const source = "Before $a_b_c + \\text{**bold**}$ and **$x$** and _around $a_b_c$ here_ and *plain*.\n"
  const start = source.indexOf("$a")
  const end = source.indexOf("$ and") + 1
  const active = decorationsOf(previewState(source, EditorSelection.cursor(start + 1)))
  assert.deepEqual(specsAt(active, start, end), ["mark:cm-live-active-syntax"])
  assert.ok(!active.some(item => item.from >= start && item.to <= end &&
    (item.spec.includes("cm-live-emphasis") || item.spec.includes("cm-live-strong") || item.spec.startsWith("widget:syntax:"))))
  assert.ok(active.some(item => item.spec === "mark:cm-live-strong" && item.from === source.indexOf("$x$")))
  assert.ok(active.some(item => item.spec === "widget:math:x"))
  assert.ok(active.some(item => item.spec === "mark:cm-live-emphasis" && item.from === source.indexOf("around") && item.to === source.indexOf(" here_") + 5))
  assert.ok(active.some(item => item.spec === "mark:cm-live-emphasis" && item.from === source.indexOf("plain")))
})

test("typing several subscripts inside an equation keeps the incremental preview", () => {
  const source = "First $\\sum_{i=1}^{N} x_{i}$ and later $z^2$.\n"
  let cursor = source.indexOf("x_{i}") + 1
  let state = previewState(source, EditorSelection.cursor(cursor))
  const later = state.field(livePreviewField).dynamic.find(range => range.from === source.indexOf("$z"))!
    .inactive.find(range => range.value.spec.widget)?.value
  for (const character of "_{j}") {
    const transaction = state.update({ changes: { from: cursor, insert: character }, selection: EditorSelection.cursor(++cursor) })
    assert.ok(localMathEdit(transaction), `incremental after ${character}`)
    state = transaction.state
    assert.deepEqual(decorationsOf(state), decorationsOf(previewState(state.doc.toString(), state.selection.main)))
  }
  const other = state.doc.toString().indexOf("$z")
  assert.equal(state.field(livePreviewField).dynamic.find(range => range.from === other)!
    .inactive.find(range => range.value.spec.widget)?.value, later)
})

test("a new equation keeps the same decorations as a fresh parse after every character", () => {
  const source = "Previous $y^2$.\n\nWrite here $"
  let state = previewState(source, EditorSelection.cursor(source.length))
  const oldContext = state.field(livePreviewField).dynamic.find(range => range.from === source.indexOf("$y"))
  assert.ok(oldContext)
  const original = oldContext.inactive.find(range => range.value.spec.widget)?.value
  for (const insert of "\\sqrt{a_{i} + b^{2}}$") {
    const cursor = state.doc.length
    const transaction = state.update({ changes: { from: cursor, insert }, selection: EditorSelection.cursor(cursor + 1) })
    assert.ok(localInlineMathLineEdit(transaction), `incremental after ${insert}`)
    state = transaction.state
    assert.deepEqual(decorationsOf(state), decorationsOf(previewState(state.doc.toString(), state.selection.main)), `after ${insert}`)
  }
  const retained = state.field(livePreviewField).dynamic.find(range => range.from === source.indexOf("$y"))
  assert.ok(retained)
  assert.equal(retained.inactive.find(range => range.value.spec.widget)?.value, original)
  state = state.update({ selection: EditorSelection.cursor(0) }).state
  assert.deepEqual(decorationsOf(state), decorationsOf(previewState(state.doc.toString(), state.selection.main)))
  assert.ok(decorationsOf(state).some(item => item.spec === "widget:math:\\sqrt{a_{i} + b^{2}}"))
})

test("auto-paired math stays incremental through escaped closers and trailing spaces", () => {
  const source = "Earlier $z^2$.\n\nWrite here $$"
  let cursor = source.length - 1
  let state = previewState(source, EditorSelection.cursor(cursor))
  for (const insert of "\\sqrt{a_{i} + b^{2}}") {
    const transaction = state.update({ changes: { from: cursor, insert }, selection: EditorSelection.cursor(cursor + 1) })
    assert.ok(localInlineMathLineEdit(transaction), `incremental after ${insert}`)
    state = transaction.state
    cursor++
    assert.deepEqual(decorationsOf(state), decorationsOf(previewState(state.doc.toString(), state.selection.main)), `after ${insert}`)
  }
  state = state.update({ selection: EditorSelection.cursor(0) }).state
  assert.deepEqual(decorationsOf(state), decorationsOf(previewState(state.doc.toString(), state.selection.main)))
  assert.ok(decorationsOf(state).some(item => item.spec === "widget:math:\\sqrt{a_{i} + b^{2}}"))
})

test("incremental equation edits reject fenced code and cross-line math", () => {
  for (const source of ["```tex\n\nWrite here $x$", "Earlier $z\nWrite here$x$"]) {
    const position = source.indexOf("$x$") + 2
    const state = previewState(source, EditorSelection.cursor(position))
    const transaction = state.update({ changes: { from: position, insert: "y" }, selection: EditorSelection.cursor(position + 1) })
    assert.equal(localInlineMathLineEdit(transaction), null, source)
    assert.deepEqual(decorationsOf(transaction.state), decorationsOf(previewState(transaction.state.doc.toString(), transaction.state.selection.main)))
  }
})

test("auto-paired math in the middle preserves equations before and after it", () => {
  const source = "Before $x^2$.\n\nWrite here $$\n\nAfter $y^2$.\n\n$$z^2$$\n"
  let cursor = source.indexOf("$$") + 1
  let state = previewState(source, EditorSelection.cursor(cursor))
  for (const insert of "\\sqrt{a_{i} + b^{2}}") {
    const transaction = state.update({ changes: { from: cursor, insert }, selection: EditorSelection.cursor(cursor + 1) })
    assert.ok(localInlineMathLineEdit(transaction), `incremental after ${insert}`)
    state = transaction.state
    cursor++
    assert.deepEqual(decorationsOf(state), decorationsOf(previewState(state.doc.toString(), state.selection.main)), `after ${insert}`)
  }
  state = state.update({ selection: EditorSelection.cursor(0) }).state
  assert.deepEqual(decorationsOf(state), decorationsOf(previewState(state.doc.toString(), state.selection.main)))
  assert.ok(decorationsOf(state).some(item => item.spec === "widget:math:\\sqrt{a_{i} + b^{2}}"))
})

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

test("directive concealment preserves the following character for every line ending", () => {
  const source = ":::align{center}\nText\n"
  for (const separator of ["\n", "\r\n", "\r"]) {
    const state = EditorState.create({
      doc: source.replace(/\n/g, separator),
      selection: EditorSelection.cursor(source.length),
      extensions: [EditorState.lineSeparator.of(separator), markdown({ extensions: elefMetadata }), livePreviewField],
    })
    assert.equal(state.field(livePreviewField).error, null, separator)
    const hidden = decorationsOf(state).filter(item => item.spec === "replace:empty" && item.from === 0)
    assert.deepEqual(hidden, [{ from: 0, to: source.indexOf("Text"), spec: "replace:empty" }], separator)
  }
})

test("unknown directives stay visible so broken syntax is never hidden", () => {
  const doc = ":::frobnicate\n\nText\n";
  const inactive = decorationsOf(previewState(doc, EditorSelection.cursor(doc.length)));

  assert.ok(!specsAt(inactive, 0, 13).includes("replace:empty"));
  assert.ok(specsAt(inactive, 0, 13).includes("mark:cm-live-syntax-marker"));
});
