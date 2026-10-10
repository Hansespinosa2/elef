import assert from "node:assert/strict"
import test from "node:test"
import { analyzeArtList, resolveArtBindings } from "../src/index.js"

interface BindingCase {
  id: string
  source: string
  binding: boolean
  mode?: string
  items?: number
  start?: number
  diagnostic?: string | null
  diagnostics?: Array<string>
}

const bindingCases: Array<BindingCase> = [
  { id: "ART-BIND-EXACT", source: ":::art\n- A\n- B", binding: true, mode: "peers", items: 2 },
  { id: "ART-BIND-CRLF", source: ":::art\r\n- A\r\n- B", binding: true, mode: "peers", items: 2 },
  { id: "ART-BIND-TRAILING-WHITESPACE", source: ":::art \t\n- A\n- B", binding: true, mode: "peers", items: 2 },
  { id: "ART-BIND-EOF-NO-TARGET", source: ":::art", binding: false, diagnostic: "ART_NO_LIST_TARGET" },
  { id: "ART-BIND-INVALID-BRACES", source: ":::art{flow}\n- A", binding: false, diagnostic: "ART_INVALID_SYNTAX" },
  { id: "ART-BIND-INVALID-ARGUMENT", source: ":::art extra\n- A", binding: false, diagnostic: "ART_INVALID_SYNTAX" },
  { id: "ART-BIND-ARTIST", source: ":::artist\n- A", binding: false, diagnostic: null },
  { id: "ART-BIND-ARTICLE", source: ":::article\n- A", binding: false, diagnostic: null },
  { id: "ART-BIND-LEADING-SPACE", source: " :::art\n- A", binding: false, diagnostic: null },
  { id: "ART-BIND-BACKTICK-FENCE", source: "```md\n:::art\n```\n- A", binding: false, diagnostic: null },
  { id: "ART-BIND-TILDE-FENCE", source: "~~~md\n:::art\n~~~\n- A", binding: false, diagnostic: null },
  { id: "ART-BIND-FOUR-BACKTICK-FENCE", source: "````md\n```\n:::art\n```\n````\n- A", binding: false, diagnostic: null },
  { id: "ART-BIND-DISPLAY-MATH", source: "$$\n:::art\n$$\n- A", binding: false, diagnostic: null },
  { id: "ART-BIND-BLOCKQUOTE", source: "> :::art\n> - A", binding: false, diagnostic: null },
  { id: "ART-BIND-INDENTED-LIST", source: "- parent\n  :::art\n  - nested", binding: false, diagnostic: null },
  { id: "ART-BIND-INDENTED-CODE", source: "    :::art\n    - nested", binding: false, diagnostic: null },
  { id: "ART-BIND-ORDERED-PERIOD", source: ":::art\n1. A\n2. B", binding: true, mode: "sequence", start: 1, items: 2 },
  { id: "ART-BIND-ORDERED-PAREN", source: ":::art\n1) A\n2) B", binding: true, mode: "sequence", start: 1, items: 2 },
  { id: "ART-BIND-ORDERED-ZERO", source: ":::art\n0. A\n1. B", binding: true, mode: "sequence", start: 0, items: 2 },
  { id: "ART-BIND-ORDERED-THREE", source: ":::art\n3. A\n4. B", binding: true, mode: "sequence", start: 3, items: 2 },
  { id: "ART-BIND-ALIGN-AFTER", source: ":::art\n:::align{center}\n- A", binding: true, mode: "peers", items: 1 },
  { id: "ART-BIND-POSITION-AFTER", source: ":::art\n:::position{middle right}\n- A", binding: true, mode: "peers", items: 1 },
  { id: "ART-BIND-ALIGN-BEFORE", source: ":::align{center}\n:::art\n- A", binding: true, mode: "peers", items: 1 },
  { id: "ART-BIND-POSITION-BEFORE", source: ":::position{middle right}\n:::art\n- A", binding: true, mode: "peers", items: 1 },
  { id: "ART-BIND-CLOSING-BARRIER", source: ":::art\n:::\n- A", binding: false, diagnostic: "ART_NO_LIST_TARGET" },
  { id: "ART-BIND-FENCED-CODE-BARRIER", source: ":::art\n```js\nconst value = 1\n```\n- A", binding: false, diagnostic: "ART_NO_LIST_TARGET" },
  { id: "ART-BIND-DISPLAY-MATH-BARRIER", source: ":::art\n$$\nx^2\n$$\n- A", binding: false, diagnostic: "ART_NO_LIST_TARGET" },
  { id: "ART-BIND-HEADING-BARRIER", source: ":::art\n# Heading\n- A", binding: false, diagnostic: "ART_NO_LIST_TARGET" },
  { id: "ART-BIND-TABLE-BARRIER", source: ":::art\n| A |\n|---|\n| B |\n- A", binding: false, diagnostic: "ART_NO_LIST_TARGET" },
  { id: "ART-BIND-UNKNOWN-DIRECTIVE", source: ":::art\n:::unknown{value}\n- A", binding: false, diagnostic: "ART_NO_LIST_TARGET" },
  { id: "ART-BIND-SUPERSEDED", source: ":::art\n:::art\n- A", binding: true, mode: "peers", items: 1, diagnostics: ["ART_NO_LIST_TARGET"] },
  { id: "ART-BIND-PARAGRAPH-BARRIER", source: ":::art\nParagraph.\n\n- A", binding: false, diagnostic: "ART_NO_LIST_TARGET" },
  { id: "ART-BIND-ART-IN-PARAGRAPH", source: "Paragraph\n:::art\n- A", binding: false, diagnostic: null }
]

for (const fixture of bindingCases) {
  test(`${fixture.id}: Art source binding`, () => {
    const resolved = resolveArtBindings(fixture.source)
    assert.equal(resolved.bindings.length, fixture.binding ? 1 : 0)
    if (fixture.binding) {
      const [binding] = resolved.bindings
      assert.equal(binding?.analysis.mode, fixture.mode)
      assert.equal(binding?.analysis.itemCount, fixture.items)
      if (fixture.start !== undefined) assert.equal(binding?.analysis.orderedStart, fixture.start)
    }
    const codes = resolved.diagnostics.map((diagnostic) => diagnostic.code)
    if (fixture.diagnostics) assert.deepEqual(codes, fixture.diagnostics)
    else if (fixture.diagnostic) assert.deepEqual(codes, [fixture.diagnostic])
    else assert.deepEqual(codes, [])
  })
}

test("ART-SEM-ROOT-COUNT: nested lists retain native meaning without becoming Art items", () => {
  const analysis = analyzeArtList([
    "1. Research",
    "   - Interview users",
    "   - Review competitors",
    "     1. Enterprise",
    "     2. Consumer",
    "2. Design",
    "   1. Prototype",
    "   2. Validate"
  ].join("\n"))

  assert.deepEqual(analysis && {
    mode: analysis.mode,
    density: analysis.density,
    itemCount: analysis.itemCount,
    orderedStart: analysis.orderedStart
  }, { mode: "sequence", density: "rich", itemCount: 2, orderedStart: 1 })
})

test("ART-SEM-UNSUPPORTED: image and unsupported block content select whole-list fallback", () => {
  for (const markdown of ["- A\n  ![image](image.png)", "- A\n\n  ```js\n  code\n  ```", "- A\n\n  | a |\n  |---|\n  | b |"])
    assert.equal(analyzeArtList(markdown)?.supported, false)
})

test("ART-SEM-EMPTY: empty root items remain counted and compact", () => {
  const analysis = analyzeArtList("-\n- Filled")
  assert.equal(analysis?.itemCount, 2)
  assert.equal(analysis?.density, "compact")
})

const SAMPLE_LIMIT = 400
const ROOT_TYPES = ["unordered", "ordered"]
const ITEM_COUNTS = [1, 2, 3, 4, 5, 6, 8, 12, 20]
const LEAD_LENGTHS = ["short", "medium", "long", "unbreakable"]
const BODIES = ["none", "paragraph", "unordered", "ordered", "mixed"]
const DEPTHS = [0, 1, 2, 3, 4]
const DELIMITERS = [".", ")"]
const STARTS = [0, 1, 3]
const LOOSE = [false, true]

interface GeneratedCase {
  rootType: string
  itemCount: number
  leadLength: string
  body: string
  depth: number
  delimiter: string
  start: number
  loose: boolean
}

function seeded(seed: number): () => number {
  let state = seed >>> 0
  return () => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0
    return state / 0x1_0000_0000
  }
}

function pick<T>(random: () => number, values: Array<T>): T {
  return values[Math.floor(random() * values.length)] as T
}

function generatedCases(): Array<GeneratedCase> {
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

function leadFor(length: string, index: number): string {
  if (length === "unbreakable") return `U${index}${"x".repeat(96)}`
  if (length === "long") return `A detailed root item ${index} with enough words to wrap in a narrow preferred-width card`
  if (length === "medium") return `Root item ${index} with a medium length lead`
  return `Item ${index}`
}

function nestedLines(type: string, depth: number, indent: number): Array<string> {
  if (depth === 0) return []
  const ordered = type === "ordered" || (type === "mixed" && depth % 2 === 1)
  const marker = ordered ? "1. " : "- "
  const lines = [`${" ".repeat(indent)}${marker}Nested ${depth}`]
  return depth > 1 ? [...lines, ...nestedLines(type, depth - 1, indent + marker.length)] : lines
}

function renderList(testCase: GeneratedCase, nestedType: string = testCase.body): string {
  const ordered = testCase.rootType === "ordered"
  const marker = ordered ? `1${testCase.delimiter} ` : "- "
  const lines: Array<string> = []
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
    assert.equal(binding.bindings[0]?.analysis.mode, expectedMode, `case ${index}: binding keeps root semantics`)
    assert.equal(binding.bindings[0]?.analysis.itemCount, testCase.itemCount, `case ${index}: binding counts direct root items`)
    assert.deepEqual(binding.diagnostics, [], `case ${index}: generated supported list has no diagnostic`)

    const alternateNestedType = testCase.body === "ordered" ? "unordered" : "ordered"
    const changedNesting = analyzeArtList(renderList(testCase, alternateNestedType))
    assert.equal(changedNesting?.mode, expectedMode, `case ${index}: nested orderedness cannot change mode`)
    assert.equal(changedNesting?.itemCount, testCase.itemCount, `case ${index}: nested lists cannot add Art items`)
    if (["unordered", "ordered", "mixed"].includes(testCase.body)) {
      const lowerDepth = Math.min(testCase.depth, 3)
      const higherDepth = lowerDepth + 1
      const lower = analyzeArtList(renderList({ ...testCase, depth: lowerDepth }))
      const higher = analyzeArtList(renderList({ ...testCase, depth: higherDepth }))
      assert.equal(higher?.mode, lower?.mode, `case ${index}: increased nested depth cannot change root mode`)
      assert.equal(higher?.itemCount, lower?.itemCount, `case ${index}: increased nested depth cannot create Art items`)
    }
  }
})

test("ART-SEM-008: pathological nesting at the Markdown parser limit does not crash Art analysis", () => {
  const depth = 32
  const markdown = ["- Root", ...nestedLines("mixed", depth, 2)].join("\n")
  assert.doesNotThrow(() => analyzeArtList(markdown))
  assert.doesNotThrow(() => resolveArtBindings(`:::art\n${markdown}`))
  assert.equal(analyzeArtList(markdown)?.itemCount, 1)
})
