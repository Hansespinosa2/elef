import { test, after } from "node:test";
import assert from "node:assert/strict";
import { parseHTML } from "linkedom";

import { applyVisualAssistInsert } from "../src/session/projection_assist.js";

// linkedom DOM with a minimal Node shim (same pattern as the caret tests).
const nodeDescriptor = Object.getOwnPropertyDescriptor(globalThis, "Node");
Object.defineProperty(globalThis, "Node", { configurable: true, writable: true, value: { ELEMENT_NODE: 1, TEXT_NODE: 3 } });
after(() => {
  if (nodeDescriptor) Object.defineProperty(globalThis, "Node", nodeDescriptor);
  else delete (globalThis as Record<string, unknown>).Node;
});

interface TestRegion {
  content_range: { start: number; end: number };
  block_id: string;
}

function testHost(regions: TestRegion[], projectionTarget: Element) {
  const shifts: Array<[number, number, number, string | null | undefined]> = [];
  const staged: Array<{ sourceOffset: number; preferredBlockId: string | null }> = [];
  return {
    host: {
      projectionTarget,
      allRegions: () => regions,
      shiftMapAfterEdit: (from: number, to: number, length: number, blockId?: string | null) => {
        shifts.push([from, to, length, blockId]);
      },
      stageCaretRestore: (restore: { sourceOffset: number; preferredBlockId: string | null }) => {
        staged.push(restore);
      },
    },
    shifts,
    staged,
  };
}

function testSelection(focusNode: Node | null, focusOffset: number) {
  const positions: Array<[Node, number]> = [];
  return {
    selection: {
      focusNode,
      focusOffset,
      setPosition: (node: Node, offset: number) => {
        positions.push([node, offset]);
      },
    } as unknown as Selection,
    positions,
  };
}

function blockDocument(innerHtml: string) {
  const { document } = parseHTML(`<div class="surface"><div data-editor-block-id="b1">${innerHtml}</div></div>`);
  const surface = document.querySelector(".surface") as unknown as Element;
  const block = document.querySelector('[data-editor-block-id="b1"]') as unknown as Element;
  return { document, surface, block };
}

const REGIONS: TestRegion[] = [{ content_range: { start: 0, end: 12 }, block_id: "b1" }];

test("assist insert shifts the map, patches the caret text, and places the caret", () => {
  const { surface, block } = blockDocument("<p>Body /tab</p>");
  const text = block.querySelector("p")?.firstChild as unknown as Text;
  const { host, shifts, staged } = testHost(REGIONS, surface);
  const { selection, positions } = testSelection(text, 9);

  const patched = applyVisualAssistInsert(host, { from: 5, to: 9, insert: "**bold**", caret: 13 }, selection);

  assert.equal(patched, true);
  assert.deepEqual(shifts, [[5, 9, 8, "b1"]]);
  assert.deepEqual(staged, [{ sourceOffset: 13, preferredBlockId: "b1" }]);
  assert.equal(text.data, "Body **bold**");
  assert.equal(positions.length, 1);
  assert.equal(positions[0]?.[0], text);
  assert.equal(positions[0]?.[1], 13);
});

test("assist insert splits multiline inserts across line breaks", () => {
  const { surface, block } = blockDocument("<p>See /ta</p>");
  const text = block.querySelector("p")?.firstChild as unknown as Text;
  const { host } = testHost(REGIONS, surface);
  const { selection, positions } = testSelection(text, 7);

  const patched = applyVisualAssistInsert(host, { from: 4, to: 7, insert: "a\nb\nc", caret: 9 }, selection);

  assert.equal(patched, true);
  const paragraph = block.querySelector("p") as unknown as Element;
  assert.equal(paragraph.querySelectorAll("br").length, 2);
  assert.equal(paragraph.textContent, "See abc");
  assert.equal(positions.length, 1);
  assert.equal((positions[0]?.[0] as unknown as Text).data, "c");
  assert.equal(positions[0]?.[1], 1);
});

test("assist insert keeps raw newlines inside pre blocks", () => {
  const { surface, block } = blockDocument("<pre>code /co</pre>");
  const text = block.querySelector("pre")?.firstChild as unknown as Text;
  const { host } = testHost(REGIONS, surface);
  const { selection, positions } = testSelection(text, 8);

  const patched = applyVisualAssistInsert(host, { from: 5, to: 8, insert: "x\ny", caret: 8 }, selection);

  assert.equal(patched, true);
  assert.equal((block.querySelector("pre") as unknown as Element).querySelectorAll("br").length, 0);
  assert.equal(text.data, "code x\ny");
  assert.equal(positions[0]?.[0], text);
  assert.equal(positions[0]?.[1], 8);
});

test("assist insert still shifts and stages when the caret is not in a text node", () => {
  const { surface, block } = blockDocument("<p>Body /tab</p>");
  const { host, shifts, staged } = testHost(REGIONS, surface);
  const { selection } = testSelection(block as unknown as Node, 0);

  const patched = applyVisualAssistInsert(host, { from: 5, to: 9, insert: "**bold**", caret: 13 }, selection);

  assert.equal(patched, false);
  assert.deepEqual(shifts, [[5, 9, 8, "b1"]]);
  assert.deepEqual(staged, [{ sourceOffset: 13, preferredBlockId: "b1" }]);
  assert.equal(block.textContent, "Body /tab");
});

test("assist insert outside editable regions stages restore without shifting", () => {
  const { surface, block } = blockDocument("<p>Body /tab</p>");
  const text = block.querySelector("p")?.firstChild as unknown as Text;
  const { host, shifts, staged } = testHost(REGIONS, surface);
  const { selection } = testSelection(text, 9);

  const patched = applyVisualAssistInsert(host, { from: 40, to: 44, insert: "x", caret: 41 }, selection);

  assert.equal(patched, false);
  assert.deepEqual(shifts, []);
  assert.deepEqual(staged, [{ sourceOffset: 41, preferredBlockId: null }]);
});

test("assist insert prefers the innermost containing region", () => {
  const { surface, block } = blockDocument("<p>Body /tab</p>");
  const text = block.querySelector("p")?.firstChild as unknown as Text;
  const nested: TestRegion[] = [
    { content_range: { start: 0, end: 40 }, block_id: "outer" },
    { content_range: { start: 4, end: 12 }, block_id: "inner" },
  ];
  const { host, shifts, staged } = testHost(nested, surface);
  const { selection } = testSelection(text, 9);

  const patched = applyVisualAssistInsert(host, { from: 5, to: 9, insert: "x", caret: 6 }, selection);

  assert.equal(patched, true);
  assert.deepEqual(shifts, [[5, 9, 1, "inner"]]);
  assert.deepEqual(staged, [{ sourceOffset: 6, preferredBlockId: "inner" }]);
});

test("assist insert skips the patch when the caret sits outside the projection", () => {
  const { block } = blockDocument("<p>Body /tab</p>");
  const text = block.querySelector("p")?.firstChild as unknown as Text;
  const { document: other } = parseHTML("<div class=\"elsewhere\"></div>");
  const elsewhere = other.querySelector(".elsewhere") as unknown as Element;
  const { host, shifts, staged } = testHost(REGIONS, elsewhere);
  const { selection } = testSelection(text, 9);

  const patched = applyVisualAssistInsert(host, { from: 5, to: 9, insert: "x", caret: 6 }, selection);

  assert.equal(patched, false);
  assert.deepEqual(shifts, [[5, 9, 1, "b1"]]);
  assert.deepEqual(staged, [{ sourceOffset: 6, preferredBlockId: "b1" }]);
});
