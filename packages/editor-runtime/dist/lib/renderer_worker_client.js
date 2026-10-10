const RENDER_TIMEOUT_MS = 4e3;
function createRendererClient({
  WorkerClass = globalThis.Worker,
  timeoutMs = RENDER_TIMEOUT_MS,
  workerUrl = new URL("./renderer-worker.js", import.meta.url)
} = {}) {
  let worker = null;
  let nextId = 0;
  const pending = /* @__PURE__ */ new Map();
  const WARMUP_ID = 0;
  let warmupPromise = null;
  function failAll(error) {
    for (const request2 of pending.values()) {
      clearTimeout(request2.timer);
      request2.reject(error);
    }
    pending.clear();
    worker?.terminate();
    worker = null;
  }
  function ensureWorker() {
    if (worker) return worker;
    if (typeof WorkerClass !== "function") throw Object.assign(new Error("Preview workers are unavailable."), { code: "unsupported", retryable: false });
    worker = new WorkerClass(workerUrl, { type: "module", name: "elef-markdown-renderer" });
    worker.addEventListener("message", ({ data }) => {
      const request2 = pending.get(data?.id);
      if (!request2) return;
      pending.delete(data.id);
      clearTimeout(request2.timer);
      if (data.error) {
        request2.reject(Object.assign(new Error(data.error.message), data.error));
      } else {
        request2.resolve(data.result);
      }
    });
    worker.addEventListener("error", () => failAll(Object.assign(new Error("The preview renderer stopped unexpectedly."), { code: "render_error", retryable: true })));
    return worker;
  }
  function request(input) {
    const id = ++nextId;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        const request2 = pending.get(id);
        pending.delete(id);
        const error = Object.assign(new Error("Preview took too long and was stopped. Your source is safe."), { code: "render_timeout", retryable: true });
        request2?.reject(error);
        failAll(error);
      }, timeoutMs);
      pending.set(id, { resolve, reject, timer });
      try {
        ensureWorker().postMessage({ id, input });
      } catch (error) {
        pending.delete(id);
        clearTimeout(timer);
        reject(error);
      }
    });
  }
  const WARMUP_DECK = "# Warmup\n\nInline $x^2$ math.\n\n```js\nconst warm = 1\n```\n\n---\n\nSecond slide.\n";
  function warmup() {
    if (!warmupPromise) {
      warmupPromise = (async () => {
        try {
          const prewarmed = ensureWorker();
          prewarmed.postMessage({ id: WARMUP_ID, input: { source: WARMUP_DECK } });
          prewarmed.postMessage({ id: WARMUP_ID, input: { kind: "markdown-block", source: "Elef" } });
        } catch (_error) {
        }
      })();
    }
    return warmupPromise;
  }
  return {
    warmup() {
      return warmup();
    },
    render(input) {
      return request(input);
    },
    async renderMarkdownBlock(source) {
      const result = await request({ kind: "markdown-block", source });
      if (typeof result !== "string") {
        throw Object.assign(new Error(`Preview markdown-block reply was not text (got ${typeof result}).`), { code: "render_type", retryable: false });
      }
      return result;
    },
    terminate() {
      failAll(Object.assign(new Error("Preview renderer was closed."), { code: "render_cancelled", retryable: false }));
    },
    get pendingCount() {
      return pending.size;
    }
  };
}
export {
  createRendererClient
};
