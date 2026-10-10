import assert from "node:assert/strict"
import test from "node:test"
import { parseHTML } from "linkedom"
import { SlideOverview } from "@elef/client"

function withDocument(html, run) {
  const previous = {
    document: globalThis.document,
    requestAnimationFrame: globalThis.requestAnimationFrame,
    htmlVideoElement: globalThis.HTMLVideoElement,
    intersectionObserver: globalThis.IntersectionObserver
  }
  const { document } = parseHTML(html)
  globalThis.document = document
  globalThis.requestAnimationFrame = () => 1
  globalThis.HTMLVideoElement = class HTMLVideoElement {}
  try {
    return run(document)
  } finally {
    globalThis.document = previous.document
    globalThis.requestAnimationFrame = previous.requestAnimationFrame
    globalThis.HTMLVideoElement = previous.htmlVideoElement
    globalThis.IntersectionObserver = previous.intersectionObserver
  }
}

function buildOverview(document) {
  return new SlideOverview({
    element: document.querySelector("form"),
    targets: {
      grid: document.querySelector(".slide-overview-grid"),
      count: document.querySelector("output"),
      warnings: document.querySelector(".slide-overview-warnings")
    },
    preview: document.querySelector(".presentation-editor-projection")
  })
}

test("slide overview thumbnails clone only inert slide content", () => {
  withDocument(`
    <html><body>
      <form>
        <div class="presentation-editor-projection">
          <div class="slide-frame">
            <section class="slide" data-controller="visual-editor" data-editor-slide-id="slide-1">
              <div class="presentation-editor-slide-toolbar">Toolbar controls</div>
              <h1>Visible heading</h1>
              <div contenteditable="true" data-action="input-&gt;visual-editor#projectionInput" data-editor-block-id="block-1">
                <a href="#deck/other" data-action="click-&gt;documents#open">Linked text</a>
              </div>
            </section>
          </div>
        </div>
        <div class="slide-overview-grid"></div>
        <div class="slide-overview-actions"><button></button><button></button><button></button><button></button><button></button></div>
        <div class="slide-overview-warnings"><ul></ul></div>
        <output></output>
      </form>
    </body></html>
  `, (document) => {
    const grid = document.querySelector(".slide-overview-grid")
    const originalSlide = document.querySelector(".presentation-editor-projection .slide")
    const overview = buildOverview(document)
    overview.selectedIndex = 0
    overview.projectionPending = false

    overview.renderOverview()

    const card = grid.querySelector(".slide-overview-card")
    const thumbnailSlide = card.querySelector(".slide-overview-thumbnail > .slide-frame > .slide")
    assert.notEqual(thumbnailSlide, originalSlide)
    assert.equal(thumbnailSlide.textContent.includes("Visible heading"), true)
    assert.equal(thumbnailSlide.textContent.includes("Toolbar controls"), false)
    assert.equal(thumbnailSlide.hasAttribute("data-controller"), false)
    assert.equal(thumbnailSlide.querySelector("[contenteditable]"), null)
    assert.equal(thumbnailSlide.querySelector("[data-action]"), null)
    assert.equal(card.querySelector(".slide-overview-label").textContent, "1. Visible heading")
    assert.equal(document.querySelector(".presentation-editor-projection .slide").hasAttribute("data-controller"), true)
    assert.equal(document.querySelector(".presentation-editor-projection .slide [contenteditable]").hasAttribute("data-action"), true)
  })
})

test("large slide overviews clone thumbnails only near the visible scroll area", () => {
  withDocument(`
    <html><body><form>
      <div class="presentation-editor-projection">
        <div class="slide-frame"><section class="slide"><h1>One</h1></section></div>
        <div class="slide-frame"><section class="slide"><h1>Two</h1></section></div>
        <div class="slide-frame"><section class="slide"><h1>Three</h1></section></div>
      </div>
      <div class="slide-overview-grid"></div>
      <div class="slide-overview-actions"><button></button><button></button><button></button><button></button><button></button></div>
      <div class="slide-overview-warnings"><ul></ul></div>
      <output></output>
      <input type="hidden" name="presentation[source]" value="One&#10;---&#10;Two&#10;---&#10;Three">
    </form></body></html>
  `, (document) => {
    let observer
    globalThis.IntersectionObserver = class {
      constructor(callback, options) {
        this.callback = callback
        this.options = options
        this.observed = []
        observer = this
      }
      observe(target) { this.observed.push(target) }
      unobserve(target) { this.observed = this.observed.filter(card => card !== target) }
      disconnect() { this.observed = [] }
    }

    const grid = document.querySelector(".slide-overview-grid")
    const overview = buildOverview(document)
    overview.selectedIndex = 0
    overview.projectionPending = false

    overview.renderOverview()

    const cards = [...grid.querySelectorAll(".slide-overview-card")]
    assert.equal(cards.length, 3)
    for (const card of cards) {
      assert.equal(card.getAttribute("data-editor-action"), "overview-select")
      assert.equal(card.hasAttribute("data-action"), false)
    }
    assert.equal(observer.options.root, grid)
    assert.equal(observer.options.rootMargin, "80px")
    assert.equal(cards.filter(card => card.querySelector(".slide-frame")).length, 0)
    observer.callback([{ target: cards[0], isIntersecting: true }])
    assert.equal(cards[0].querySelector(".slide-overview-thumbnail > .slide-frame > .slide h1").textContent, "One")
    assert.equal(cards[1].querySelector(".slide-frame"), null)
    assert.equal(observer.observed.includes(cards[0]), false)
    assert.equal(observer.observed.includes(cards[1]), true)
  })
})

test("slide overview operations rewrite the source through the editor seam", () => {
  const committed = []
  const editor = {
    value: "One\n---\nTwo",
    commitSource(source, options) { committed.push({ source, options }) },
    focus() {}
  }
  const overview = new SlideOverview({ editorProvider: () => editor })
  overview.selectedIndex = 0

  overview.duplicate()

  assert.equal(committed.length, 1)
  assert.equal(committed[0].source, "One\n---\nOne\n---\nTwo")
  assert.equal(overview.selectedIndex, 1)
  assert.equal(committed[0].options.caret, committed[0].source.length)

  editor.value = committed[0].source
  overview.delete()

  assert.equal(committed.length, 2)
  assert.equal(committed[1].source, "One\n---\nTwo")
  assert.equal(overview.selectedIndex, 1)
})

test("slide overview selection resolves cards from neutral native events", () => {
  withDocument(`
    <html><body><form>
      <div class="slide-overview-grid"></div>
      <div class="slide-overview-actions"><button></button><button></button><button></button><button></button><button></button></div>
      <div class="slide-overview-warnings"><ul></ul></div>
      <output></output>
      <input type="hidden" name="presentation[source]" value="One&#10;---&#10;Two">
    </form></body></html>
  `, (document) => {
    const overview = buildOverview(document)
    overview.selectedIndex = 0
    overview.projectionPending = false
    overview.renderOverview()

    const cards = [...document.querySelectorAll(".slide-overview-card")]
    assert.equal(cards.length, 2)
    const label = cards[1].querySelector(".slide-overview-label")
    overview.select({ currentTarget: document.querySelector("form"), target: label })
    assert.equal(overview.selectedIndex, 1)

    overview.projectionPending = true
    overview.select({ currentTarget: document.querySelector("form"), target: label })
    assert.equal(overview.selectedIndex, 1)
  })
})

test("slide overview source ranges skip front matter and fenced dividers", () => {
  const overview = new SlideOverview({})
  const source = "---\ntitle: Deck\n---\nOne\n```\n---\n```\n---\nTwo"
  const ranges = overview.sourceRanges(source)
  assert.equal(ranges.length, 2)
  assert.equal(source.slice(ranges[0].start, ranges[0].end).includes("One"), true)
  assert.equal(source.slice(ranges[1].start, ranges[1].end), "Two")
})
