import { test } from "node:test";
import assert from "node:assert/strict";

import {
  presentationBlockAttributes,
  presentationBlockControls,
  presentationEmptySlide,
  presentationRoot,
  presentationSlideBlock,
  presentationSlideFrame,
  presentationSlideToolbar,
} from "../src/features/presentation/chrome.js";

test("client presentation toolbar disables edge actions and keeps editor hooks", () => {
  const first = presentationSlideToolbar({ index: 0, slideCount: 3 });
  assert.match(first, /disabled[^>]*>Move up</);
  assert.doesNotMatch(first, /disabled[^>]*>Move down</);
  assert.match(first, /data-presentation-editor-action="delete-slide"/);

  const only = presentationSlideToolbar({ index: 0, slideCount: 1 });
  assert.match(only, /delete-slide"[^>]*disabled[^>]*>Delete</);

  const last = presentationSlideToolbar({ index: 2, slideCount: 3 });
  assert.match(last, /disabled[^>]*>Move down</);
  assert.doesNotMatch(last, /disabled[^>]*>Move up</);
});

test("client presentation frame keeps labels without Stimulus canvas hooks", () => {
  const frame = presentationSlideFrame({
    index: 1,
    layout: "statement",
    toolbar: "<toolbar/>",
    topMargin: "",
    content: "<content/>",
    bottomMargin: "",
  });
  assert.doesNotMatch(frame, /presentation-canvas/);
  assert.match(frame, /aria-label="Slide 2"/);
  assert.match(frame, /data-editor-slide-id="slide-2"/);
  assert.match(frame, /<toolbar\/>/);
});

test("client presentation block attributes gate editability on region flags", () => {
  const editable = presentationBlockAttributes({
    valid: true,
    mapped: { id: "b1" },
    region: { id: "r1", editable: true },
    label: "Block",
  });
  assert.match(editable, /contenteditable="true"/);
  assert.doesNotMatch(editable, /data-action=/);

  const locked = presentationBlockAttributes({
    valid: true,
    mapped: { id: "b1" },
    region: { id: "r1", editable: false },
    label: "Block",
  });
  assert.match(locked, /contenteditable="false"/);
  assert.doesNotMatch(locked, /presentation-editor#/);

  assert.equal(
    presentationBlockAttributes({ valid: false, mapped: { id: "b1" }, region: { id: "r1" }, label: "Block" }),
    'contenteditable="false" aria-readonly="true"',
  );

  // Unresolved triples degrade to the invalid string instead of throwing,
  // matching the renderer's possibly-unmapped input.
  assert.equal(
    presentationBlockAttributes({ valid: true, mapped: null, region: { id: "r1", editable: true }, label: "Block" }),
    'contenteditable="false" aria-readonly="true"',
  );
  assert.equal(
    presentationBlockAttributes({ valid: true, mapped: { id: "b1" }, region: undefined, label: "Block" }),
    'contenteditable="false" aria-readonly="true"',
  );
});

test("client presentation block controls disable edge moves and single delete", () => {
  const single = presentationBlockControls({ slideIndex: 0, blockIndex: 0, blockCount: 1, position: null });
  assert.match(single, /delete-block"[^>]*disabled[^>]*>Delete</);
  assert.match(single, /Move block up[^>]*disabled/);
  assert.doesNotMatch(single, /data-action=/);
});

test("client presentation root, slide block, and empty slide keep projection hooks", () => {
  const root = presentationRoot({ style: { theme: "dark", typography: "serif" }, inner: "<i/>" });
  assert.match(root, /presentation-editor-projection/);
  assert.match(root, /data-presentation-editor-target="canvas"/);

  assert.equal(
    presentationSlideBlock({ className: "c", attributes: 'a="1"', content: "<x/>", controls: "<ctl/>" }),
    '<div class="c" a="1"><x/></div><ctl/>',
  );

  const empty = presentationEmptySlide({ index: 2 });
  assert.match(empty, /class="empty-slide"/);
  assert.match(empty, /data-slide-index="2"/);
});

test("client presentation chrome emits neutral behavior contracts", () => {
  const toolbar = presentationSlideToolbar({ index: 0, slideCount: 2 });
  assert.match(toolbar, /data-editor-action="media-choose-slide"/);
  assert.doesNotMatch(toolbar, /media#chooseForSlide/);
  assert.doesNotMatch(toolbar, /data-action=/);

  const empty = presentationEmptySlide({ index: 1 });
  assert.match(empty, /data-editor-action="media-choose-slide"/);

  const root = presentationRoot({ style: { theme: "dark", typography: "book" }, inner: "" });
  assert.match(root, /data-client-mount="mermaid"/);
  assert.doesNotMatch(root, /data-controller=/);
});
