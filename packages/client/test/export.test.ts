import { test } from "node:test";
import assert from "node:assert/strict";
import { parseHTML } from "linkedom";

import {
  blockMarkup,
  colorHex,
  createPresentation,
  createRenderStage,
  cssCharSpacing,
  cssFontSize,
  dataUriToBlob,
  downloadBlob,
  escapeHtml,
  exportPptxModel,
  gradientBackground,
  pixelRectToInches,
  primaryFont,
  safeHyperlink,
  slideMarkup,
} from "../src/features/export/pptx.js";
import {
  EXPORT_FORMATS,
  exportFormatById,
  exportFormatsFor,
} from "../src/features/export/registry.js";

void downloadBlob;

function testModel() {
  return {
    filename: "deck.pptx",
    version: "draft",
    presentation: {
      title: "Deck",
      theme: "dark",
      typography: "technical",
      fonts: { technical: "Arial, sans-serif", body: "Georgia, serif" },
    },
    margin_settings: { section: "S", subsection: "Sub", footnote: true, slide_count: true },
    slides: [
      {
        index: 0,
        layout: "statement",
        section: "S",
        subsection: "Sub",
        title_html: "<h1>Title</h1>",
        title_position: null,
        regions: [],
        blocks: [],
        footnote_html: "",
      },
    ],
  };
}

test("export registry is the only format-rule source", () => {
  assert.equal(EXPORT_FORMATS.length, 4);
  assert.equal(exportFormatById("pptx")?.engine, "pptx");
  assert.equal(exportFormatById("unknown"), null);

  const webPresentation = exportFormatsFor({ kind: "presentation", host: "web" }).map((format) => format.id);
  assert.ok(webPresentation.includes("pptx"));
  assert.ok(webPresentation.includes("print"));
  assert.ok(webPresentation.includes("pdf"));

  const desktopPresentation = exportFormatsFor({ kind: "presentation", host: "desktop" }).map((format) => format.id);
  assert.ok(!desktopPresentation.includes("pptx"));
  assert.ok(desktopPresentation.includes("print"));
  assert.ok(desktopPresentation.includes("elef"));

  assert.equal(exportFormatById("elef")?.via, "TransferPort");
  assert.equal(exportFormatsFor({ kind: "document", host: "web" }).some((format) => format.id === "pptx"), false);
});

test("pptx engine maps fonts, colors, and geometry without a browser", () => {
  assert.equal(primaryFont("Georgia, serif"), "Georgia");
  assert.equal(primaryFont("'Fancy Font', serif"), "Fancy Font");
  assert.equal(primaryFont(""), "Arial");
  assert.equal(colorHex("rgb(32, 44, 50)"), "202C32");
  assert.equal(colorHex("transparent"), "252A27");
  assert.equal(cssFontSize({ fontSize: "16px" }), 12);
  assert.equal(cssCharSpacing({ letterSpacing: "2px" }), 1.5);
  assert.deepEqual(pixelRectToInches({ left: 96, top: 48, width: 192, height: 96 }), {
    x: 1,
    y: 0.5,
    w: 2,
    h: 1,
  });
  assert.equal(safeHyperlink("https://example.com"), true);
  assert.equal(safeHyperlink("javascript:alert(1)"), false);
  assert.equal(escapeHtml("<a>&\"'"), "&lt;a&gt;&amp;&quot;&#39;");
});

test("pptx engine renders slide markup and transfer blobs", async () => {
  const model = testModel();
  const html = slideMarkup(model.slides[0], model);
  assert.ok(html.includes('class="slide-frame"'));
  assert.ok(html.includes("<h1>Title</h1>"));
  assert.ok(html.includes("1 / 1"));
  assert.equal(blockMarkup({ position: { horizontal: "center", vertical: "top" }, html: "<p>Hi</p>" }),
    '<div class="slide-block position-center position-top"><p>Hi</p></div>');

  const blob = dataUriToBlob("data:text/plain;base64,aGk=");
  assert.equal(blob.type, "text/plain");
  assert.equal(await blob.text(), "hi");

  const svg = gradientBackground("dark");
  assert.ok(svg.startsWith("data:image/svg+xml;base64,"));
});

test("pptx orchestration builds the blob and cleans the stage", async () => {
  const { document } = parseHTML("<html><body></body></html>");
  const model = testModel();
  const seen: string[] = [];
  let written = false;

  class FakePptx {
    slides: unknown[] = [];
    defineLayout() {}
    addSlide() {
      const slide = {};
      this.slides.push(slide);
      return slide;
    }
    async write(options: { outputType: string }) {
      written = true;
      assert.equal(options.outputType, "blob");
      return { kind: "blob", slides: this.slides.length };
    }
  }

  const blob = await exportPptxModel(model, {
    libraryUrl: "https://example.com/pptx.js",
    loadLibrary: async (url: string) => {
      seen.push(url);
    },
    PptxGenJS: FakePptx,
    document: document as unknown as Document,
    prepareMedia: async (stage: unknown) => {
      assert.ok((stage as HTMLElement).innerHTML.includes("Title"));
      return { media: new Map(), objectUrls: [] };
    },
    renderSlides: async (pptx: FakePptx) => {
      pptx.addSlide();
    },
  });

  assert.deepEqual(seen, ["https://example.com/pptx.js"]);
  assert.equal(written, true);
  assert.deepEqual(blob, { kind: "blob", slides: 1 });
  assert.equal(document.body.querySelector(".pptx-render-stage"), null);
});

test("pptx orchestration revokes object urls when rendering fails", async () => {
  const { document } = parseHTML("<html><body></body></html>");
  const revoked: string[] = [];
  const originalRevoke = URL.revokeObjectURL.bind(URL);
  (URL as unknown as Record<string, unknown>).revokeObjectURL = (url: string) => {
    revoked.push(String(url));
  };
  try {
    class FakePptx {
      defineLayout() {}
      async write() {
        return { kind: "blob" };
      }
    }
    await assert.rejects(
      exportPptxModel(testModel(), {
        loadLibrary: async () => {},
        PptxGenJS: FakePptx,
        document: document as unknown as Document,
        prepareMedia: async () => ({ media: new Map(), objectUrls: ["blob:one"] }),
        renderSlides: async () => {
          throw new Error("render boom");
        },
      }),
      /render boom/,
    );
    assert.deepEqual(revoked, ["blob:one"]);
    assert.equal(document.body.querySelector(".pptx-render-stage"), null);
  } finally {
    URL.revokeObjectURL = originalRevoke;
  }
});

test("pptx presentation creation honors model style", () => {
  const defined: Record<string, unknown> = {};
  class FakePptx {
    theme: unknown = null;
    defineLayout(options: { name: string }) {
      defined.layout = options.name;
    }
  }
  const pptx = createPresentation(testModel(), FakePptx) as unknown as FakePptx & {
    layout: string;
    author: string;
    title: string;
  };
  assert.equal(defined.layout, "ELEF_16_9");
  assert.equal(pptx.author, "Elef");
  assert.equal(pptx.title, "Deck");
  assert.equal((pptx.theme as Record<string, unknown>).headFontFace, "Arial");
});

test("pptx render stage escapes slide layouts", () => {
  const { document } = parseHTML("<html><body></body></html>");
  const model = testModel();
  (model.slides[0] as Record<string, unknown>).layout = 'x" onmouseover="alert(1)';
  const stage = createRenderStage(model, document as unknown as Document);
  assert.ok(!stage.innerHTML.includes("onmouseover=\"alert(1)\""));
});
