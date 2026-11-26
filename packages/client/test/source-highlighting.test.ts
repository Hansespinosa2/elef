import { test } from "node:test";
import assert from "node:assert/strict";
import { EditorState } from "@codemirror/state";
import { ensureSyntaxTree, syntaxTree } from "@codemirror/language";
import { markdown } from "@codemirror/lang-markdown";
import { livePreviewField, livePreviewMode } from "../src/features/editor/live_preview.js";
import { elefMetadata } from "../src/features/editor/engine.js";
import {
  buildSourceCodeDecorationsFromState,
  elefMath
} from "../src/features/editor/source_highlighting.js";

function parsedState(doc: string, withLivePreview = false): EditorState {
  const state = EditorState.create({
    doc,
    extensions: [
      markdown({ extensions: [elefMetadata, elefMath] }),
      ...(withLivePreview ? [livePreviewField] : [])
    ]
  });
  ensureSyntaxTree(state, state.doc.length, 1000);
  return state;
}

function collectNodes(state: EditorState): Array<{ name: string; text: string }> {
  const nodes: Array<{ name: string; text: string }> = [];
  syntaxTree(state).iterate({
    enter(node) {
      nodes.push({ name: node.name, text: state.doc.sliceString(node.from, node.to) });
    }
  });
  return nodes;
}

test("inline single-dollar and double-dollar math produce MathMark and MathContent nodes", () => {
  const doc = "Inline $E = mc^2$ and display $$a^2 + b^2 = c^2$$ here.";
  const nodes = collectNodes(parsedState(doc));

  assert.deepEqual(
    nodes.filter((n) => n.name === "InlineMath").map((n) => n.text),
    ["$E = mc^2$", "$$a^2 + b^2 = c^2$$"]
  );
  assert.deepEqual(
    nodes.filter((n) => n.name === "MathMark").map((n) => n.text),
    ["$", "$", "$$", "$$"]
  );
  assert.deepEqual(
    nodes.filter((n) => n.name === "MathContent").map((n) => n.text),
    ["E = mc^2", "a^2 + b^2 = c^2"]
  );
});

test("block $$ math parses multi-line display equations", () => {
  const doc = "$$\n\\int_0^1 x^2\\,dx = \\frac{1}{3}\n$$\n";
  const nodes = collectNodes(parsedState(doc));

  assert.equal(nodes.filter((n) => n.name === "BlockMath").length, 1);
  assert.deepEqual(
    nodes.filter((n) => n.name === "MathMark").map((n) => n.text),
    ["$$", "$$"]
  );
  assert.deepEqual(
    nodes.filter((n) => n.name === "MathContent").map((n) => n.text),
    ["\n\\int_0^1 x^2\\,dx = \\frac{1}{3}\n"]
  );
});

test("display math closes before trailing prose and highlights adjacent equations independently", () => {
  const doc = "$$\nx_1\n$$, for *all\nvalues* of $x$.\nAnd by induction\n$$\ny_2\n$$done";
  const nodes = collectNodes(parsedState(doc));

  assert.deepEqual(
    nodes.filter((node) => node.name === "BlockMath").map((node) => node.text),
    ["$$\nx_1\n$$", "$$\ny_2\n$$"]
  );
  assert.deepEqual(
    nodes.filter((node) => node.name === "MathContent").map((node) => node.text),
    ["\nx_1\n", "x", "\ny_2\n"]
  );
  assert.ok(nodes.some((node) => node.name === "Emphasis" && node.text === "*all\nvalues*"));
});

test("backticks after a display math closer stay inline", () => {
  const doc = "$$\nx\n$$```\n### Heading\n$$\ny\n$$";
  const nodes = collectNodes(parsedState(doc));

  assert.equal(nodes.filter((node) => node.name === "BlockMath").length, 2);
  assert.equal(nodes.filter((node) => node.name === "FencedCode").length, 0);
  assert.ok(nodes.some((node) => node.name === "ATXHeading3" && node.text === "### Heading"));
});

test("editing a continuation line preserves emphasis after the closing delimiter", () => {
  // Give the preceding equation enough text for Lezer to reuse its tree.
  const doc = "$$\n" + "x".repeat(180) + "\n$$*all\nvalues*\n";
  const state = parsedState(doc);
  const from = doc.indexOf("values");
  const edited = state.update({ changes: { from, to: from + "values".length, insert: "others" } }).state;
  ensureSyntaxTree(edited, edited.doc.length, 1000);

  const nodes = collectNodes(edited);
  assert.ok(nodes.some((node) => node.name === "Emphasis" && node.text === "*all\nothers*"));
  assert.deepEqual(nodes, collectNodes(parsedState(edited.doc.toString())));
});

test("a display closer with trailing prose preserves a following horizontal rule", () => {
  const doc = "$$\nx\n$$, prose\n---\nnext";
  const nodes = collectNodes(parsedState(doc));

  assert.ok(nodes.some((node) => node.name === "MathContent" && node.text === "\nx\n"));
  assert.ok(nodes.some((node) => node.name === "HorizontalRule" && node.text === "---"));
  assert.ok(nodes.some((node) => node.name === "Paragraph" && node.text === "next"));
});

test("a trailing paragraph keeps indented equations with their expression on the opening line", () => {
  const doc = "$$\nx\n$$, prose\n    $$y\n$$\n$$z\n$$";
  const nodes = collectNodes(parsedState(doc));

  assert.deepEqual(
    nodes.filter((node) => node.name === "MathContent").map((node) => node.text),
    ["\nx\n", "y\n", "z\n"]
  );
});

test("dollars in a trailing autolink do not consume the next display opener", () => {
  const doc = "$$\nx\n$$, see <https://example.com/$$>\n$$\n\ny\n$$";
  const nodes = collectNodes(parsedState(doc));

  assert.deepEqual(
    nodes.filter((node) => node.name === "MathContent").map((node) => node.text),
    ["\nx\n", "\n\ny\n"]
  );
});

test("prose currency, escaped dollars, multiline single-dollar, and inline code are not parsed as math", () => {
  const doc = [
    "Costs $5 and $10 or $ 5 today.",
    "Escaped \\$x$ and \\$y\\$ stay prose.",
    "Unescaped backslash \\\\$z$ is math.",
    "Code `$not_math$` stays code.",
    "Split $across\nlines$ is not inline math."
  ].join("\n");
  const nodes = collectNodes(parsedState(doc));

  assert.deepEqual(
    nodes.filter((n) => n.name === "InlineMath").map((n) => n.text),
    ["$z$"]
  );
  assert.ok(nodes.some((n) => n.name === "InlineCode" && n.text === "`$not_math$`"));
});

test("fenced code blocks keep $$ inside as CodeText rather than BlockMath", () => {
  const doc = "```tex\n$$\nx^2\n$$\n```\n";
  const nodes = collectNodes(parsedState(doc));

  assert.equal(nodes.filter((n) => n.name === "BlockMath").length, 0);
  assert.equal(nodes.filter((n) => n.name === "FencedCode").length, 1);
});

test("source decorations style math delimiters, math content, code fences, and code lines only in source mode", () => {
  const doc = "See $x^2$ and:\n\n```python\nprint(1)\nprint(2)\n```\n";
  const visualState = parsedState(doc, true);
  const visualDecos = buildSourceCodeDecorationsFromState(visualState, [{ from: 0, to: doc.length }]);
  assert.equal(visualDecos.size, 0);

  const sourceState = visualState.update({ effects: livePreviewMode.of(false) }).state;
  const sourceDecos = buildSourceCodeDecorationsFromState(sourceState, [{ from: 0, to: doc.length }]);
  const found: Array<{ from: number; to: number; className: string }> = [];
  sourceDecos.between(0, doc.length, (from, to, value) => {
    const spec = value.spec as { class?: string };
    found.push({ from, to, className: spec.class ?? "" });
  });

  assert.deepEqual(
    found.filter((item) => item.className === "cm-source-math-mark").map((item) => doc.slice(item.from, item.to)),
    ["$", "$"]
  );
  assert.deepEqual(
    found.filter((item) => item.className === "cm-source-math-content").map((item) => doc.slice(item.from, item.to)),
    ["x^2"]
  );
  assert.deepEqual(
    found.filter((item) => item.className === "cm-source-code-mark").map((item) => doc.slice(item.from, item.to)),
    ["```", "```"]
  );
  assert.deepEqual(
    found.filter((item) => item.className === "cm-source-code-info").map((item) => doc.slice(item.from, item.to)),
    ["python"]
  );
  assert.equal(
    found.filter((item) => item.className === "cm-source-code-text").length,
    1
  );
  assert.equal(
    found.filter((item) => item.className === "cm-source-code-line").length,
    2
  );
});

test("escaped dollar immediately before inline math and internal $$ do not corrupt math boundaries", () => {
  const escapedBefore = collectNodes(parsedState("\\$$x$"));
  assert.deepEqual(
    escapedBefore.filter((n) => n.name === "InlineMath").map((n) => n.text),
    ["$x$"]
  );

  const internalDouble = collectNodes(parsedState("$x + $$y$"));
  assert.deepEqual(
    internalDouble.filter((n) => n.name === "InlineMath").map((n) => n.text),
    ["$x + $$y$"]
  );
});

test("block $$ stops at blockquote boundaries and interrupts preceding paragraphs", () => {
  const quoteDoc = "> $$\n> x^2\n\nOutside quote\n";
  const quoteNodes = collectNodes(parsedState(quoteDoc));
  const blockMaths = quoteNodes.filter((n) => n.name === "BlockMath");
  assert.equal(blockMaths.length, 1);
  assert.ok(!blockMaths[0]?.text.includes("Outside quote"));

  const interruptDoc = "Some text\n$$\nx^2\n$$\n";
  const interruptNodes = collectNodes(parsedState(interruptDoc));
  assert.equal(interruptNodes.filter((n) => n.name === "BlockMath").length, 1);
  assert.equal(interruptNodes.filter((n) => n.name === "Paragraph").length, 1);
});

test("overlapping visible ranges do not duplicate source mark decorations", () => {
  const doc = "See $x^2$ and `code`.";
  const sourceState = parsedState(doc, true).update({ effects: livePreviewMode.of(false) }).state;
  const decos = buildSourceCodeDecorationsFromState(sourceState, [
    { from: 0, to: doc.length },
    { from: 0, to: doc.length }
  ]);
  const marks: string[] = [];
  decos.between(0, doc.length, (from, to, value) => {
    const spec = value.spec as { class?: string };
    if (spec.class === "cm-source-math-mark") marks.push(doc.slice(from, to));
  });
  assert.deepEqual(marks, ["$", "$"]);
});

test("long line with many unclosed prose $ tokens parses without quadratic slowdown", () => {
  const doc = Array.from({ length: 1000 }, (_, i) => `$${i}`).join(" ");
  const start = performance.now();
  const nodes = collectNodes(parsedState(doc));
  const elapsedMs = performance.now() - start;
  assert.equal(nodes.filter((n) => n.name === "InlineMath").length, 0);
  assert.ok(elapsedMs < 200, `expected linear parse under 200ms, got ${elapsedMs.toFixed(1)}ms`);
});

test("escaped newline inside single-dollar text does not create multiline InlineMath, while double-dollar still allows multiline", () => {
  const singleDoc = "$x\\\ny$";
  assert.equal(collectNodes(parsedState(singleDoc)).filter((n) => n.name === "InlineMath").length, 0);

  const doubleAndSingleDoc = "$$x\\\ny$$ and $z$";
  assert.deepEqual(
    collectNodes(parsedState(doubleAndSingleDoc)).filter((n) => n.name === "InlineMath").map((n) => n.text),
    ["$$x\\\ny$$", "$z$"]
  );
});

test("fenced code line decorations clip to the requested visible range", () => {
  const doc = "```python\nline1\nline2\nline3\n```\n";
  const sourceState = parsedState(doc, true).update({ effects: livePreviewMode.of(false) }).state;
  const line2Start = doc.indexOf("line2");
  const line2End = line2Start + "line2".length;
  const decos = buildSourceCodeDecorationsFromState(sourceState, [{ from: line2Start, to: line2End }]);
  const lines: number[] = [];
  decos.between(0, doc.length, (from, _to, value) => {
    const spec = value.spec as { class?: string };
    if (spec.class === "cm-source-code-line") lines.push(from);
  });
  assert.deepEqual(lines, [line2Start]);
});
