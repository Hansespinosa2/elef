import assert from "node:assert/strict"
import test from "node:test"
import { createPreviewFetch } from "../src/preview-transport.js"

test("preview transport awaits source-aware document context before rendering", async () => {
  const source = "See [[E2E linked]]."
  const documentNodes = [{ id: "linked-id", title: "E2E linked" }]
  let contextSource = null
  let renderInput = null
  const previewFetch = createPreviewFetch({
    renderer: {
      async render(input) {
        renderInput = input
        return { html: "<p>See <a href=\"#deck/linked-id\">E2E linked</a>.</p>" }
      }
    },
    async getContext(renderedSource) {
      contextSource = renderedSource
      await Promise.resolve()
      return { documentNodes }
    }
  })
  const body = new FormData()
  body.set("presentation[source]", source)

  const response = await previewFetch("elef-preview://localhost/deck-id", { method: "POST", body })

  assert.equal(response.status, 200)
  assert.equal(contextSource, source)
  assert.deepEqual(renderInput.documentNodes, documentNodes)
})
