import test from "node:test"
import assert from "node:assert/strict"
import { renderPreviewCore, renderSourceProjection } from "../src/index.js"

function withoutAnnotations(html: string): string {
  return html.replace(/ data-source-(?:node|start|end|revision)="[^"]*"/g, "")
}

for (const kind of ["document", "presentation"]) {
  for (const separator of ["\n", "\r\n", "\r"]) {
    test(`${kind} annotated projection preserves reader markup and source ranges (${JSON.stringify(separator)})`, () => {
      const source = [
        "---", "theme: dark", "---", "# Unicode 😀 é", "",
        "A **nested *emphasis*** with [link](https://example.com) and $x^2$.", "",
        ":::align{center}", "- First", "- Second", "",
        "```md", "# concealed heading", "```", "",
        "---", "# Final", "", "$$", "\\begin{pmatrix}a&b\\\\c&d\\end{pmatrix}", "$$"
      ].join(separator)
      const input = { source, kind }
      const projection = renderSourceProjection(input, 7)
      assert.equal(withoutAnnotations(projection.html), renderPreviewCore(input).html)
      assert.equal(projection.revision, 7)
      assert.ok(projection.nodes.length >= 4)
      const blocks = projection.editor_map.slides.flatMap(slide => slide.blocks)
      assert.equal(new Set(projection.nodes.map(node => node.id)).size, projection.nodes.length)
      for (const node of projection.nodes) {
        const block = blocks.find(block => block.id === node.id)
        assert.ok(block)
        assert.deepEqual(node.range, block.source_range)
        assert.deepEqual(node.contentRange, block.content_range)
        assert.ok(node.range.start >= 0 && node.range.end <= source.length)
        assert.match(projection.html, new RegExp(`data-source-node="${node.id}"[^>]*data-source-revision="7"`))
      }
      assert.doesNotMatch(projection.html, /contenteditable|<button|<select|data-action/)
    })
  }
}

test("projection snapshots retain their own revision and ranges across edits", () => {
  const previous = renderSourceProjection({ source: "# Before\n\nText", kind: "document" }, 10)
  const current = renderSourceProjection({ source: "# After 😀\n\nMore text", kind: "document" }, 11)
  assert.equal(previous.revision, 10)
  assert.equal(current.revision, 11)
  assert.notDeepEqual(previous.nodes, current.nodes)
  assert.ok(previous.nodes.every(node => node.range.end <= previous.editor_map.source_length))
})

test("invalid revision cannot create an ambiguous snapshot", () => {
  for (const revision of [-1, NaN, Infinity, 0.5, Number.MAX_SAFE_INTEGER + 1]) {
    assert.throws(() => renderSourceProjection({ source: "Text" }, revision), RangeError)
  }
})
