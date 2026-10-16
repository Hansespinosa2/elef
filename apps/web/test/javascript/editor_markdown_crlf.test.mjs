import assert from "node:assert/strict"
import test from "node:test"
import { readFile } from "node:fs/promises"

const moduleSource = await readFile(new URL("../../../../packages/editor-runtime/dist/controllers/editor_markdown.js", import.meta.url), "utf8")
const source = moduleSource.replace('import katex from "katex"', "const katex = { renderToString: () => '' }")
const editorMarkdown = await import(`data:text/javascript;base64,${Buffer.from(source).toString("base64")}`)

const DOCUMENT = { documentMode: true }

test("CRLF list edits keep markers and line endings in document mode", () => {
  assert.equal(
    editorMarkdown.markdownForVisibleText("- one\r\n- two\r\n", "one\nTWO\n", "list", null, DOCUMENT),
    "- one\r\n- TWO\r\n"
  )
  assert.equal(
    editorMarkdown.markdownForVisibleText("1. one\r\n2. two\r\n", "one\nTWO\n", "list", null, DOCUMENT),
    "1. one\r\n2. TWO\r\n"
  )
})

test("CRLF list round-trips byte-identical when nothing changed", () => {
  assert.equal(
    editorMarkdown.markdownForVisibleText("- one\r\n- two\r\n", "one\ntwo\n", "list", null, DOCUMENT),
    "- one\r\n- two\r\n"
  )
})

test("CRLF quote edits keep markers and line endings", () => {
  assert.equal(
    editorMarkdown.markdownForVisibleText("> hello\r\n> world\r\n", "hello\nWORLD\n", "quote", null, DOCUMENT),
    "> hello\r\n> WORLD\r\n"
  )
})

test("CRLF list edits keep markers and line endings in slide mode", () => {
  assert.equal(
    editorMarkdown.markdownForVisibleText("- one\r\n- two\r\n", "one\nTWO\n", "list", null),
    "- one\r\n- TWO\r\n"
  )
})

test("CRLF blocks with a leading empty line strand no carriage return", () => {
  assert.equal(
    editorMarkdown.markdownForVisibleText("\r\n- two\r\n", "Z\ntwo\n", "list", null, DOCUMENT),
    "Z\r\n- two\r\n"
  )
  assert.equal(
    editorMarkdown.markdownForVisibleText("\r\n- two\r\n", "\ntwo\n", "list", null, DOCUMENT),
    "\r\n- two\r\n"
  )
  assert.equal(
    editorMarkdown.markdownForVisibleText("- \r\n- two\r\n", "\ntwo\n", "list", null, DOCUMENT),
    "- \r\n- two\r\n"
  )
})

test("CRLF paragraph edits keep line endings", () => {
  assert.equal(
    editorMarkdown.markdownForVisibleText("First line\r\nsecond line\r\n", "First line\nsecond LINE\n", "paragraph", null, DOCUMENT),
    "First line\r\nsecond LINE\r\n"
  )
})

const cell = (text) => ({ innerText: text, textContent: text, querySelectorAll: () => [] })
const row = (cells) => ({ querySelectorAll: () => cells })
const table = (rows) => ({ querySelectorAll: () => rows })

test("CRLF table edits keep line endings", () => {
  const dom = table([row([cell("a"), cell("b")]), row([cell("C"), cell("d")])])
  assert.equal(
    editorMarkdown.markdownForVisibleText("| a | b |\r\n| --- | --- |\r\n| c | d |", "", "table", dom),
    "| a | b |\r\n| --- | --- |\r\n| C | d |"
  )
})

test("LF list and table edits are unaffected", () => {
  assert.equal(
    editorMarkdown.markdownForVisibleText("- one\n- two\n", "one\nTWO\n", "list", null, DOCUMENT),
    "- one\n- TWO\n"
  )
  const dom = table([row([cell("a"), cell("b")]), row([cell("C"), cell("d")])])
  assert.equal(
    editorMarkdown.markdownForVisibleText("| a | b |\n| --- | --- |\n| c | d |", "", "table", dom),
    "| a | b |\n| --- | --- |\n| C | d |"
  )
})
