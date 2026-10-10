import assert from "node:assert/strict"
import test from "node:test"

import { mermaidAssetUrl } from "@elef/editor-runtime/test-internals"

test("Mermaid asset resolution prefers the Rails importmap", () => {
  globalThis.document = {
    querySelector(selector) {
      if (selector === 'script[type="importmap"]') {
        return { textContent: JSON.stringify({ imports: { mermaid: "/assets/mermaid.js" } }) }
      }
      return { content: "./assets/mermaid.min.js" }
    }
  }

  assert.equal(mermaidAssetUrl(), "/assets/mermaid.js")
})

test("the desktop host can resolve its packaged Mermaid bundle without an importmap", () => {
  globalThis.document = {
    querySelector(selector) {
      if (selector === 'script[type="importmap"]') return null
      return { content: "./assets/mermaid.min.js" }
    }
  }

  assert.equal(mermaidAssetUrl(), "./assets/mermaid.min.js")
})
