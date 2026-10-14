import assert from "node:assert/strict"
import test from "node:test"
import { parseHTML } from "linkedom"
import { renderArtBlock, renderPreviewCore } from "@elef/renderer"
import { editorChrome } from "@elef/editor-runtime/editor-chrome"
import { resolveArtBindings } from "@elef/work-model"
import { sequenceHorizontalEligible } from "@elef/editor-runtime/art-layout"

const renderPreview = input => renderPreviewCore(input, { chrome: editorChrome })

const SAMPLE_LIMIT = 400
const ROOT_TYPES = ["unordered", "ordered"]
const ITEM_COUNTS = [1, 2, 3, 4, 5, 6, 8, 12, 20]
const LEAD_LENGTHS = ["short", "medium", "long", "unbreakable"]
const BODIES = ["none", "paragraph", "unordered", "ordered", "mixed"]
const DEPTHS = [0, 1, 2, 3, 4]
const DELIMITERS = [".", ")"]
const STARTS = [0, 1, 3]
const LOOSE = [false, true]
const HOST_WIDTHS = [220, 280, 341, 536, 673, 800, 1120]
const HOST_HEIGHTS = [140, 240, 360, 560]
const THEMES = ["light", "dark", "paper"]
const TYPOGRAPHY = ["book", "modern", "technical"]

function seeded(seed) {
  let state = seed >>> 0
  return () => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0
    return state / 0x1_0000_0000
  }
}

function pick(random, values) {
  return values[Math.floor(random() * values.length)]
}

function generatedCases() {
  const random = seeded(0xE1EF)
  return Array.from({ length: SAMPLE_LIMIT }, () => ({
    rootType: pick(random, ROOT_TYPES),
    itemCount: pick(random, ITEM_COUNTS),
    leadLength: pick(random, LEAD_LENGTHS),
    body: pick(random, BODIES),
    depth: pick(random, DEPTHS),
    delimiter: pick(random, DELIMITERS),
    start: pick(random, STARTS),
    loose: pick(random, LOOSE),
    hostWidth: pick(random, HOST_WIDTHS),
    hostHeight: pick(random, HOST_HEIGHTS),
    theme: pick(random, THEMES),
    typography: pick(random, TYPOGRAPHY)
  }))
}

function leadFor(length, index) {
  if (length === "unbreakable") return `U${index}${"x".repeat(96)}`
  if (length === "long") return `A detailed root item ${index} with enough words to wrap in a narrow preferred-width card`
  if (length === "medium") return `Root item ${index} with a medium length lead`
  return `Item ${index}`
}

function nestedLines(type, depth, indent) {
  if (depth === 0) return []
  const ordered = type === "ordered" || (type === "mixed" && depth % 2 === 1)
  const marker = ordered ? "1. " : "- "
  const lines = [`${" ".repeat(indent)}${marker}Nested ${depth}`]
  return depth > 1 ? [...lines, ...nestedLines(type, depth - 1, indent + marker.length)] : lines
}

function renderList(testCase, nestedType = testCase.body) {
  const ordered = testCase.rootType === "ordered"
  const marker = ordered ? `1${testCase.delimiter} ` : "- "
  const lines = []
  for (let index = 0; index < testCase.itemCount; index += 1) {
    const rootMarker = ordered ? `${testCase.start + index}${testCase.delimiter} ` : marker
    lines.push(`${rootMarker}${leadFor(testCase.leadLength, index)}`)
    const body = nestedType === "paragraph"
      ? ["", `${" ".repeat(rootMarker.length)}A supporting paragraph for item ${index}.`]
      : nestedType === "none"
        ? []
        : nestedLines(nestedType, testCase.depth, rootMarker.length)
    lines.push(...body)
    if (testCase.loose && index < testCase.itemCount - 1) lines.push("")
  }
  return lines.join("\n")
}

test(`ART-TEST-009..015: seeded render, theme, and eligibility matrix (${SAMPLE_LIMIT} cases)`, () => {
  const cases = generatedCases()
  assert.equal(cases.length, SAMPLE_LIMIT)

  for (const [index, testCase] of cases.entries()) {
    const markdown = renderList(testCase)
    const expectedMode = testCase.rootType === "ordered" ? "sequence" : "peers"
    const binding = resolveArtBindings(`:::art\n${markdown}`)

    assert.equal(binding.bindings.length, 1, `case ${index}: target list binds once`)
    assert.equal(binding.bindings[0]?.analysis.mode, expectedMode, `case ${index}: binding keeps root semantics`)
    assert.equal(binding.bindings[0]?.analysis.itemCount, testCase.itemCount, `case ${index}: binding counts direct root items`)
    assert.deepEqual(binding.diagnostics, [], `case ${index}: generated supported list has no diagnostic`)

    const { document } = parseHTML(renderArtBlock(markdown))
    const root = document.querySelector("[data-elef-art-root]")
    const list = root.firstElementChild
    assert.equal(list.tagName, testCase.rootType === "ordered" ? "OL" : "UL", `case ${index}: rendered root list stays native`)
    assert.equal([...list.children].filter(item => item.tagName === "LI").length, testCase.itemCount, `case ${index}: rendered direct item count matches source`)
    assert.equal(root.dataset.artMode, expectedMode, `case ${index}: geometry metadata cannot change mode`)
    assert.ok([testCase.hostWidth, testCase.hostHeight, testCase.theme, testCase.typography].every(Boolean), `case ${index}: host/theme/typography axes are sampled`)

    const themedPreview = renderPreview({
      kind: "document",
      source: `:::art\n${markdown}`,
      style: { theme: testCase.theme, typography: testCase.typography }
    })
    assert.equal(themedPreview.style.theme, testCase.theme, `case ${index}: sampled theme is applied`)
    assert.equal(themedPreview.style.typography, testCase.typography, `case ${index}: sampled typography is applied`)
    assert.match(themedPreview.html, new RegExp(`document-theme-${testCase.theme} document-typography-${testCase.typography}`), `case ${index}: theme and typography reach rendered document`)

    const eligible = sequenceHorizontalEligible({ width: testCase.hostWidth, itemCount: testCase.itemCount, density: binding.bindings[0]?.analysis.density, gap: 16, sequenceMinInline: 200 })
    const expectedEligible = binding.bindings[0]?.analysis.density === "compact" && testCase.itemCount >= 2 && (testCase.hostWidth - 16 * (testCase.itemCount - 1)) / testCase.itemCount >= 200
    assert.equal(eligible, expectedEligible, `case ${index}: sampled fixed geometry affects only layout eligibility`)
  }
})

test("ART-TEST-011: ordered Art fallback honors the parsed ordered start", () => {
  const markdown = "0. Prepare\n1. Launch"
  const rendered = renderArtBlock(markdown, "ART_UNSUPPORTED_CONTENT")
  const { document } = parseHTML(`<body>${rendered}</body>`)
  const list = document.querySelector("[data-elef-art-root] .elef-art-list")

  assert.equal(list?.tagName, "OL")
  assert.equal(list?.getAttribute("start"), "0")
  assert.deepEqual([...list?.querySelectorAll(":scope > li") ?? []].map(item => item.textContent.trim()), ["Prepare", "Launch"])
})
