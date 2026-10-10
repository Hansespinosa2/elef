import assert from "node:assert/strict"
import { readFile } from "node:fs/promises"
import { performance } from "node:perf_hooks"
import test from "node:test"
import { parseHTML } from "linkedom"
import { renderPreview } from "../../app/javascript/lib/renderer.js"
import { slidePositionLayout } from "../../app/javascript/lib/slide_position_layout.js"

const corpus = JSON.parse(await readFile(new URL("../../docs/align-directives-grammar/fixtures.json", import.meta.url), "utf8"))

function renderedBlocks(container) {
  return [...container.querySelectorAll(".slide-block")]
}

function blockLabel(block) {
  return block.textContent.trim().replace(/\s+/g, " ")
}

function labels(group) {
  return renderedBlocks(group).map(blockLabel)
}

for (const fixture of corpus.fixtures) {
  test(`${fixture.id} JS renderer placement`, () => {
    const preview = renderPreview({ source: fixture.source, title: fixture.id })
    const { document } = parseHTML(`<html><body>${preview.html}</body></html>`)
    const slide = document.querySelector(".slide")
    const expected = fixture.expected

    assert.ok(slide.classList.contains(`slide-${expected.layout}`), `${fixture.id} layout`)
    const groups = [...slide.querySelectorAll(".slide-middle-group")]
    const lanes = [...slide.querySelectorAll(".slide-bottom-lane")]
    const regionPlacements = [...slide.querySelectorAll(".slide-region")].map(region => ({
      middleGroups: [...region.querySelectorAll(".slide-middle-group")].map(labels),
      bottomLanes: [...region.querySelectorAll(".slide-bottom-lane")].map(labels)
    }))
    assert.deepEqual(groups.map(labels), expected.middleGroups, `${fixture.id} middle groups`)
    assert.deepEqual(lanes.map(labels), expected.bottomLanes, `${fixture.id} bottom lanes`)
    if (expected.regionPlacements) assert.deepEqual(regionPlacements, expected.regionPlacements, `${fixture.id} per-region placement`)
    assert.equal(groups.filter(group => group.classList.contains("flush-bottom")).length, expected.flushBottom ? 1 : 0)
    assert.equal(preview.warnings.length, expected.warningPatterns.length, `${fixture.id} warning count`)
    expected.warningPatterns.forEach(pattern => {
      assert.ok(preview.warnings.some(warning => warning.toLowerCase().includes(pattern)), `${fixture.id} warning ${pattern}`)
    })

    for (const [text, classes] of Object.entries(expected.blockClasses)) {
      const block = renderedBlocks(slide).find(candidate => blockLabel(candidate).includes(text))
      assert.ok(block, `${fixture.id} block ${text}`)
      for (const className of classes) assert.ok(block.classList.contains(className), `${fixture.id} ${text} has ${className}`)
    }

    for (const item of slide.querySelectorAll(".slide-block-item")) {
      const block = item.querySelector(".slide-block[data-editor-block-id]")
      const control = item.querySelector("select[data-presentation-editor-align]")
      if (!block || !control) continue
      const sourceIndex = Number(block.getAttribute("data-editor-block-id").match(/block-(\d+)$/)?.[1]) - 1
      assert.equal(control.getAttribute("data-block-index"), String(sourceIndex), `${fixture.id} block control association`)
    }
  })
}

test("placement computation demotes non-trailing bottoms and docks a preceding stack", () => {
  const layout = slidePositionLayout([
    { position: { horizontal: "center", vertical: "middle" } },
    { position: { horizontal: "right", vertical: "bottom" } }
  ])

  assert.deepEqual(layout.entries, [
    { type: "middle", start: 0, end: 1, flushBottom: true },
    { type: "bottom", start: 1, end: 2 }
  ])
})

test("document mode does not report slide-only trailing-bottom placement warnings", () => {
  const source = ":::align{bottom}\nFirst paragraph\n\nSecond paragraph"
  const documentPreview = renderPreview({ source, kind: "document" })
  const presentationPreview = renderPreview({ source, kind: "presentation" })

  assert.equal(documentPreview.warnings.filter(warning => warning.includes("trailing bottom")).length, 0)
  assert.equal(presentationPreview.warnings.filter(warning => warning.includes("trailing bottom")).length, 1)
})

test("grouped Art controls remain inside their aligned block wrappers", () => {
  const leftRegion = [
    [
      ":::align{middle left}\n:::art\n- Stack left",
      "Left marker.",
      ":::align{middle center}\n:::art\n- Stack center",
      "Center marker.",
      ":::align{middle right}\n:::art\n- Stack right",
      "Middle footer separator.",
      ":::align{bottom left}\n:::art\n- Footer left",
      ":::align{bottom center}\nFooter marker.",
      ":::align{bottom center}\n:::art\n- Footer center",
      ":::align{bottom right}\nFooter marker.",
      ":::align{bottom right}\n:::art\n- Footer right"
    ].join("\n\n")
  ].join("")
  const source = [
    "# Deck",
    "## Left\n\n" + leftRegion,
    "## Right\n\nRight column text.",
    "## Third\n\nThird column text."
  ].join("\n\n")
  const preview = renderPreview({ source, title: "Grouped Art controls" })
  const { document } = parseHTML(`<html><body>${preview.html}</body></html>`)
  const slides = [...document.querySelectorAll(".slide")]
  const groupedArt = [...document.querySelectorAll(".slide-region-block")]
    .filter(region => region.querySelector("[data-elef-art-root]"))

  assert.equal(slides.length, 1)
  assert.equal(slides[0].querySelectorAll(".slide-region").length, 3)
  assert.equal(slides[0].querySelector(".slide-region[data-art-host='fixed']").querySelectorAll(".slide-middle-group").length, 1)
  assert.equal(slides[0].querySelectorAll(".slide-bottom-lane").length, 1)
  assert.equal(groupedArt.length, 6)
  for (const [index, artBlock] of groupedArt.entries()) {
    const controls = artBlock.querySelector(":scope > .presentation-editor-block-controls")
    const block = artBlock.querySelector(":scope > .slide-block[data-editor-block-id]")
    const select = controls?.querySelector("select[data-presentation-editor-align]")
    const sourceIndex = Number(block?.getAttribute("data-editor-block-id").match(/block-(\d+)$/)?.[1]) - 1

    assert.ok(controls, `Art block ${index} has controls as a direct child`)
    assert.ok(select, `Art block ${index} has an alignment control`)
    assert.equal(artBlock.parentElement.classList.contains("slide-block-item"), true)
    assert.equal(select.getAttribute("data-block-index"), String(sourceIndex))
    assert.ok(artBlock.classList.contains(`position-${["left", "center", "right"][index % 3]}`))
  }
})

test("placement stays linear for a long run of middle blocks", () => {
  const count = 30_000
  const blocks = Array.from({ length: count }, () => ({ position: { horizontal: "center", vertical: "middle" } }))
  const startedAt = performance.now()
  const layout = slidePositionLayout(blocks)
  const elapsed = performance.now() - startedAt

  assert.deepEqual(layout.entries, [{ type: "middle", start: 0, end: count, flushBottom: false }])
  assert.ok(elapsed < 1_500, `placing ${count} middle blocks took ${Math.round(elapsed)}ms`)
})
