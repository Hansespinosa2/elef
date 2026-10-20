import { test } from "node:test";
import assert from "node:assert/strict";
import { renderPreviewCore } from "../src/features/library/preview-core.js";

test("preview-core entry exposes the card-preview renderer", () => {
  assert.equal(typeof renderPreviewCore, "function", "lazy preview entry must export renderPreviewCore");
});

test("preview-core renders markdown without the boot bundle", () => {
  const rendered = renderPreviewCore({ source: "# Title\n\nNotes with $x^2$.", kind: "document" });
  assert.match(rendered.html, /Title/, "preview entry renders headings");
});
