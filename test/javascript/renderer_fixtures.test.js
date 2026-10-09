import test from "node:test"
import assert from "node:assert/strict"
import { readFile } from "node:fs/promises"
import vm from "node:vm"

const inputs = JSON.parse(await readFile(new URL("./fixtures/renderer-inputs.json", import.meta.url)))
const outputs = JSON.parse(await readFile(new URL("./fixtures/renderer-outputs.json", import.meta.url)))
const sandbox = vm.createContext({})
vm.runInContext(await readFile(new URL("../../vendor/javascript/elef-renderer.bundle.js", import.meta.url), "utf8"), sandbox)

assert.deepEqual(inputs.map(row => row.name), outputs.map(row => row.name), "Every fixture needs a reviewed expected output")
for (const [index, { name, input }] of inputs.entries()) {
  test(`shared bundle exact fixture: ${name}`, () => {
    const renderer = sandbox.ElefRenderer
    assert.equal(renderer.renderMarkdownBlock(input.source, {
      mediaMap: input.mediaMap || {},
      allowRemoteMedia: input.allowRemoteMedia === true
    }), outputs[index].blockHtml)
    // Strip V8 realm prototypes, preserving every value and HTML byte.
    assert.deepEqual(JSON.parse(JSON.stringify(renderer.renderPreview(input))), outputs[index].preview)
    assert.deepEqual(JSON.parse(JSON.stringify(renderer.buildEditorMap(input.source, {
      mode: input.kind, sourceName: input.title
    }))), outputs[index].preview.editor_map)
  })
}

test("hostile URL fixture rejects executable link protocols while keeping mail links", () => {
  const fixture = inputs.find(({ name }) => name === "hostile-content-and-urls")
  const html = sandbox.ElefRenderer.renderMarkdownBlock(fixture.input.source)

  assert.match(html, /href="mailto:a@example\.com"/)
  assert.doesNotMatch(html, /href="(?:javascript|data|vbscript):/i)
})
