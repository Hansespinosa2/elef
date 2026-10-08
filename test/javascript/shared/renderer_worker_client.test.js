import assert from "node:assert/strict"
import test from "node:test"
import { createRendererClient } from "../../../app/javascript/lib/renderer_worker_client.js"

class FakeWorker {
  static last = null
  static count = 0

  constructor() {
    FakeWorker.last = this
    FakeWorker.count += 1
    this.listeners = new Map()
    this.messages = []
    this.terminated = false
  }

  addEventListener(name, callback) {
    this.listeners.set(name, callback)
  }

  postMessage(message) {
    this.lastMessage = message
    this.messages.push(message)
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

test("renderer warmup spawns the worker once without a pending request", async () => {
  const before = FakeWorker.count
  const client = createRendererClient({ WorkerClass: FakeWorker, timeoutMs: 100, workerUrl: "worker" })
  await client.warmup()
  assert.equal(FakeWorker.count, before + 1)
  assert.deepEqual(
    FakeWorker.last.messages,
    [
      { id: 0, input: { source: "# Warmup\n\nInline $x^2$ math.\n\n```js\nconst warm = 1\n```\n\n---\n\nSecond slide.\n" } },
      { id: 0, input: { kind: "markdown-block", source: "Elef" } },
    ],
  )
  assert.equal(client.pendingCount, 0)
  FakeWorker.last.respond({ html: "<p>Elef</p>" })
  assert.equal(client.pendingCount, 0)
  await client.warmup()
  assert.equal(FakeWorker.count, before + 1)
})

test("renderer warmup without worker support resolves silently", async () => {
  const before = FakeWorker.count
  const client = createRendererClient({ WorkerClass: null, timeoutMs: 100, workerUrl: "worker" })
  await client.warmup()
  assert.equal(FakeWorker.count, before)
  assert.equal(client.pendingCount, 0)
})
