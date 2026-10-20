import assert from "node:assert/strict"
import test from "node:test"
import { parseHTML } from "linkedom"

import {
  configureEditorKind,
  metadataCandidatesFor,
  metadataQueryAt,
  rankMetadataCandidates,
  renderEditorView
} from "@elef/editor-runtime/test-internals"

function caret(source, marker = "|") {
  const index = source.indexOf(marker)
  assert.notEqual(index, -1)
  return { source: source.slice(0, index) + source.slice(index + 1), caret: index }
}

test("metadata assist suggests keys on new lines inside the block", () => {
  const { source, caret: pos } = caret("---\ntheme: dark\n|\n---\n# Hi\n")
  const query = metadataQueryAt(source, pos)
  assert.equal(query?.kind, "key")
  assert.equal(query?.text, "")
  assert.equal(query?.nested, false)
  const matches = rankMetadataCandidates(metadataCandidatesFor(query), query.text)
  assert.deepEqual(matches, ["show-in-margin", "theme", "typography"])
})

test("metadata assist filters keys with fuzzy matching and ranking", () => {
  const { source, caret: pos } = caret("---\nthe|\n---\n# Hi\n")
  const query = metadataQueryAt(source, pos)
  assert.equal(query?.kind, "key")
  assert.equal(query?.text, "the")
  const matches = rankMetadataCandidates(metadataCandidatesFor(query), query.text)
  assert.equal(matches[0], "theme")
})

test("metadata assist suggests values after key colon with Tab-style completion", () => {
  const { source, caret: pos } = caret("---\ntheme: d|\n---\n# Hi\n")
  const query = metadataQueryAt(source, pos)
  assert.equal(query?.kind, "value")
  assert.equal(query?.key, "theme")
  assert.equal(query?.text, "d")
  const matches = rankMetadataCandidates(metadataCandidatesFor(query), query.text)
  assert.deepEqual(matches, ["dark"])
})

test("metadata assist completes an empty value query to every valid value", () => {
  const { source, caret: pos } = caret("---\ntypography: |\n---\n# Hi\n")
  const query = metadataQueryAt(source, pos)
  assert.equal(query?.kind, "value")
  const matches = rankMetadataCandidates(metadataCandidatesFor(query), query.text)
  assert.deepEqual(matches, ["book", "modern", "technical"])
})

test("metadata assist suggests margin subkeys on indented lines", () => {
  const { source, caret: pos } = caret("---\nshow-in-margin:\n  sec|\n---\n# Hi\n")
  const query = metadataQueryAt(source, pos)
  assert.equal(query?.kind, "key")
  assert.equal(query?.nested, true)
  const matches = rankMetadataCandidates(metadataCandidatesFor(query), query.text)
  assert.equal(matches[0], "section")
})

test("metadata assist suggests booleans for margin values", () => {
  const { source, caret: pos } = caret("---\nshow-in-margin:\n  section: t|\n---\n# Hi\n")
  const query = metadataQueryAt(source, pos)
  assert.equal(query?.kind, "value")
  const matches = rankMetadataCandidates(metadataCandidatesFor(query), query.text)
  assert.deepEqual(matches, ["true"])
})

test("metadata assist stays closed for unknown keys, invalid spots, and empty matches", () => {
  const unknown = caret("---\nbogus: v|\n---\n# Hi\n")
  assert.equal(metadataQueryAt(unknown.source, unknown.caret), null)
  const outside = caret("# Hi\ntheme: d|\n")
  assert.equal(metadataQueryAt(outside.source, outside.caret), null)
  const body = caret("---\ntheme: dark\n---\n# Hi theme: d|\n")
  assert.equal(metadataQueryAt(body.source, body.caret), null)
  const fence = caret("---\n---|\n# Hi\n")
  assert.equal(metadataQueryAt(fence.source, fence.caret), null)
  assert.deepEqual(rankMetadataCandidates(["dark"], "zzz"), [])
  assert.deepEqual(rankMetadataCandidates(["dark", "light"], ""), ["dark", "light"])
})

test("shared editor view mounts the metadata palette for both hosts", () => {
  const { document } = parseHTML("<form><div id='mount'></div></form>")
  const root = renderEditorView(document.querySelector("#mount"), {
    kind: "document",
    mode: "source",
    source: "---\ntheme: dark\n---\n# Shared"
  })
  const palette = root.querySelector("[aria-label='Metadata suggestions']")
  assert.notEqual(palette, null)
  assert.equal(palette?.getAttribute("role"), "listbox")
  configureEditorKind(root, "document", {})
  const field = root.querySelector(".source-field")
  assert.match(field?.dataset.controller ?? "", /metadata-assist/)
})
