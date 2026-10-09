import assert from "node:assert/strict"
import test from "node:test"
import { createRendererClient } from "../../../app/javascript/lib/renderer_worker_client.js"

class FakeWorker {
  static last = null

  constructor() {
    FakeWorker.last = this
    this.listeners = new Map()
    this.terminated = false
  }

  addEventListener(name, callback) {
    this.listeners.set(name, callback)
  }

  postMessage(message) {
    this.lastMessage = message
  }

  respond(result) {
    this.listeners.get("message")?.({ data: { id: this.lastMessage.id, result } })
  }

  terminate() {
    this.terminated = true
  }
}

test("renderer client resolves worker results and releases pending requests", async () => {
  const client = createRendererClient({ WorkerClass: FakeWorker, timeoutMs: 100, workerUrl: "worker" })
  const resultPromise = client.render({ source: "# Offline" })
  FakeWorker.last.respond({ html: "<h1>Offline</h1>" })
  assert.deepEqual(await resultPromise, { html: "<h1>Offline</h1>" })
  assert.equal(client.pendingCount, 0)
})

test("renderer timeout rejects the waiting request and restarts the worker", async () => {
  const client = createRendererClient({ WorkerClass: FakeWorker, timeoutMs: 5, workerUrl: "worker" })
  await assert.rejects(client.render({ source: "large" }), { code: "render_timeout", retryable: true })
  assert.equal(client.pendingCount, 0)
  assert.equal(FakeWorker.last.terminated, true)
})
