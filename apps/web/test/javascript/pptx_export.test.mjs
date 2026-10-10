import assert from "node:assert/strict"
import test from "node:test"

// The engine moved to the shared client export feature (the Stimulus
// controller is retired); behavior coverage now imports the client barrel.
// Unit coverage of the engine internals lives with the owning package
// (packages/client/test/export.test.ts); this suite exercises the public
// verbs plus the model export end to end through seams.
import { exportPptxModel } from "@elef/client"
import { createPresentation, createRenderStage, loadPptxLibrary } from "@elef/client/pptx-test-internals"

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

test("exportPptxModel orchestrates library, stage, render, and blob through seams", async () => {
  installDom()
  const seen = []
  let written = false
  class FakePptx {
    constructor() { this.slides = [] }
    defineLayout() {}
    addSlide() {
      const slide = {}
      this.slides.push(slide)
      return slide
    }
    async write(options) {
      written = true
      assert.equal(options.outputType, "blob")
      return { kind: "blob", slides: this.slides.length }
    }
  }

  const blob = await exportPptxModel(model({ slides: [slide({ index: 0 })] }), {
    libraryUrl: "https://example.com/pptx.js",
    loadLibrary: async (url) => { seen.push(url) },
    PptxGenJS: FakePptx,
    document: globalThis.document,
    prepareMedia: async () => ({ media: new Map(), objectUrls: [] }),
    renderSlides: async (pptx) => { pptx.addSlide() }
  })

  assert.deepEqual(seen, ["https://example.com/pptx.js"])
  assert.equal(written, true)
  assert.deepEqual(blob, { kind: "blob", slides: 1 })
  assert.deepEqual(globalThis.document.body.children.filter((child) => !child.removed), [])
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
