import assert from "node:assert/strict"
import test from "node:test"

import {
  buildDocumentGraph,
  createDocumentLinkResolver,
  extractDocumentLinkTitles,
  extractDocumentLinkTokens,
  extractFirstMarkdownHeading,
  isLinkableDocumentTitle,
  linkableDocumentTitles,
  parsePortableDocumentLinks
} from "../src/document_links.js"

test("document link extraction ignores escaped, inline, fenced, and indented code", () => {
  const source = [
    "[[Visible|label]] `[[Inline]]` \\[[Escaped]]",
    "",
    "```markdown",
    "[[Fenced]]",
    "````",
    "    [[Indented]]",
    "~~~js",
    "[[Tilde fence]]",
    "~~~"
  ].join("\r\n")

  assert.deepEqual(extractDocumentLinkTitles(`${source}\r\n[[[Not a link]]]`), ["Visible|label"])
})

test("document link tokens preserve UTF-16 source ranges and share title validation", () => {
  const source = "😀 [[Target]] [[Bad\rTitle]] [[[Triple]]]"
  const tokens = extractDocumentLinkTokens(source)
  assert.deepEqual(tokens.map(({ title }) => title), ["Target"])
  assert.equal(tokens[0].start, source.indexOf("[[Target]]"))
  assert.equal(tokens[0].end, source.indexOf("[[Target]]") + "[[Target]]".length)
  assert.equal(isLinkableDocumentTitle("Readable title"), true)
  assert.equal(isLinkableDocumentTitle("Title with ]"), false)
  assert.deepEqual(linkableDocumentTitles(["Readable title", "", "Title with `code`"]), ["Readable title"])
})

test("web and desktop graph inputs use one resolver for titles, aliases, and stable keys", () => {
  const graph = buildDocumentGraph([
    {
      id: "source",
      title: "Source",
      source: "[[Alias]] [[document:target-key|by key]] [[Target title]] [[id:target-id]] [[Missing]]"
    },
    {
      id: "target-id",
      title: "Target title",
      documentKey: "target-key",
      aliases: ["Alias"],
      source: ""
    },
    { id: "orphan", title: "Orphan", source: "" }
  ])

  assert.deepEqual(graph.nodes.map(({ id, title }) => ({ id, title })), [
    { id: "source", title: "Source" },
    { id: "target-id", title: "Target title" },
    { id: "orphan", title: "Orphan" }
  ])
  assert.deepEqual(graph.edges, [{ source: "source", target: "target-id" }])
  assert.equal(graph.nodes[1].documentKey, "target-key")
  assert.deepEqual(graph.nodes[1].aliases, ["Alias"])
})

test("graph labels come from shared Markdown heading rules with folder-name fallback", () => {
  const source = "\uFEFF---\r\ntheme: dark\r\n---\r\n\r\n```md\r\n# Fenced heading\r\n```\r\n\t# Actual title ##\r\n    # Indented code"
  assert.equal(extractFirstMarkdownHeading(source), "Actual title")
  assert.equal(extractFirstMarkdownHeading("    # Code block heading\n## Not a title"), null)
  assert.equal(extractFirstMarkdownHeading("---\ntheme: dark\n---\n# Source title"), "Source title")

  const graph = buildDocumentGraph([
    { id: "portable-id", name: "Folder name", source },
    { id: "fallback-id", name: "Fallback folder", source: "## Section" }
  ])
  assert.deepEqual(graph.nodes.map(({ title }) => title), ["Actual title", "Fallback folder"])
})

test("Rails graph titles remain authoritative when the record title differs from its source heading", () => {
  const graph = buildDocumentGraph([
    { id: "record-id", title: "Graph orphan with a long mobile document label", source: "# Orphan" }
  ])
  assert.equal(graph.nodes[0].title, "Graph orphan with a long mobile document label")
})

test("aliases resolve before titles consistently and graph nodes retain stable positions", () => {
  const graph = buildDocumentGraph([
    { id: "source", title: "Source", source: "[[Shared]]" },
    { id: "alias-owner", title: "Alias owner", aliases: ["Shared"], source: "" },
    { id: "title-owner", title: "Shared", source: "" }
  ])

  assert.deepEqual(graph.edges, [{ source: "source", target: "alias-owner" }])
  assert.deepEqual(graph.nodes.map(({ x, y }) => [x, y]), [[120, 100], [340, 100], [560, 100]])
})

test("portable Markdown front matter resolves stable keys and aliases in the shared graph", () => {
  const targetSource = `---\nelef_document_key: "portable-key"\nelef_aliases: ["Old title", "Earlier name"]\n---\n# Current title`
  assert.deepEqual(parsePortableDocumentLinks(targetSource), {
    documentKey: "portable-key",
    aliases: ["Old title", "Earlier name"]
  })
  assert.equal(createDocumentLinkResolver([{ id: "manifest-uuid", title: "Current title", source: targetSource }])("Earlier name")?.id,
    "manifest-uuid")
  const graph = buildDocumentGraph([
    { id: "source", title: "Source", source: "[[document:portable-key|by key]] [[Earlier name|by alias]]" },
    { id: "manifest-uuid", name: "Target folder", source: targetSource }
  ])

  assert.equal(graph.nodes[1].documentKey, "portable-key")
  assert.deepEqual(graph.nodes[1].aliases, ["Old title", "Earlier name"])
  assert.deepEqual(graph.edges, [{ source: "source", target: "manifest-uuid" }])
})

test("duplicate portable keys and aliases stay unresolved instead of selecting the last document", () => {
  const source = key => `---\nelef_document_key: ${JSON.stringify(key)}\nelef_aliases: ["Shared previous title"]\n---\n`
  const resolve = createDocumentLinkResolver([
    { id: "first", title: "First", source: source("shared-key") },
    { id: "second", title: "Second", source: source("shared-key") }
  ])

  assert.equal(resolve("document:shared-key"), null)
  assert.equal(resolve("Shared previous title"), null)
  assert.equal(resolve("id:first")?.id, "first")
  assert.equal(resolve("id:second")?.id, "second")
  assert.deepEqual(buildDocumentGraph([
    { id: "source", title: "Source", source: "[[document:shared-key]] [[Shared previous title]]" },
    { id: "first", title: "First", source: source("shared-key") },
    { id: "second", title: "Second", source: source("shared-key") }
  ]).edges, [])
})

test("malformed portable Markdown metadata safely falls back to the deck identity", () => {
  assert.deepEqual(parsePortableDocumentLinks("---\nelef_document_key: [bad\nelef_aliases: nope\n---\n# Notes"), {
    documentKey: null,
    aliases: []
  })
  const graph = buildDocumentGraph([{ id: "manifest-uuid", name: "Notes", source: "---\nelef_document_key: [bad\n---\n# Notes" }])
  assert.equal(graph.nodes[0].documentKey, "manifest-uuid")
})
