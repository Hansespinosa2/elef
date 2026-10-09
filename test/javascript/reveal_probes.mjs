import assert from "node:assert/strict"
import test from "node:test"
import { parseHTML } from "linkedom"
import { resolveArtBindings } from "../../app/javascript/lib/art_source.js"
import { buildEditorStructure } from "../../app/javascript/lib/document_map.js"
import { renderPreview } from "../../app/javascript/lib/renderer.js"

test("a step-looking line in a list-nested fence stays code and creates no reveal event", () => {
  const source = [
    "# Nested fence",
    "",
    "- outer",
    "  - inner",
    "    ```md",
    "    :::step",
    "    still code",
    "    ```"
  ].join("\n")
  const stepLine = source.split("\n").findIndex(line => line.includes(":::step"))
  const resolution = resolveArtBindings(source)
  const structure = buildEditorStructure(source)
  const preview = renderPreview({ source })
  const { document } = parseHTML(`<html><body>${preview.html}</body></html>`)

  assert.ok(!resolution.boundary_map.directiveLines.includes(stepLine))
  assert.equal(structure.slides[0].reveal_event_count ?? 0, 0)
  assert.equal(structure.warnings.length, 0)
  assert.equal(document.querySelector(".slide-block pre code")?.textContent.trim(), ":::step\nstill code")
})
