import test from "node:test"
import assert from "node:assert/strict"
import { analyzeArtList, resolveArtBindings } from "../../app/javascript/lib/art_source.js"
import { buildEditorStructure } from "../../app/javascript/lib/document_map.js"

const bindingCases = [
  { id: "ART-BIND-EXACT", source: ":::art\n- A\n- B", binding: true, mode: "peers", items: 2 },
  { id: "ART-BIND-CRLF", source: ":::art\r\n- A\r\n- B", binding: true, mode: "peers", items: 2 },
  { id: "ART-BIND-TRAILING-WHITESPACE", source: ":::art \t\n- A\n- B", binding: true, mode: "peers", items: 2 },
  { id: "ART-BIND-EOF-NO-TARGET", source: ":::art", binding: false, diagnostic: "ART_NO_LIST_TARGET" },
  { id: "ART-BIND-INVALID-BRACES", source: ":::art{flow}\n- A", binding: false, diagnostic: "ART_INVALID_SYNTAX" },
  { id: "ART-BIND-INVALID-ARGUMENT", source: ":::art extra\n- A", binding: false, diagnostic: "ART_INVALID_SYNTAX" },
  { id: "ART-BIND-ARTIST", source: ":::artist\n- A", binding: false, diagnostic: null },
  { id: "ART-BIND-ARTICLE", source: ":::article\n- A", binding: false, diagnostic: null },
  { id: "ART-BIND-BACKTICK-FENCE", source: "```md\n:::art\n```\n- A", binding: false, diagnostic: null },
  { id: "ART-BIND-TILDE-FENCE", source: "~~~md\n:::art\n~~~\n- A", binding: false, diagnostic: null },
  { id: "ART-BIND-FOUR-BACKTICK-FENCE", source: "````md\n```\n:::art\n```\n````\n- A", binding: false, diagnostic: null },
  { id: "ART-BIND-DISPLAY-MATH", source: "$$\n:::art\n$$\n- A", binding: false, diagnostic: null },
  { id: "ART-BIND-BLOCKQUOTE", source: "> :::art\n> - A", binding: false, diagnostic: null },
  { id: "ART-BIND-INDENTED-LIST", source: "- parent\n  :::art\n  - nested", binding: false, diagnostic: null },
  { id: "ART-BIND-ORDERED-PERIOD", source: ":::art\n1. A\n2. B", binding: true, mode: "sequence", start: 1, items: 2 },
  { id: "ART-BIND-ORDERED-PAREN", source: ":::art\n1) A\n2) B", binding: true, mode: "sequence", start: 1, items: 2 },
  { id: "ART-BIND-ORDERED-ZERO", source: ":::art\n0. A\n1. B", binding: true, mode: "sequence", start: 0, items: 2 },
  { id: "ART-BIND-ORDERED-THREE", source: ":::art\n3. A\n4. B", binding: true, mode: "sequence", start: 3, items: 2 },
  { id: "ART-BIND-ALIGN-AFTER", source: ":::art\n:::align{center}\n- A", binding: true, mode: "peers", items: 1 },
  { id: "ART-BIND-POSITION-AFTER", source: ":::art\n:::position{middle right}\n- A", binding: true, mode: "peers", items: 1 },
  { id: "ART-BIND-ALIGN-BEFORE", source: ":::align{center}\n:::art\n- A", binding: true, mode: "peers", items: 1 },
  { id: "ART-BIND-CLOSING-BARRIER", source: ":::art\n:::\n- A", binding: false, diagnostic: "ART_NO_LIST_TARGET" },
  { id: "ART-BIND-SUPERSEDED", source: ":::art\n:::art\n- A", binding: true, mode: "peers", items: 1, diagnostics: ["ART_NO_LIST_TARGET"] },
  { id: "ART-BIND-PARAGRAPH-BARRIER", source: ":::art\nParagraph.\n\n- A", binding: false, diagnostic: "ART_NO_LIST_TARGET" }
]

for (const fixture of bindingCases) {
  test(`${fixture.id}: Art source binding`, () => {
    const resolved = resolveArtBindings(fixture.source)
    assert.equal(resolved.bindings.length, fixture.binding ? 1 : 0)
    if (fixture.binding) {
      const [binding] = resolved.bindings
      assert.equal(binding.analysis.mode, fixture.mode)
      assert.equal(binding.analysis.itemCount, fixture.items)
      if (fixture.start !== undefined) assert.equal(binding.analysis.orderedStart, fixture.start)
    }
    const codes = resolved.diagnostics.map(diagnostic => diagnostic.code)
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

test("ART-ARCH-SHARED-MAP: Art source ownership and loose-list block mapping share one binding", () => {
  const source = ":::art\r\n:::align{center}\r\n- Lead\r\n\r\n  Body\r\n- Second"
  const structure = buildEditorStructure(source, { mode: "document" })
  const slide = structure.editorMap.slides[0]

  assert.equal(slide.blocks.length, 1)
  assert.equal(slide.blocks[0].markdown, "- Lead\r\n\r\n  Body\r\n- Second")
  assert.deepEqual(slide.blocks[0].art, {
    directive_id: slide.directives.find(directive => directive.type === "art").id,
    source_range: { start: 0, end: 8 }
  })
  assert.equal(slide.blocks[0].position.horizontal, "center")
  assert.equal(slide.directives.find(directive => directive.type === "art").source_range.end, 8)
  assert.deepEqual(slide.art_diagnostics || [], [])
})

test("ART-EDIT-ORPHAN: Art stays unbound after a barrier and cannot jump to a later list", () => {
  const structure = buildEditorStructure(":::art\nA paragraph.\n\n- Later", { mode: "document" })
  assert.equal(structure.editorMap.slides[0].blocks.length, 2)
  assert.ok(structure.editorMap.slides[0].blocks.every(block => !block.art))
  assert.deepEqual(structure.editorMap.art_diagnostics.map(diagnostic => diagnostic.code), ["ART_NO_LIST_TARGET"])
})
