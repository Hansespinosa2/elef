import { test } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";

import { buildPptxModel } from "../src/features/export/pptx_model.js";
import type { PptxExportModel } from "../src/features/export/pptx_model.js";
import defaultsFixture from "./fixtures/export-parity/defaults.fixture.json";
import headingsFixture from "./fixtures/export-parity/headings.fixture.json";
import richFixture from "./fixtures/export-parity/rich.fixture.json";
import localImageFixture from "./fixtures/export-parity/local-image.fixture.json";
import remoteImageFixture from "./fixtures/export-parity/remote-image.fixture.json";
import defaultsExpected from "./fixtures/export-parity/defaults.expected.json";
import headingsExpected from "./fixtures/export-parity/headings.expected.json";
import richExpected from "./fixtures/export-parity/rich.expected.json";

// Desktop side of the export-parity proof: the desktop model builder must
// emit the web model bytes for every shared fixture. The Ruby side
// (apps/web/test/services/presentations/pptx_export_parity_test.rb) pins
// the same baselines to the server output, so a green pair means both
// hosts feed the shared engine identical bytes. Baselines regenerate from
// the server only; see tooling/export_parity_baselines.rb.
function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value !== null && typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>)
      .map(([key, entry]): readonly [string, unknown] => [key, canonicalize(entry)])
      .sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0));
    return Object.fromEntries(entries);
  }
  return value;
}

function slideHtml(model: PptxExportModel): string {
  return model.slides
    .flatMap((slide) => [...slide.blocks, ...slide.regions.flat()])
    .map((block) => block.html)
    .join("\n");
}

const byteFixtures: Array<{ fixture: { id: string; title: string; source: string }; expected: unknown }> = [
  { fixture: defaultsFixture, expected: defaultsExpected },
  { fixture: headingsFixture, expected: headingsExpected },
  { fixture: richFixture, expected: richExpected },
];

for (const { fixture, expected } of byteFixtures) {
  test(`desktop model matches the web model bytes for ${fixture.id}`, () => {
    const model = buildPptxModel({ source: fixture.source, title: fixture.title });
    assert.equal(JSON.stringify(canonicalize(model)), JSON.stringify(canonicalize(expected)));
  });
}

// The same 1px PNG bytes as PresentationsPptxExportTest::PIXEL_PNG.
const PIXEL_B64 = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+i9MwAAAAASUVORK5CYII=";

test("desktop model keeps local assets as resolvable URLs on the shared fixture", () => {
  const digest = createHash("sha256").update(Buffer.from(PIXEL_B64, "base64")).digest("hex");
  const referenced = /elef-asset:([0-9a-f]{64})/.exec(localImageFixture.source)?.[1];
  assert.ok(referenced);
  assert.equal(referenced, digest);
  const model = buildPptxModel({
    source: localImageFixture.source,
    title: localImageFixture.title,
    mediaMap: { [`elef-asset:${digest}`]: { src: `elefasset://localhost/work/${digest}`, contentType: "image/png" } },
  });
  assert.ok(slideHtml(model).includes(`elefasset://localhost/work/${digest}`));
});

test("desktop model keeps remote images as URLs for IPC resolution (the server inlines them)", () => {
  const model = buildPptxModel({ source: remoteImageFixture.source, title: remoteImageFixture.title });
  const html = slideHtml(model);
  assert.ok(html.includes("https://assets.example.org/pixel.png"));
  assert.ok(!html.includes("data:image"));
});
