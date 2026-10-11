import test from "node:test"
import assert from "node:assert/strict"
import {
  exciseRange,
  addSlide,
  blockOperationRange,
  blockOperationStart,
  buildEditorMap,
  deleteSlide,
  directiveLineSpan,
  exciseRanges,
  expandSnippet,
  insertAlignDirective,
  insertBlock,
  mediaInsertText,
  moveBlock,
  moveSlide,
  parseAlignment,
  removeBlock
} from "../src/index.js"
import type { MapSlide } from "../src/index.js"

const TWO_SLIDES = "# One\n\nBody one.\n\n---\n\n# Two\n\nBody two.\n"
const mapOf = (source: string): MapSlide[] => buildEditorMap(source).slides

test("slide insertion splices before the target or appends after the last", () => {
  const slides = mapOf(TWO_SLIDES)
  assert.equal(
    addSlide(TWO_SLIDES, slides, 1),
    "# One\n\nBody one.\n\n---\n# New slide\n\nStart writing here.\n---\n\n# Two\n\nBody two.\n"
  )
  assert.equal(
    addSlide(TWO_SLIDES, slides, 9),
    "# One\n\nBody one.\n\n---\n\n# Two\n\nBody two.\n---\n# New slide\n\nStart writing here."
  )
  assert.equal(addSlide("", [], 0), "# New slide\n\nStart writing here.")
  assert.equal(addSlide("   \n", [], 0), "# New slide\n\nStart writing here.")
})

test("slide deletion removes the slide plus its delimiter", () => {
  const slides = mapOf(TWO_SLIDES)
  assert.equal(deleteSlide(TWO_SLIDES, slides, 0), "\n# Two\n\nBody two.\n")
  assert.equal(deleteSlide(TWO_SLIDES, slides, 1), "# One\n\nBody one.\n\n")
  assert.equal(deleteSlide("A\n---\nB\n---\nC", mapOf("A\n---\nB\n---\nC"), 1), "A\n---\nC")
  assert.equal(deleteSlide("# Solo\n", mapOf("# Solo\n"), 0), null)
  assert.equal(deleteSlide(TWO_SLIDES, slides, 7), null)
})

test("slide moves keep front matter and reflow trailing blank lines with the section", () => {
  const moved = moveSlide(TWO_SLIDES, { slides: mapOf(TWO_SLIDES) }, 0, 1)
  assert.equal(moved, "\n# Two\n\nBody two.\n\n---\n# One\n\nBody one.\n")
  assert.equal(moveSlide(TWO_SLIDES, { slides: mapOf(TWO_SLIDES) }, 0, 5), null)
  assert.equal(moveSlide(TWO_SLIDES, { slides: mapOf(TWO_SLIDES) }, 4, 0), null)
  const withFrontMatter = "---\ntitle: Work\n---\nA\n---\nB\n"
  const frontMap = buildEditorMap(withFrontMatter)
  assert.equal(
    moveSlide(withFrontMatter, frontMap, 0, 1),
    "---\ntitle: Work\n---\nB\n---\nA\n"
  )
})

test("block insertion honors directive starts and delimiter-aware appends", () => {
  const [slide] = mapOf(TWO_SLIDES)
  assert.ok(slide)
  assert.equal(
    insertBlock(TWO_SLIDES, slide, 1),
    "# One\n\nNew block\n\nBody one.\n\n---\n\n# Two\n\nBody two.\n"
  )
  assert.equal(
    insertBlock(TWO_SLIDES, slide, 2),
    "# One\n\nBody one.\n\n\nNew block\n---\n\n# Two\n\nBody two.\n"
  )
  assert.equal(insertBlock(TWO_SLIDES, null, 0), null)
})

test("block removal collapses the blank line left behind", () => {
  const [slide] = mapOf(TWO_SLIDES)
  assert.ok(slide)
  assert.equal(removeBlock(TWO_SLIDES, slide, slide.blocks[0]), "Body one.\n\n---\n\n# Two\n\nBody two.\n")
  assert.equal(removeBlock(TWO_SLIDES, null, slide.blocks[0]), null)
  assert.equal(removeBlock(TWO_SLIDES, slide, null), null)
})

test("block removal of a positioned block takes its directive and leaves the closer line", () => {
  // The grammar has no scoped groups: a bare ::: is an unknown directive,
  // and each position directive applies to its single following block.
  const source = ":::align{center}\n\n# Solo\n\n:::\n\nAfter\n"
  const [slide] = mapOf(source)
  assert.ok(slide)
  assert.equal(slide.blocks[0]?.position_directive_id, slide.directives[0]?.id)
  assert.equal(removeBlock(source, slide, slide.blocks[0]), ":::\n\nAfter\n")
})

test("block moves reorder positioned blocks freely", () => {
  const source = ":::align{center}\n\n# T\n\nBody.\n\nAfter\n"
  const [slide] = mapOf(source)
  assert.ok(slide)
  assert.equal(
    moveBlock(source, slide, 0, 1),
    "Body.\n\n:::align{center}\n\n# T\n\nAfter\n"
  )
  const [plain] = mapOf(TWO_SLIDES)
  assert.ok(plain)
  assert.equal(
    moveBlock(TWO_SLIDES, plain, 0, 1),
    "Body one.\n\n# One\n\n---\n\n# Two\n\nBody two.\n"
  )
  assert.equal(moveBlock(TWO_SLIDES, plain, 0, 9), null)
})

test("block operation starts include the single-block directive", () => {
  const [positioned] = mapOf(":::align{center}\n\n# T\n\nBody.\n\nAfter\n")
  assert.ok(positioned)
  assert.equal(blockOperationStart(positioned, positioned.blocks[0]), 0)
  const [single] = mapOf(":::align{left}\n# T\n")
  assert.ok(single)
  assert.equal(blockOperationStart(single, single.blocks[0]), 0)
})

test("block operation ranges cover the directive and the block", () => {
  const source = ":::align{center}\n\n# Solo\n\nAfter\n"
  const [slide] = mapOf(source)
  assert.ok(slide)
  assert.deepEqual(blockOperationRange(slide.blocks[0], slide), { from: 0, to: 25 })
})

test("ART-EDIT-001: block operations own the Art line and its target list", () => {
  const source = "Before\n\n:::art\n- Alpha\n- Beta\n\nAfter"
  const artStart = source.indexOf(":::art")
  const listStart = source.indexOf("- Alpha")
  const block = {
    range: { start: listStart, end: source.indexOf("\n\nAfter") },
    art: { source_range: { start: artStart, end: artStart + ":::art\n".length } }
  }

  assert.equal(blockOperationStart({ directives: [] }, block), artStart)
  assert.equal(source.slice(blockOperationStart({ directives: [] }, block), block.range.end), ":::art\n- Alpha\n- Beta")
  assert.equal(source.slice(0, artStart), "Before\n\n")
  assert.equal(source.slice(block.range.end), "\n\nAfter")
})

test("ART-EDIT-001: position directive ownership starts before Art", () => {
  const source = ":::position{middle}\n:::art\n- Alpha"
  const block = {
    range: { start: source.indexOf("- Alpha"), end: source.length },
    art: { source_range: { start: source.indexOf(":::art"), end: source.indexOf("- Alpha") } },
    position_directive_id: "position-1"
  }
  const slide = { directives: [{ id: "position-1", range: { start: 0, end: ":::position{middle}".length } }] }

  assert.equal(blockOperationStart(slide, block), 0)
})

test("ART-EDIT-001: deleting a block includes an Art directive and position directive preceding it", () => {
  const source = ":::art\n:::align{center}\n- Alpha\n\n- Later"
  const block = {
    range: { start: source.indexOf("- Alpha"), end: source.indexOf("\n\n- Later") },
    art: { source_range: { start: 0, end: ":::art\n".length } },
    position_directive_id: "align-1"
  }
  const slide = {
    blocks: [block],
    directives: [
      { id: "align-1", type: "position", range: { start: source.indexOf(":::align"), end: source.indexOf("\n", source.indexOf(":::align")) + 1 } }
    ]
  }

  const range = blockOperationRange(block, slide)
  assert.ok(range)
  assert.equal(range.from, source.indexOf(":::art"))
  assert.equal(source.slice(range.from, range.to), ":::art\n:::align{center}\n- Alpha")
  assert.equal(source.slice(0, range.from) + source.slice(range.to), "\n\n- Later")
})

test("block operation ranges cover the single-block directive and plain blocks", () => {
  const [single] = mapOf(":::align{left}\n# T\n")
  assert.ok(single)
  assert.deepEqual(blockOperationRange(single.blocks[0], single), { from: 0, to: 19 })
  const [plain] = mapOf(TWO_SLIDES)
  assert.ok(plain)
  assert.deepEqual(blockOperationRange(plain.blocks[0], plain), { from: 0, to: 6 })
})

test("block operation ranges refuse missing inputs", () => {
  const [slide] = mapOf(":::align{center}\n\n# T\n\nBody.\n\nAfter\n")
  assert.ok(slide)
  assert.deepEqual(blockOperationRange(slide.blocks[0], slide), { from: 0, to: 22 })
  assert.equal(blockOperationRange(null, slide), null)
  assert.equal(blockOperationRange(slide.blocks[0], null), null)
  assert.equal(blockOperationRange(null, null), null)
})

test("block operation starts include an earlier Art directive range", () => {
  const [slide] = mapOf(":::art\n- A\n- B\n")
  assert.ok(slide)
  const first = slide.blocks[0]
  assert.ok(first?.art)
  assert.equal(blockOperationStart(slide, first), first.art.source_range.start)
})

test("alignment parsing keeps the presentation grammar", () => {
  assert.deepEqual(parseAlignment(""), { horizontal: "left", vertical: "top", verticalExplicit: false })
  assert.deepEqual(parseAlignment("center"), { horizontal: "center", vertical: "top", verticalExplicit: false })
  assert.deepEqual(parseAlignment("middle center"), { horizontal: "center", vertical: "middle", verticalExplicit: true })
  assert.deepEqual(parseAlignment("bottom right"), { horizontal: "right", vertical: "bottom", verticalExplicit: true })
  assert.deepEqual(parseAlignment("top"), { horizontal: "left", vertical: "top", verticalExplicit: false })
  assert.deepEqual(parseAlignment("middle"), { horizontal: "left", vertical: "middle", verticalExplicit: true })
  assert.deepEqual(parseAlignment("center center"), { horizontal: "center", vertical: "top", verticalExplicit: false })
  assert.deepEqual(parseAlignment("Middle Center"), { horizontal: "center", vertical: "middle", verticalExplicit: true })
  assert.deepEqual(parseAlignment("right top"), { horizontal: "right", vertical: "top", verticalExplicit: true })
})

test("directive line spans absorb the line ending or synthesize one", () => {
  assert.deepEqual(directiveLineSpan(":::align{left}\n# T\n", 0, 15), { from: 0, to: 15, lineEnding: "\n" })
  assert.deepEqual(directiveLineSpan(":::align{left}# T\n", 0, 14), { from: 0, to: 14, lineEnding: "\n" })
  assert.deepEqual(directiveLineSpan(":::align{left}", 0, 14), { from: 0, to: 14, lineEnding: "\n" })
  assert.deepEqual(
    directiveLineSpan(":::align{left}\r\n# T\r\n", 0, 16),
    { from: 0, to: 16, lineEnding: "\r\n" }
  )
})

test("directive insertion doubles the line ending after the inner markup", () => {
  assert.deepEqual(insertAlignDirective("Body\n", 0, ":::align{right}"), {
    updated: ":::align{right}\n\nBody\n",
    replacement: ":::align{right}\n\n",
    lineEnding: "\n"
  })
  assert.deepEqual(insertAlignDirective("Body\r\n", 0, ":::align{right}"), {
    updated: ":::align{right}\r\n\r\nBody\r\n",
    replacement: ":::align{right}\r\n\r\n",
    lineEnding: "\r\n"
  })
})

test("single-span excision reports the absorbed end offset", () => {
  assert.deepEqual(exciseRange(":::align{right}\n\nBody\n", { start: 0, end: 16 }), {
    updated: "\nBody\n",
    to: 16
  })
  assert.deepEqual(exciseRange(":::align{right}# T\n", { start: 0, end: 15 }), {
    updated: "# T\n",
    to: 15
  })
})

test("directive excision removes spans back-to-front and collapses blanks", () => {
  assert.equal(exciseRanges(":::align{right}\n\nBody\n", [{ start: 0, end: 17 }]), "Body\n")
  assert.equal(
    exciseRanges(":::align{center}\n\n# Solo\n\n:::\n\nAfter\n", [{ start: 0, end: 17 }, { start: 26, end: 30 }]),
    "\n# Solo\n\nAfter\n"
  )
  assert.equal(exciseRanges("Body\n", []), "Body\n")
})

test("snippet expansion resolves defaults and orders stops with zero last", () => {
  assert.deepEqual(expandSnippet("Hello ${1:world}!"), {
    text: "Hello world!",
    stops: [{ number: 1, start: 6, length: 5 }]
  })
  assert.deepEqual(expandSnippet("${2:b} ${1:a} ${0:c}"), {
    text: "b a c",
    stops: [
      { number: 1, start: 2, length: 1 },
      { number: 2, start: 0, length: 1 },
      { number: 0, start: 4, length: 1 }
    ]
  })
  assert.deepEqual(expandSnippet("plain"), { text: "plain", stops: [] })
})

test("media insertion pads the embed onto blank boundaries", () => {
  assert.equal(mediaInsertText("# T\n\nBody", { from: 5, to: 5 }, "![](a.png)"), "![](a.png)\n\n")
  assert.equal(mediaInsertText("ab", { from: 1, to: 1 }, "x"), "\n\nx\n\n")
  assert.equal(mediaInsertText("", { from: 0, to: 0 }, "x"), "x")
  assert.equal(mediaInsertText("a\n\nb", { from: 1, to: 2 }, "x"), "\n\nx\n")
})
