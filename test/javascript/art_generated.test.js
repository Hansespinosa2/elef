import test from "node:test"
import assert from "node:assert/strict"
import { analyzeArtList, resolveArtBindings } from "../../app/javascript/lib/art_source.js"

const SAMPLE_LIMIT = 400
const ROOT_TYPES = ["unordered", "ordered"]
const ITEM_COUNTS = [1, 2, 3, 4, 5, 6, 8, 12, 20]
const LEAD_LENGTHS = ["short", "medium", "long", "unbreakable"]
const BODIES = ["none", "paragraph", "unordered", "ordered", "mixed"]
const DEPTHS = [0, 1, 2, 3, 4]
const DELIMITERS = [".", ")"]
const STARTS = [0, 1, 3]
const LOOSE = [false, true]

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
    loose: pick(random, LOOSE)
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

test(`ART-TEST-001..008: seeded semantic and metamorphic matrix (${SAMPLE_LIMIT} cases)`, () => {
  const cases = generatedCases()
  assert.equal(cases.length, SAMPLE_LIMIT)

  for (const [index, testCase] of cases.entries()) {
    const markdown = renderList(testCase)
    const analysis = analyzeArtList(markdown)
    const expectedMode = testCase.rootType === "ordered" ? "sequence" : "peers"
    const binding = resolveArtBindings(`:::art\n${markdown}`)

    assert.equal(analysis?.mode, expectedMode, `case ${index}: root type determines mode`)
    assert.equal(analysis?.itemCount, testCase.itemCount, `case ${index}: root count is preserved`)
    const expectedDensity = testCase.body === "paragraph" || (testCase.depth > 0 && testCase.body !== "none") ? "rich" : "compact"
    assert.equal(analysis?.density, expectedDensity, `case ${index}: body presence determines density`)
    assert.equal(binding.bindings.length, 1, `case ${index}: target list binds once`)
    assert.equal(binding.bindings[0].analysis.mode, expectedMode, `case ${index}: binding keeps root semantics`)
    assert.equal(binding.bindings[0].analysis.itemCount, testCase.itemCount, `case ${index}: binding counts direct root items`)
    assert.deepEqual(binding.diagnostics, [], `case ${index}: generated supported list has no diagnostic`)

    const alternateNestedType = testCase.body === "ordered" ? "unordered" : "ordered"
    const changedNesting = analyzeArtList(renderList(testCase, alternateNestedType))
    assert.equal(changedNesting?.mode, expectedMode, `case ${index}: nested orderedness cannot change mode`)
    assert.equal(changedNesting?.itemCount, testCase.itemCount, `case ${index}: nested lists cannot add Art items`)
  }
})

test("ART-SEM-008: pathological nesting at the Markdown parser limit does not crash Art analysis", () => {
  const depth = 32
  const markdown = ["- Root", ...nestedLines("mixed", depth, 2)].join("\n")
  assert.doesNotThrow(() => analyzeArtList(markdown))
  assert.doesNotThrow(() => resolveArtBindings(`:::art\n${markdown}`))
  assert.equal(analyzeArtList(markdown)?.itemCount, 1)
})
