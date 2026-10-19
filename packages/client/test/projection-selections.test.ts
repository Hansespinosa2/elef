import { test } from "node:test";
import assert from "node:assert/strict";
import { paintProjectionSelections } from "../src/session/projection_selections.js";

interface FakeNode {
  readonly id: string;
}

interface FakeRect {
  readonly left: number;
  readonly top: number;
  readonly width: number;
  readonly height: number;
}

function fakeDocument(rects: FakeRect[], created: string[]) {
  return {
    createRange() {
      return {
        setStart() {},
        setEnd() {},
        getClientRects: () => rects,
      };
    },
    createElement(tag: string) {
      const element = {
        tag,
        className: "",
        style: { cssText: "" },
        children: [] as unknown[],
        setAttribute() {},
        append(child: unknown) {
          element.children.push(child);
        },
      };
      created.push(tag);
      return element;
    },
  };
}

function fakeRoot({ rects = [{ left: 1, top: 2, width: 10, height: 12 }], existing = null as unknown } = {}) {
  const created: string[] = [];
  const appended: unknown[] = [];
  const document = fakeDocument(rects, created);
  const root = {
    ownerDocument: document,
    querySelector: (_selector: string) => existing,
    append(child: unknown) {
      appended.push(child);
    },
  };
  return { root: root as unknown as Element, appended, created };
}

const point = (id: string) => (_offset: number) => ({ node: { id } as unknown as Node, offset: 0 });

test("multi-range engines paint one mark per rect outside the projection tree", () => {
  const { root, appended } = fakeRoot();
  paintProjectionSelections(
    root,
    [{ anchor: 0, head: 3 }, { anchor: 5, head: 8 }],
    point("text"),
  );
  assert.equal(appended.length, 1);
  const layer = appended[0] as { className: string; children: unknown[] };
  assert.equal(layer.className, "elef-projection-selections");
  assert.equal(layer.children.length, 2);
});

test("collapsed secondary ranges paint as caret-width marks", () => {
  const { root, appended } = fakeRoot();
  paintProjectionSelections(root, [{ anchor: 4, head: 4 }, { anchor: 9, head: 9 }], point("text"));
  const layer = appended[0] as { children: Array<{ style: { cssText: string } }> };
  assert.equal(layer.children.length, 2);
  assert.match(layer.children[0]?.style.cssText ?? "", /width:2px/);
});

test("unmappable endpoints skip without aborting the layer", () => {
  const { root, appended } = fakeRoot();
  paintProjectionSelections(
    root,
    [{ anchor: 0, head: 3 }, { anchor: 5, head: 8 }],
    (offset) => (offset === 5 || offset === 8 ? null : { node: {} as Node, offset: 0 }),
  );
  assert.equal(appended.length, 1);
  const layer = appended[0] as { children: unknown[] };
  assert.equal(layer.children.length, 1);
});

test("a single range clears the stale layer and paints nothing", () => {
  let removed = 0;
  const { root, appended } = fakeRoot({ existing: { remove: () => { removed += 1; } } });
  paintProjectionSelections(root, [{ anchor: 0, head: 0 }], point("text"));
  assert.equal(removed, 1);
  assert.equal(appended.length, 0);
});

test("repaint replaces the previous layer", () => {
  let removed = 0;
  const { root, appended } = fakeRoot({ existing: { remove: () => { removed += 1; } } });
  paintProjectionSelections(
    root,
    [{ anchor: 0, head: 3 }, { anchor: 5, head: 8 }],
    point("text"),
  );
  assert.equal(removed, 1);
  assert.equal(appended.length, 1);
});
