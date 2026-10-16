import assert from "node:assert/strict"
import { readFile } from "node:fs/promises"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { browser } from "@wdio/globals"

// Same exact-byte corpus as the Node fixtures test, round-tripped through
// the real desktop renderer worker inside the Tauri webview. The worker
// renders blocks without media options, so block bytes are asserted only for
// cases whose fixture input carries no media map or remote-media flag.
const e2eRoot = path.dirname(path.dirname(fileURLToPath(import.meta.url)))
const repoRoot = path.resolve(e2eRoot, "../../..")
const inputs = JSON.parse(await readFile(path.join(repoRoot, "apps/web/test/javascript/fixtures/renderer-inputs.json"), "utf8"))
const outputs = JSON.parse(await readFile(path.join(repoRoot, "apps/web/test/javascript/fixtures/renderer-outputs.json"), "utf8"))

function workerSupportsBlock(input) {
  return !input.mediaMap && input.allowRemoteMedia !== true
}

async function renderThroughWorker(message) {
  const response = await browser.executeAsync((payload, done) => {
    const url = new URL("/assets/renderer-worker.js", window.location.origin)
    const worker = new Worker(url, { type: "module" })
    const timer = setTimeout(() => {
      worker.terminate()
      done({ error: "renderer worker timed out" })
    }, 15_000)
    worker.onmessage = event => {
      if (event.data?.id !== payload.id) return
      clearTimeout(timer)
      worker.terminate()
      done(event.data)
    }
    worker.onerror = () => {
      clearTimeout(timer)
      worker.terminate()
      done({ error: "renderer worker failed to start" })
    }
    worker.postMessage(payload)
  }, message)
  assert(!response.error, response.error?.message || "renderer worker error")
  return response.result
}

describe("renderer corpus through the desktop worker", () => {
  for (const [index, { name, input }] of inputs.entries()) {
    it(`renders exact preview bytes: ${name}`, async () => {
      assert.equal(outputs[index].name, name)
      assert.deepEqual(await renderThroughWorker({ id: index + 1, input }), outputs[index].preview)
    })

    if (workerSupportsBlock(input)) {
      it(`renders exact block bytes: ${name}`, async () => {
        assert.equal(
          await renderThroughWorker({
            id: 10_000 + index + 1,
            input: { kind: "markdown-block", source: input.source }
          }),
          outputs[index].blockHtml
        )
      })
    }
  }
})
