import { test, after } from "node:test";
import assert from "node:assert/strict";
import { parseHTML } from "linkedom";

import { activeDisplayMathForNodes, mathEndPlacement, mathMatchForSpan, pairMathSpans, scanMathMatches } from "../src/session/projection_math.js";

// linkedom DOM with a minimal Node shim (same pattern as the caret tests).
const nodeDescriptor = Object.getOwnPropertyDescriptor(globalThis, "Node");
Object.defineProperty(globalThis, "Node", { configurable: true, writable: true, value: { ELEMENT_NODE: 1, TEXT_NODE: 3 } });
after(() => {
  if (nodeDescriptor) Object.defineProperty(globalThis, "Node", nodeDescriptor);
  else delete (globalThis as Record<string, unknown>).Node;
});

test("scanMathMatches finds inline and display math", () => {
  assert.deepEqual(scanMathMatches("$x$"), [{ start: 0, end: 3, interior: "x" }]);
  assert.deepEqual(scanMathMatches("$$a=1$$"), [{ start: 0, end: 7, interior: "a=1" }]);
  assert.deepEqual(scanMathMatches("a $x$ b $y$"), [
    { start: 2, end: 5, interior: "x" },
    { start: 8, end: 11, interior: "y" },
  ]);
});

test("scanMathMatches ignores unclosed and empty math", () => {
  assert.deepEqual(scanMathMatches("$x"), []);
  assert.deepEqual(scanMathMatches("$$$$"), []);
  assert.deepEqual(scanMathMatches("plain text"), []);
});

test("scanMathMatches counts backslash parity at the close", () => {
  // An odd backslash run escapes the close (reader parity): literal text.
  assert.deepEqual(scanMathMatches("$\\$"), []);
  // An even run closes normally; an escaped dollar inside still matches long.
  assert.deepEqual(scanMathMatches("$a\\\\$"), [{ start: 0, end: 5, interior: "a\\\\" }]);
  assert.deepEqual(scanMathMatches("$\\$x$"), [{ start: 0, end: 5, interior: "\\$x" }]);
});

test("math pairing recognizes mixed bracket and dollar spans without code false positives", () => {
  const source = "`$code$` \\(x\\) $y$ \\[\nz\n\\]";
  const fragment = block(
    '<code>$code$</code> <span data-editor-math-source="x">x</span> ' +
    '<span data-editor-math-source="y">y</span> ' +
    '<span data-editor-math-source="\nz\n">z</span>'
  );
  const spans = [...fragment.querySelectorAll("[data-editor-math-source]")] as unknown as Element[];
  const pairs = pairMathSpans(spans, source);
  assert.ok(pairs);
  assert.deepEqual(pairs.map(({ match }) => source.slice(match.start, match.end)), ["\\(x\\)", "$y$", "\\[\nz\n\\]"]);
  assert.equal(mathEndPlacement([fragment], source, source.length)?.node.previousSibling, spans[2]);
});

function block(html: string): Element {
  const { document } = parseHTML(`<div data-editor-block-id="b1" contenteditable="true">${html}</div>`);
  const element = document.querySelector("[data-editor-block-id]");
  assert.ok(element);
  return element as unknown as Element;
}

const RENDERED = `<span class="katex" data-editor-math-source="x" data-editor-math-open="$" data-editor-math-close="$" contenteditable="false"><math>x</math></span>`;
const ACTIVE = `<span class="editor-math-active" data-editor-math-active="true" data-editor-math-source="x" data-editor-math-open="$" data-editor-math-close="$" contenteditable="true">$x$</span>`;

test("mathEndPlacement puts the caret after a whole-block rendered atom", () => {
  const fragment = block(`${RENDERED}`);
  const point = mathEndPlacement([fragment], "$x$", 3);
  assert.ok(point);
  assert.equal(point.fragment, fragment);
  assert.equal(point.node.nodeType, 3);
  assert.equal(point.node.previousSibling, fragment.querySelector("[data-editor-math-source]"));
  assert.equal(point.offset, 0);
});

test("mathEndPlacement puts the caret after an active span", () => {
  const fragment = block(`${ACTIVE}`);
  const point = mathEndPlacement([fragment], "$x$", 3);
  assert.ok(point);
  assert.equal(point.node.nodeType, 3);
  assert.equal(point.node.previousSibling, fragment.querySelector("[data-editor-math-active]"));
  assert.equal(point.offset, 0);
});

test("pairing verifies active spans against live text, not the stale record", () => {
  // Native edits inside an active span grow its text; the recorded
  // source stays behind. Pairing follows the live text.
  const grown = block(`<span class="editor-math-active" data-editor-math-active="true" data-editor-math-source="x" contenteditable="true">$x=3$</span>`);
  const point = mathEndPlacement([grown], "$x=3$", 5);
  assert.ok(point);
  assert.equal(point.node.nodeType, 3);
  assert.equal(point.node.previousSibling, grown.querySelector("[data-editor-math-active]"));
  assert.equal(point.offset, 0);
  // Diverged text (stale span) still refuses.
  assert.equal(mathEndPlacement([grown], "$y=3$", 5), null);
});

test("mathMatchForSpan resolves the verified match for capture", () => {
  const second = RENDERED.replaceAll('data-editor-math-source="x"', 'data-editor-math-source="y"');
  const fragment = block(`a ${RENDERED} b ${second} c`);
  const spans = [...fragment.querySelectorAll("[data-editor-math-source]")];
  assert.equal(spans.length, 2);
  const match = mathMatchForSpan([fragment], "a $x$ b $y$ c", spans[1] as unknown as Element);
  assert.deepEqual(match, { start: 8, end: 11, interior: "y" });
  assert.equal(mathMatchForSpan([fragment], "a $x$ b $zzz$ c", spans[1] as unknown as Element), null);
  assert.deepEqual(pairMathSpans([], "plain"), []);
});

test("mathEndPlacement pairs the second of two maths mid-block", () => {
  const second = RENDERED.replaceAll('data-editor-math-source="x"', 'data-editor-math-source="y"');
  const fragment = block(`a ${RENDERED} b ${second} c`);
  const point = mathEndPlacement([fragment], "a $x$ b $y$ c", 11);
  assert.ok(point);
  const span = fragment.querySelectorAll("[data-editor-math-source]")[1] as unknown as Element;
  assert.ok(span?.parentNode);
  assert.equal(point.node, span.nextSibling);
  assert.equal(point.node.textContent, " c");
  assert.equal(point.offset, 0);
});

test("math end insertion reuses its trailing text node without changing the atom", () => {
  const fragment = block(RENDERED);
  const atom = fragment.querySelector("[data-editor-math-source]");
  const point = mathEndPlacement([fragment], "$x$", 3);
  assert.ok(point);
  assert.equal(mathEndPlacement([fragment], "$x$", 3)?.node, point.node);
  assert.equal(fragment.childNodes.length, 2);
  point.node.textContent = " after";
  assert.equal(atom?.textContent, "x");
  assert.equal(atom?.nextSibling?.textContent, " after");
});

test("math end placement inserts text between adjacent protected atoms", () => {
  const second = '<img data-editor-image-source="true" src="x">';
  const fragment = block(RENDERED + second);
  const atoms = [...fragment.querySelectorAll("[data-editor-math-source], img")];
  const point = mathEndPlacement([fragment], "$x$![img](x)", 3);
  assert.ok(point);
  assert.equal(point.node.previousSibling, atoms[0]);
  assert.equal(point.node.nextSibling, atoms[1]);
});

test("mathEndPlacement refuses interior offsets, stale spans, and ambiguity", () => {
  const fragment = block(`${RENDERED}`);
  assert.equal(mathEndPlacement([fragment], "$x$", 2), null);
  assert.equal(mathEndPlacement([fragment], "$x$", 0), null);
  // Stale span: source no longer has math.
  assert.equal(mathEndPlacement([fragment], "xyz", 3), null);
  // Missing span: source has math the DOM never rendered.
  assert.equal(mathEndPlacement([block("$x$")], "$x$", 3), null);
  // Ambiguous: two matches, one span.
  assert.equal(mathEndPlacement([fragment], "$x$ and $y$", 3), null);
  // Wrong interior: span records different source.
  const wrong = block(RENDERED.replace('data-editor-math-source="x"', 'data-editor-math-source="z"'));
  assert.equal(mathEndPlacement([wrong], "$x$", 3), null);
});

test("activeDisplayMathForNodes requires both endpoints in one display span", () => {
  const fragment = block(`<span class="editor-math-active editor-live-math-display" data-editor-math-source="x">$$x$$</span> tail`);
  const span = fragment.querySelector("[data-editor-math-source]") as unknown as Element;
  const spanText = span.childNodes[0] as unknown as Node;
  const tailText = fragment.childNodes[1] as unknown as Node;
  assert.equal(activeDisplayMathForNodes(spanText, spanText), span);
  assert.equal(activeDisplayMathForNodes(spanText, tailText), null);
  assert.equal(activeDisplayMathForNodes(tailText, tailText), null);
  assert.equal(activeDisplayMathForNodes(null, spanText), null);
  const inline = block(`<span class="editor-math-active" data-editor-math-source="x">$x$</span>`);
  const inlineText = (inline.querySelector("[data-editor-math-source]") as unknown as Element).childNodes[0] as unknown as Node;
  assert.equal(activeDisplayMathForNodes(inlineText, inlineText), null);
});

test("mathEndPlacement spans page fragments in document order", () => {
  const first = block(`a ${RENDERED}`);
  const secondHtml = RENDERED.replaceAll('data-editor-math-source="x"', 'data-editor-math-source="y"');
  const second = block(`b ${secondHtml}`);
  const point = mathEndPlacement([first, second], "a $x$ b $y$", 11);
  assert.ok(point);
  assert.equal(point.fragment, second);
});
