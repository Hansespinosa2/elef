import assert from "node:assert/strict"
import test from "node:test"

import { buildDocumentGraph, extractDocumentLinkTitles, extractFirstMarkdownHeading } from "../../../app/javascript/lib/document_links.js"

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
