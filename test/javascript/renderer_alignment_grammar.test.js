import assert from "node:assert/strict"
import { readFile } from "node:fs/promises"
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
