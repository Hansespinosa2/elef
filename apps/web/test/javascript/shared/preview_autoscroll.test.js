import assert from "node:assert/strict"
import test from "node:test"
import { parseHTML } from "linkedom"

import { loadPackageSource } from "./package_source.mjs"

const source = await loadPackageSource("packages/editor-runtime/src/lib/preview_autoscroll.ts")
const { computeSourceEditScrollTop, scrollPreviewToSourceOffset } = await import(
  `data:text/javascript;base64,${Buffer.from(source).toString("base64")}`
)

function layout(element, { scrollHeight = 0, clientHeight = 0, scrollTop = 0, rect = null } = {}) {
  Object.defineProperty(element, "scrollHeight", { value: scrollHeight, configurable: true })
  Object.defineProperty(element, "clientHeight", { value: clientHeight, configurable: true })
  element.scrollTop = scrollTop
  if (rect) element.getBoundingClientRect = () => ({ ...rect, height: rect.bottom - rect.top, toJSON: () => ({}) })
  return element
}

function makeDocumentHarness({ scrollTop = 0, clientHeight = 500, scrollHeight = 3000 } = {}) {
  const { document } = parseHTML(`
    <div id="preview">
      <div class="document-editor-projection">
        <div class="document-surface" data-document-pages-target="surface">
          <div class="document-page-frame is-quiet">
            <div class="document-editor-block" data-editor-block-id="b1">Intro</div>
          </div>
          <div class="document-page-frame is-quiet">
            <div class="document-editor-block" data-editor-block-id="b2">Middle A</div>
            <div class="document-editor-block" data-editor-block-id="b3">Middle B</div>
          </div>
          <div class="document-page-frame is-quiet">
            <div class="document-editor-block" data-editor-block-id="b4">Ending</div>
          </div>
        </div>
      </div>
    </div>
  `)
  const container = document.querySelector("#preview")
  layout(container, { scrollHeight, clientHeight, scrollTop, rect: { top: 0, bottom: clientHeight } })

  const block = id => container.querySelector(`[data-editor-block-id="${id}"]`)
  // Positions in document coordinates, shifted by current scrollTop for getBoundingClientRect
  const positions = {
    b1: { top: 40, bottom: 140 },
    b2: { top: 1200, bottom: 1350 },
    b3: { top: 1400, bottom: 1550 },
    b4: { top: 2700, bottom: 2900 }
  }
  for (const [id, pos] of Object.entries(positions)) {
    const el = block(id)
    el.getBoundingClientRect = () => {
      const frame = el.closest(".document-page-frame")
      if (frame?.classList.contains("is-quiet")) {
        return { top: 0, bottom: 0, height: 0, toJSON: () => ({}) }
      }
      const top = pos.top - container.scrollTop
      const bottom = pos.bottom - container.scrollTop
      return { top, bottom, height: bottom - top, toJSON: () => ({}) }
    }
  }

  const editorMap = {
    mode: "document",
    front_matter: { range: { start: 0, end: 20 }, body_start: 20 },
    slides: [{
      id: "slide-1",
      index: 0,
      range: { start: 20, end: 400 },
      blocks: [
        { id: "b1", index: 0, kind: "heading", range: { start: 20, end: 60 }, source_range: { start: 20, end: 60 }, content_range: { start: 22, end: 60 } },
        { id: "b2", index: 1, kind: "paragraph", range: { start: 62, end: 200 }, source_range: { start: 62, end: 200 }, content_range: { start: 62, end: 200 } },
        { id: "b3", index: 2, kind: "paragraph", range: { start: 202, end: 300 }, source_range: { start: 202, end: 300 }, content_range: { start: 202, end: 300 } },
        { id: "b4", index: 3, kind: "paragraph", range: { start: 302, end: 390 }, source_range: { start: 302, end: 390 }, content_range: { start: 302, end: 390 } }
      ]
    }]
  }

  return { container, editorMap }
}

test("editing in frontmatter or beginning of document scrolls to top (0)", () => {
  const { container, editorMap } = makeDocumentHarness({ scrollTop: 1800 })
  assert.equal(computeSourceEditScrollTop(container, editorMap, 10), 0)
  assert.equal(computeSourceEditScrollTop(container, editorMap, 25), 0)
})

test("editing at the end of document or trailing lines scrolls to maxScrollTop", () => {
  const { container, editorMap } = makeDocumentHarness({ scrollTop: 0 })
  assert.equal(computeSourceEditScrollTop(container, editorMap, 395), 2500)
  assert.equal(computeSourceEditScrollTop(container, editorMap, 380), 2500)
})

test("editing in the middle when preview is elsewhere autoscrolls to upper third", () => {
  const { container, editorMap } = makeDocumentHarness({ scrollTop: 0 })
  // b2 is at 1200..1350; offset 62 -> progress 0 -> targetY = 1200 -> 1200 - 500 * 0.33 = 1035
  const nextTop = computeSourceEditScrollTop(container, editorMap, 62)
  assert.equal(nextTop, 1035)
  assert.equal(scrollPreviewToSourceOffset(container, editorMap, 62), true)
  assert.equal(container.scrollTop, 1035)
})

test("editing a block already comfortably in view does not jump scrollTop", () => {
  const { container, editorMap } = makeDocumentHarness({ scrollTop: 1035 })
  // b2 is at 1200..1350 -> relative to scrollTop 1035, that's 165..315 inside 0..500 (comfort band 75..400)
  assert.equal(computeSourceEditScrollTop(container, editorMap, 100), 1035)
})

test("quiet frames are temporarily un-quieted for measurement and restored", () => {
  const { container, editorMap } = makeDocumentHarness({ scrollTop: 0 })
  const frames = [...container.querySelectorAll(".document-page-frame")]
  scrollPreviewToSourceOffset(container, editorMap, 130)
  assert.ok(container.scrollTop > 900)
  assert.ok(frames.every(frame => frame.classList.contains("is-quiet")))
})

test("interpolates across multi-fragment paginated blocks", () => {
  const { document } = parseHTML(`
    <div id="preview">
      <div class="document-editor-block" data-editor-block-id="b1">First</div>
      <div class="document-editor-block" data-editor-block-id="b2">Part 1</div>
      <div class="document-editor-block" data-editor-block-id="b2">Part 2</div>
      <div class="document-editor-block" data-editor-block-id="b3">Last</div>
    </div>
  `)
  const container = document.querySelector("#preview")
  layout(container, { scrollHeight: 3000, clientHeight: 500, scrollTop: 0, rect: { top: 0, bottom: 500 } })
  const frags = [...container.querySelectorAll("[data-editor-block-id='b2']")]
  layout(container.querySelector("[data-editor-block-id='b1']"), { rect: { top: 20, bottom: 100 } })
  layout(frags[0], { rect: { top: 400, bottom: 900 } })
  layout(frags[1], { rect: { top: 1000, bottom: 1500 } })
  layout(container.querySelector("[data-editor-block-id='b3']"), { rect: { top: 2800, bottom: 2900 } })

  const editorMap = {
    mode: "document",
    slides: [{
      id: "slide-1",
      index: 0,
      range: { start: 0, end: 300 },
      blocks: [
        { id: "b1", index: 0, kind: "paragraph", range: { start: 0, end: 40 }, source_range: { start: 0, end: 40 }, content_range: { start: 0, end: 40 } },
        { id: "b2", index: 1, kind: "paragraph", range: { start: 50, end: 250 }, source_range: { start: 50, end: 250 }, content_range: { start: 50, end: 250 } },
        { id: "b3", index: 2, kind: "paragraph", range: { start: 260, end: 300 }, source_range: { start: 260, end: 300 }, content_range: { start: 260, end: 300 } }
      ]
    }]
  }

  // Offset 200 -> 75% through b2 -> 50% into Part 2 -> targetY = 1250 -> 1250 - 165 = 1085
  assert.equal(computeSourceEditScrollTop(container, editorMap, 200), 1085)
})

test("falls back between neighboring id'd blocks when an uneditable block has no data-editor-block-id", () => {
  const { document } = parseHTML(`
    <div id="preview">
      <div class="document-editor-block" data-editor-block-id="b1">Before</div>
      <div class="document-editor-block" contenteditable="false"><pre>code</pre></div>
      <div class="document-editor-block" data-editor-block-id="b3">After</div>
    </div>
  `)
  const container = document.querySelector("#preview")
  layout(container, { scrollHeight: 3000, clientHeight: 500, scrollTop: 0, rect: { top: 0, bottom: 500 } })
  layout(container.querySelector("[data-editor-block-id='b1']"), { rect: { top: 500, bottom: 600 } })
  layout(container.querySelector("[data-editor-block-id='b3']"), { rect: { top: 1600, bottom: 1700 } })

  const editorMap = {
    mode: "document",
    slides: [{
      id: "slide-1",
      index: 0,
      range: { start: 0, end: 300 },
      blocks: [
        { id: "b1", index: 0, kind: "paragraph", range: { start: 0, end: 50 }, source_range: { start: 0, end: 50 }, content_range: { start: 0, end: 50 } },
        { id: "b2", index: 1, kind: "code", range: { start: 60, end: 160 }, source_range: { start: 60, end: 160 }, content_range: { start: 60, end: 160 } },
        { id: "b3", index: 2, kind: "paragraph", range: { start: 170, end: 220 }, source_range: { start: 170, end: 220 }, content_range: { start: 170, end: 220 } }
      ]
    }]
  }

  // Offset 110 is halfway between b1.end (50) and b3.start (170): targetY = 600 + 0.5 * (1600 - 600) = 1100 -> 1100 - 165 = 935
  assert.equal(computeSourceEditScrollTop(container, editorMap, 110), 935)
})

test("handles presentation mode slides cleanly", () => {
  const { document } = parseHTML(`
    <div id="preview">
      <div class="slide-frame"><section class="slide" data-slide-index="0"><div data-editor-block-id="s1b1">Slide 1</div></section></div>
      <div class="slide-frame"><section class="slide" data-slide-index="1"><div data-editor-block-id="s2b1">Slide 2</div></section></div>
      <div class="slide-frame"><section class="slide" data-slide-index="2"><div data-editor-block-id="s3b1">Slide 3</div></section></div>
    </div>
  `)
  const container = document.querySelector("#preview")
  layout(container, { scrollHeight: 2400, clientHeight: 600, scrollTop: 0, rect: { top: 0, bottom: 600 } })
  layout(container.querySelector("[data-editor-block-id='s1b1']"), { rect: { top: 40, bottom: 120 } })
  layout(container.querySelector("[data-editor-block-id='s2b1']"), { rect: { top: 900, bottom: 1000 } })
  layout(container.querySelector("[data-editor-block-id='s3b1']"), { rect: { top: 2050, bottom: 2200 } })

  const editorMap = {
    mode: "presentation",
    slides: [
      { id: "slide-1", index: 0, range: { start: 0, end: 40 }, blocks: [{ id: "s1b1", index: 0, kind: "heading", range: { start: 0, end: 40 }, source_range: { start: 0, end: 40 }, content_range: { start: 2, end: 40 } }] },
      { id: "slide-2", index: 1, range: { start: 45, end: 100 }, blocks: [{ id: "s2b1", index: 0, kind: "paragraph", range: { start: 45, end: 100 }, source_range: { start: 45, end: 100 }, content_range: { start: 45, end: 100 } }] },
      { id: "slide-3", index: 2, range: { start: 105, end: 160 }, blocks: [{ id: "s3b1", index: 0, kind: "paragraph", range: { start: 105, end: 160 }, source_range: { start: 105, end: 160 }, content_range: { start: 105, end: 160 } }] }
    ]
  }

  assert.equal(computeSourceEditScrollTop(container, editorMap, 10), 0)
  // Gap between slide 0 (end 40) and slide 1 (start 45) resolves to slide 1, not the last slide
  assert.equal(computeSourceEditScrollTop(container, editorMap, 42), 702)
  // s2b1: 900..1000, offset 45 -> 900 - 600 * 0.33 = 702
  assert.equal(computeSourceEditScrollTop(container, editorMap, 45), 702)
  assert.equal(computeSourceEditScrollTop(container, editorMap, 150), 1800)
})

test("tall first and last blocks scroll to the edit position instead of pinning to extremes", () => {
  const { document } = parseHTML(`
    <div id="preview">
      <div class="document-editor-block" data-editor-block-id="b1">Tall first</div>
      <div class="document-editor-block" data-editor-block-id="b2">Tall last</div>
    </div>
  `)
  const container = document.querySelector("#preview")
  layout(container, { scrollHeight: 4000, clientHeight: 500, scrollTop: 0, rect: { top: 0, bottom: 500 } })
  layout(container.querySelector("[data-editor-block-id='b1']"), { rect: { top: 0, bottom: 2000 } })
  layout(container.querySelector("[data-editor-block-id='b2']"), { rect: { top: 2000, bottom: 4000 } })

  const editorMap = {
    mode: "document",
    slides: [{
      id: "slide-1",
      index: 0,
      range: { start: 0, end: 200 },
      blocks: [
        { id: "b1", index: 0, kind: "paragraph", range: { start: 0, end: 100 }, source_range: { start: 0, end: 100 }, content_range: { start: 0, end: 100 } },
        { id: "b2", index: 1, kind: "paragraph", range: { start: 102, end: 200 }, source_range: { start: 102, end: 200 }, content_range: { start: 102, end: 200 } }
      ]
    }]
  }

  // Bottom of tall first block (offset 90 -> targetY 1800) should scroll down, not pin to 0
  assert.equal(computeSourceEditScrollTop(container, editorMap, 90), 1635)
  // Top of tall last block (offset 105 -> targetY ~2061) should scroll to upper third, not pin to 3500
  const topOfLast = computeSourceEditScrollTop(container, editorMap, 105)
  assert.ok(topOfLast > 1800 && topOfLast < 2100, `expected top of tall last block, got ${topOfLast}`)
})
