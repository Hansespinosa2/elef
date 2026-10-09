import test from "node:test"
import assert from "node:assert/strict"
import {
  addSlide,
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

const TWO_SLIDES = "# One\n\nBody one.\n\n---\n\n# Two\n\nBody two.\n"
const mapOf = (source) => buildEditorMap(source).slides

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
  const withFrontMatter = "---\ntitle: Deck\n---\nA\n---\nB\n"
  const frontMap = buildEditorMap(withFrontMatter)
  assert.equal(
    moveSlide(withFrontMatter, frontMap, 0, 1),
    "---\ntitle: Deck\n---\nB\n---\nA\n"
  )
})

test("block insertion honors directive starts and delimiter-aware appends", () => {
  const [slide] = mapOf(TWO_SLIDES)
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
  assert.equal(removeBlock(TWO_SLIDES, slide, slide.blocks[0]), "Body one.\n\n---\n\n# Two\n\nBody two.\n")
  assert.equal(removeBlock(TWO_SLIDES, null, slide.blocks[0]), null)
  assert.equal(removeBlock(TWO_SLIDES, slide, null), null)
})

test("block removal of a lone group member takes the directive pair", () => {
  const source = ":::align{center}\n\n# Solo\n\n:::\n\nAfter\n"
  const [slide] = mapOf(source)
  assert.equal(slide.blocks.filter((block) => block.position_scope === "group").length, 1)
  assert.equal(removeBlock(source, slide, slide.blocks[0]), "After\n")
})

test("block moves refuse to cross group boundaries", () => {
  const source = ":::align{center}\n\n# T\n\nBody.\n\n:::\n\nAfter\n"
  const [slide] = mapOf(source)
  assert.equal(moveBlock(source, slide, 0, 2), null)
  assert.equal(
    moveBlock(source, slide, 0, 1),
    ":::align{center}\n\nBody.\n\n# T\n\n:::\n\nAfter\n"
  )
  const [plain] = mapOf(TWO_SLIDES)
  assert.equal(
    moveBlock(TWO_SLIDES, plain, 0, 1),
    "Body one.\n\n# One\n\n---\n\n# Two\n\nBody two.\n"
  )
  assert.equal(moveBlock(TWO_SLIDES, plain, 0, 9), null)
})

test("block operation starts include the single-block directive", () => {
  const [grouped] = mapOf(":::align{center}\n\n# T\n\nBody.\n\n:::\n\nAfter\n")
  assert.equal(blockOperationStart(grouped, grouped.blocks[0]), 18)
  const [single] = mapOf(":::align{left}\n# T\n")
  assert.equal(single.blocks[0].position_scope, "block")
  assert.equal(blockOperationStart(single, single.blocks[0]), 0)
})

test("alignment parsing keeps the presentation grammar", () => {
  assert.deepEqual(parseAlignment(""), { horizontal: "left", vertical: "top", verticalExplicit: false })
  assert.deepEqual(parseAlignment("center"), { horizontal: "center", vertical: "top", verticalExplicit: false })
  assert.deepEqual(parseAlignment("middle center"), { horizontal: "center", vertical: "middle", verticalExplicit: true })
  assert.deepEqual(parseAlignment("bottom right"), { horizontal: "right", vertical: "bottom", verticalExplicit: true })
  assert.deepEqual(parseAlignment("top"), { horizontal: "left", vertical: "top", verticalExplicit: false })
  assert.deepEqual(parseAlignment("middle"), { horizontal: "left", vertical: "middle", verticalExplicit: true })
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
    replacement: ":::align{right}\n\n"
  })
  assert.deepEqual(insertAlignDirective("Body\r\n", 0, ":::align{right}"), {
    updated: ":::align{right}\r\n\r\nBody\r\n",
    replacement: ":::align{right}\r\n\r\n"
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
