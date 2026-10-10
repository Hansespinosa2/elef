import assert from "node:assert/strict"
import test from "node:test"
import * as pptx from "../../app/javascript/lib/pptx_export.js"

const {
  blockMarkup,
  colorHex,
  createPresentation,
  createRenderStage,
  cssCharSpacing,
  cssFontSize,
  cssLineSpacingMultiple,
  dataUriToBlob,
  escapeHtml,
  gradientBackground,
  loadPptxLibrary,
  pixelRectToInches,
  primaryFont,
  relativeRect,
  safeHyperlink,
  slideMarkup
} = pptx

function element(rect = {}) {
  return {
    rect,
    getBoundingClientRect() {
      return { left: 0, top: 0, right: 0, bottom: 0, width: 0, height: 0, ...this.rect }
    }
  }
}

function decodeSvg(dataUri) {
  const base64 = dataUri.split(",", 2)[1]
  return Buffer.from(base64, "base64").toString("utf8")
}

function installDom(scripts = []) {
  globalThis.document = {
    head: { append: (script) => scripts.push(script) },
    body: { children: [], append(...nodes) { this.children.push(...nodes) } },
    createElement: (tagName) => {
      if (tagName === "script") return { remove() { this.removed = true } }
      return { tagName: tagName.toUpperCase(), className: "", innerHTML: "", style: {}, remove() { this.removed = true }, click() { this.clicked = true } }
    }
  }
  return scripts
}

function slide(overrides = {}) {
  return {
    index: 0,
    layout: "default",
    title_html: null,
    blocks: [],
    regions: [],
    footnote_html: null,
    section: null,
    subsection: null,
    title_position: null,
    ...overrides
  }
}

function model(overrides = {}) {
  return {
    filename: "deck.pptx",
    version: 3,
    presentation: { title: "Deck", theme: "dark", typography: "editorial", fonts: { body: "Body, serif", editorial: "Editorial, serif", technical: "Technical, serif" } },
    margin_settings: {},
    slides: [],
    ...overrides
  }
}

test("primaryFont takes the first family and falls back when the stack is empty", () => {
  assert.equal(primaryFont("Avenir Next, Helvetica, sans-serif"), "Avenir Next")
  assert.equal(primaryFont("'Iowan Old Style', serif"), "Iowan Old Style")
  assert.equal(primaryFont('"Georgia", serif'), "Georgia")
  assert.equal(primaryFont(undefined), "Arial")
  assert.equal(primaryFont(""), "Arial")
  assert.equal(primaryFont("  ,  serif"), "Arial")
})

test("escapeHtml encodes every character that could break out of markup", () => {
  assert.equal(escapeHtml(`<script>alert("x" & 'y')</script>`), "&lt;script&gt;alert(&quot;x&quot; &amp; &#39;y&#39;)&lt;/script&gt;")
  assert.equal(escapeHtml(42), "42")
  assert.equal(escapeHtml(null), "null")
})

test("colorHex converts computed rgb colors and falls back on unusable input", () => {
  assert.equal(colorHex("rgb(37, 42, 39)"), "252A27")
  assert.equal(colorHex("rgba(37, 42, 39, 0.5)"), "252A27")
  assert.equal(colorHex("rgb(255, 0, 128)"), "FF0080")
  assert.equal(colorHex("transparent"), "252A27")
  assert.equal(colorHex(""), "252A27")
  assert.equal(colorHex("#252A27"), "252A27")
  assert.equal(colorHex("nonsense", "000000"), "000000")
})

test("pixelRectToInches converts at 96 pixels per inch and keeps a visible minimum", () => {
  assert.deepEqual(pixelRectToInches({ left: 192, top: 96, width: 480, height: 288 }), { x: 2, y: 1, w: 5, h: 3 })
  assert.deepEqual(pixelRectToInches({ left: 0, top: 0, width: 0, height: 0 }), { x: 0, y: 0, w: 0.001, h: 0.001 })
})

test("relativeRect positions an element against its slide root", () => {
  const root = element({ left: 100, top: 50, width: 1280, height: 720 })
  const block = element({ left: 148, top: 158, width: 384, height: 96 })

  assert.deepEqual(relativeRect(block, root), { left: 48, top: 108, width: 384, height: 96 })
})

test("cssFontSize and cssCharSpacing convert css pixels to points", () => {
  assert.equal(cssFontSize({ fontSize: "16px" }), 12)
  assert.equal(cssFontSize({ fontSize: "24px" }), 18)
  assert.equal(cssFontSize({}), 12)
  assert.equal(cssFontSize({ fontSize: "0.5px" }), 1)
  assert.equal(cssFontSize({ fontSize: "0px" }), 12)
  assert.equal(cssCharSpacing({ letterSpacing: "2px" }), 1.5)
  assert.equal(cssCharSpacing({ letterSpacing: "normal" }), 0)
  assert.equal(cssCharSpacing({}), 0)
})

test("cssLineSpacingMultiple only reports usable line heights", () => {
  assert.equal(cssLineSpacingMultiple({ lineHeight: "24px", fontSize: "16px" }), 1.5)
  assert.equal(cssLineSpacingMultiple({ lineHeight: "32px", fontSize: "16px" }), 2)
  assert.equal(cssLineSpacingMultiple({ lineHeight: "normal", fontSize: "16px" }), 1.1)
  assert.equal(cssLineSpacingMultiple({ fontSize: "16px" }), 1.1)
})

test("safeHyperlink allows only absolute http, mailto, and tel targets", () => {
  assert.equal(safeHyperlink("https://elef.test/deck"), true)
  assert.equal(safeHyperlink("HTTP://elef.test"), true)
  assert.equal(safeHyperlink("mailto:someone@elef.test"), true)
  assert.equal(safeHyperlink("tel:+15550100"), true)
  assert.equal(safeHyperlink("javascript:alert(1)"), false)
  assert.equal(safeHyperlink("/documents/1"), false)
  assert.equal(safeHyperlink("data:text/html,<script>"), false)
  assert.equal(safeHyperlink(""), false)
})

test("gradientBackground returns a base64 svg for every known theme", () => {
  for (const [theme, start] of [["dark", "#202c32"], ["light", "#fffdf8"], ["match", "#fcfaf5"], ["unknown", "#fcfaf5"]]) {
    const dataUri = gradientBackground(theme)
    assert.match(dataUri, /^data:image\/svg\+xml;base64,/)
    const svg = decodeSvg(dataUri)
    assert.match(svg, new RegExp(`stop-color="${start}"`))
    assert.match(svg, /viewBox="0 0 1280 720"/)
  }
})

test("blockMarkup keeps html and applies explicit or default position classes", () => {
  assert.equal(blockMarkup({ html: "<p>Hi</p>", position: { horizontal: "start", vertical: "middle" } }), '<div class="slide-block position-start position-middle"><p>Hi</p></div>')
  assert.equal(blockMarkup({ html: "<p>Hi</p>", position: null }), '<div class="slide-block position-left position-top"><p>Hi</p></div>')
})

test("slideMarkup renders a title layout with regions and margins", () => {
  const markup = slideMarkup(slide({
    index: 1,
    layout: "title",
    section: "Intro",
    subsection: "Part",
    title_html: "<h1>Deck</h1>",
    title_position: { horizontal: "start", vertical: "end" },
    regions: [[{ html: "<p>One</p>", position: null }], [{ html: "<p>Two</p>", position: null }]]
  }), model({ slides: [{}, {}], margin_settings: { section: "Intro", subsection: "Part", slide_count: true } }))

  assert.match(markup, /<div class="slide-frame" style="height:720px;width:1280px">/)
  assert.match(markup, /<section class="slide slide-title" aria-label="Slide 2">/)
  assert.match(markup, /<div class="slide-title slide-block position-start position-top"><h1>Deck<\/h1><\/div>/)
  assert.equal(markup.match(/<div class="slide-region">/g).length, 2)
  assert.match(markup, /<span class="slide-margin-subsection">Part<\/span><span class="slide-margin-section">Intro<\/span>/)
  assert.match(markup, /<span class="slide-margin-count">2 \/ 2<\/span>/)
})

test("PPTX stage groups middle stacks, lanes, docking, and default positions", () => {
  const markup = slideMarkup(slide({
    blocks: [
      { html: "<h1>Title</h1>", position: { horizontal: "center", vertical: "middle" } },
      { html: "<p>Subtitle</p>", position: null },
      { html: "<p>Footer</p>", position: { horizontal: "right", vertical: "bottom" } }
    ]
  }), model())

  assert.match(markup, /class="slide-middle-group flush-bottom"/)
  assert.match(markup, /class="slide-bottom-lane"/)
  assert.match(markup, /<div class="slide-block position-left position-top"><p>Subtitle<\/p><\/div>/)
})

test("slideMarkup escapes the layout and falls back to an empty-slide placeholder", () => {
  const markup = slideMarkup(slide({ layout: '"><script>' }), model())

  assert.match(markup, /<section class="slide slide-&quot;&gt;&lt;script&gt;"/)
  assert.match(markup, /<p class="empty-slide">Empty slide<\/p>/)
})

test("slideMarkup renders blocks and a footnote only when they are enabled", () => {
  const markup = slideMarkup(slide({
    blocks: [{ html: "<p>Body</p>", position: { horizontal: "center", vertical: "start" } }],
    footnote_html: "<span>* note</span>"
  }), model({ margin_settings: { slide_count: true, footnote: true }, slides: [{}] }))

  assert.match(markup, /<div class="slide-block position-center position-start"><p>Body<\/p><\/div>/)
  assert.match(markup, /<span class="slide-margin-footnote-marker">\*<\/span><span class="slide-margin-footnote-text"><span>\* note<\/span><\/span>/)
  assert.match(markup, /<span class="slide-margin-count">1 \/ 1<\/span>/)

  const bare = slideMarkup(slide({ footnote_html: "<span>* note</span>" }), model())
  assert.doesNotMatch(bare, /slide-margin-footnote/)
})

test("createRenderStage mirrors the work theme and typography classes onto a hidden stage", () => {
  installDom()

  const stage = createRenderStage(model({ slides: [slide({ index: 0 }), slide({ index: 1 })] }))

  assert.equal(stage.className, "pptx-render-stage presentation-surface work-theme-dark work-typography-editorial slides-theme-dark slides-typography-editorial")
  assert.match(stage.style.cssText, /position:fixed/)
  assert.equal(stage.innerHTML.match(/<div class="slide-frame"/g).length, 2)
})

test("createPresentation configures layout, metadata, and theme fonts", () => {
  const calls = []
  class PptxGenJS {
    defineLayout(layout) { calls.push(["defineLayout", layout]) }
    addSlide() { return {} }
  }
  globalThis.window = { PptxGenJS }

  const built = createPresentation(model())
  built.layout = "ELEF_16_9"
  built.author = "Elef"

  assert.deepEqual(calls, [["defineLayout", { name: "ELEF_16_9", width: 40 / 3, height: 7.5 }]])
  assert.equal(built.subject, "Deck · 3")
  assert.equal(built.title, "Deck")
  assert.equal(built.company, "Elef")
  assert.deepEqual(built.theme, { headFontFace: "Editorial", bodyFontFace: "Body", lang: "en-US" })

  const technical = createPresentation(model({
    presentation: { title: "Deck", theme: "dark", typography: "technical", fonts: { body: "Body, serif", editorial: "Editorial, serif", technical: "Technical, serif" } }
  }))
  assert.equal(technical.theme.headFontFace, "Technical")
})

test("dataUriToBlob decodes base64 and percent-encoded payloads with their content type", () => {
  const base64 = dataUriToBlob("data:image/png;base64,aGVsbG8=")
  assert.equal(base64.type, "image/png")
  assert.equal(base64.size, 5)

  const encoded = dataUriToBlob("data:image/svg+xml,%3Csvg%3E%3C%2Fsvg%3E")
  assert.equal(encoded.type, "image/svg+xml")
  assert.equal(encoded.size, 11)

  const bare = dataUriToBlob("data:application/octet-stream,aGk")
  assert.equal(bare.type, "application/octet-stream")
  assert.equal(bare.size, 3)
})

test("loadPptxLibrary resolves immediately when the library is already present", async () => {
  const scripts = []
  globalThis.window = { PptxGenJS: class {} }
  installDom(scripts)

  await loadPptxLibrary("/assets/pptxgen.js")

  assert.deepEqual(scripts, [])
})

test("loadPptxLibrary reports both failure modes and retries after each one", async () => {
  const scripts = []
  globalThis.window = {}
  installDom(scripts)

  const withoutLibrary = loadPptxLibrary("/assets/pptxgen.js")
  scripts[0].onload()
  await assert.rejects(withoutLibrary, /did not load/)
  assert.equal(scripts[0].removed, true)

  const failing = loadPptxLibrary("/assets/pptxgen.js")
  assert.equal(scripts.length, 2)
  scripts[1].onerror()
  await assert.rejects(failing, /could not be loaded/)
  assert.equal(scripts[1].removed, true)

  const retry = loadPptxLibrary("/assets/pptxgen.js")
  assert.equal(scripts.length, 3)
  globalThis.window.PptxGenJS = class {}
  scripts[2].onload()
  await retry
})
