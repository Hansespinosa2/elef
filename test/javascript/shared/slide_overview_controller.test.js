import assert from "node:assert/strict"
import test from "node:test"
import { readFile } from "node:fs/promises"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { parseHTML } from "linkedom"

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..")
const source = (await readFile(path.join(root, "app/javascript/controllers/slide_overview_controller.js"), "utf8"))
  .replace('import { Controller } from "@hotwired/stimulus"', "class Controller {}")
const slideOverview = await import(`data:text/javascript;base64,${Buffer.from(source).toString("base64")}`)

test("slide overview thumbnails clone only inert slide content", () => {
  const previous = {
    document: globalThis.document,
    requestAnimationFrame: globalThis.requestAnimationFrame,
    htmlVideoElement: globalThis.HTMLVideoElement,
    intersectionObserver: globalThis.IntersectionObserver
  }
  const { document } = parseHTML(`
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
        <output></output>
      </form>
    </body></html>
  `)
  globalThis.document = document
  globalThis.requestAnimationFrame = () => 1
  globalThis.HTMLVideoElement = class HTMLVideoElement {}

  try {
    const form = document.querySelector("form")
    const grid = document.querySelector(".slide-overview-grid")
    const originalSlide = document.querySelector(".presentation-editor-projection .slide")
    const controller = new slideOverview.default()
    Object.assign(controller, {
      element: form,
      gridTarget: grid,
      hasGridTarget: true,
      countTarget: document.querySelector("output"),
      preview: document.querySelector(".presentation-editor-projection"),
      selectedIndex: 0,
      projectionPending: false,
      sourceRanges: () => [{ start: 0, end: 1 }],
      updateActionAvailability: () => {}
    })

    controller.renderOverview()

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
  } finally {
    globalThis.document = previous.document
    globalThis.requestAnimationFrame = previous.requestAnimationFrame
    globalThis.HTMLVideoElement = previous.htmlVideoElement
    globalThis.IntersectionObserver = previous.intersectionObserver
  }
})

test("large slide overviews clone thumbnails only near the visible scroll area", () => {
  const previous = {
    document: globalThis.document,
    requestAnimationFrame: globalThis.requestAnimationFrame,
    htmlVideoElement: globalThis.HTMLVideoElement,
    intersectionObserver: globalThis.IntersectionObserver
  }
  const { document } = parseHTML(`
    <html><body><form>
      <div class="presentation-editor-projection">
        <div class="slide-frame"><section class="slide"><h1>One</h1></section></div>
        <div class="slide-frame"><section class="slide"><h1>Two</h1></section></div>
        <div class="slide-frame"><section class="slide"><h1>Three</h1></section></div>
      </div>
      <div class="slide-overview-grid"></div><output></output>
    </form></body></html>
  `)
  let observer
  globalThis.document = document
  globalThis.requestAnimationFrame = () => 1
  globalThis.HTMLVideoElement = class HTMLVideoElement {}
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

  try {
    const form = document.querySelector("form")
    const grid = document.querySelector(".slide-overview-grid")
    const controller = new slideOverview.default()
    Object.assign(controller, {
      element: form,
      gridTarget: grid,
      hasGridTarget: true,
      countTarget: document.querySelector("output"),
      preview: document.querySelector(".presentation-editor-projection"),
      selectedIndex: 0,
      projectionPending: false,
      sourceRanges: () => [{}, {}, {}],
      updateActionAvailability: () => {}
    })

    controller.renderOverview()

    const cards = [...grid.querySelectorAll(".slide-overview-card")]
    assert.equal(cards.length, 3)
    assert.equal(observer.options.root, grid)
    assert.equal(observer.options.rootMargin, "80px")
    assert.equal(cards.filter(card => card.querySelector(".slide-frame")).length, 0)
    observer.callback([{ target: cards[0], isIntersecting: true }])
    assert.equal(cards[0].querySelector(".slide-overview-thumbnail > .slide-frame > .slide h1").textContent, "One")
    assert.equal(cards[1].querySelector(".slide-frame"), null)
    assert.equal(observer.observed.includes(cards[0]), false)
    assert.equal(observer.observed.includes(cards[1]), true)
  } finally {
    globalThis.document = previous.document
    globalThis.requestAnimationFrame = previous.requestAnimationFrame
    globalThis.HTMLVideoElement = previous.htmlVideoElement
    globalThis.IntersectionObserver = previous.intersectionObserver
  }
})
