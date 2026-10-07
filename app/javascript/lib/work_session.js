// Shared work-session factory over createSaveFlow, implementing the
// contracts WorkSession surface (packages/contracts/src/session.ts).
//
// Pre-migration home: this module graduates to client/session/ in Phases
// 03-09, which own that move. It is host-agnostic: the host supplies a
// transport (persistence IPC) and a policy (editor bindings, timing,
// callbacks). No host branches are allowed here.
//
// Session lifetime: one session per opened work. Switching works means
// dispose() plus a new session. The host must show the deck text in the
// editor before creating the session, so the initial baseline matches.
//
// External changes arrive through transport.pollFileEvents() on the policy
// cadence. SourceChanged events merge silently when the merge hook reports
// a clean merge; overlap, suspicious, and hook failures take the conflict
// path after a pre-merge snapshot. SourceRemoved events notify subscribers
// with a removed-marked snapshot; the editor text is left untouched.
import { createSaveFlow } from "./save_flow.js"

const HASH_PATTERN = /^[a-f\d]{64}$/i

const ERROR_CATEGORIES = {
  conflict: "conflict",
  not_found: "not_found",
  invalid_input: "invalid_input",
  invalid_response: "invalid_input",
  invalid_document: "invalid_document",
  invalid_archive: "invalid_archive",
  unsupported_version: "unsupported_version",
  permission_denied: "permission_denied",
  unauthenticated: "unauthenticated",
  entitlement_required: "entitlement_required",
  storage_unavailable: "storage_unavailable",
  cancelled: "cancelled"
}

function toElefError(error) {
  if (!error || typeof error !== "object") {
    return { category: "internal", message: String(error ?? "Unknown error."), retryable: false }
  }
  return {
    category: ERROR_CATEGORIES[error.code] || "internal",
    message: typeof error.message === "string" ? error.message : "Operation failed.",
    retryable: error.retryable === true
  }
}

export function createWorkSession({ transport, policy }) {
  if (!transport || typeof transport !== "object") {
    throw new TypeError("createWorkSession requires a transport.")
  }
  if (typeof transport.saveSource !== "function" || typeof transport.acceptDiskVersion !== "function") {
    throw new TypeError("Session transport requires saveSource() and acceptDiskVersion().")
  }
  if (!policy || typeof policy !== "object") {
    throw new TypeError("createWorkSession requires a policy.")
  }
  const {
    workId,
    kind = "presentation",
    deck,
    getText,
    setText = null,
    saveDelay = 650,
    externalPollMs = 0,
    workspaceId = "",
    title = "",
    materializeEdits = () => {},
    onConflict = () => {},
    onError = () => {},
    setTimer = setTimeout,
    clearTimer = clearTimeout
  } = policy
  if (typeof workId !== "string" || workId.length === 0) {
    throw new TypeError("Session policy requires a workId.")
  }
  if (typeof getText !== "function") {
    throw new TypeError("Session policy requires getText().")
  }
  if (!deck || deck.id !== workId || !HASH_PATTERN.test(deck.content_hash || "")) {
    throw new TypeError("Session policy requires the opened deck for workId.")
  }

  let baseline = deck.content_hash
  let lastError = null
  let lastPollErrorKey = null
  let disposed = false
  let pollTimer = null
  let pollBusy = false
  const externalHandlers = new Set()
  const statusHandlers = new Set()

  function currentSnapshot() {
    return {
      id: workId,
      workspaceId,
      title,
      kind,
      text: getText(),
      baseline: { revision: baseline }
    }
  }

  function reportError(error) {
    lastError = toElefError(error)
    onError(error)
  }

  function notifyExternal(snapshot) {
    for (const handler of [...externalHandlers]) handler(snapshot)
  }

  function mapStatus(state) {
    if (flow.blocked) {
      return {
        kind: "error",
        error: lastError || { category: "internal", message: "Save blocked.", retryable: false }
      }
    }
    if (flow.conflict) return { kind: "dirty" }
    if (state === "Saved") return { kind: "clean" }
    if (flow.saving || (typeof state === "string" && state.startsWith("Saving"))) {
      return { kind: "saving" }
    }
    if (flow.dirty) return { kind: "dirty" }
    return { kind: "clean" }
  }

  function notifyStatus(state) {
    if (disposed) return
    const status = mapStatus(state)
    for (const handler of [...statusHandlers]) handler(status)
  }

  const flow = createSaveFlow({
    saveSource: async (id, source, options) => {
      const result = await transport.saveSource(id, source, options)
      if (result && typeof result.content_hash === "string") baseline = result.content_hash
      return result
    },
    acceptDiskVersion: (id, contentHash) => {
      baseline = contentHash
      return transport.acceptDiskVersion(id, contentHash)
    },
    mergeExternalChange: typeof transport.mergeExternalChange === "function"
      ? ((id, localSource) => transport.mergeExternalChange(id, localSource))
      : null,
    takeSnapshot: typeof transport.takeSnapshot === "function"
      ? ((id, reason, source) => transport.takeSnapshot(id, reason, source))
      : null,
    getSource: () => getText(),
    setSource: setText ? ((source, meta) => setText(source, meta)) : () => false,
    saveDelay,
    materializeEdits,
    onState: notifyStatus,
    onConflict,
    onError: reportError,
    setTimer,
    clearTimer
  })
  flow.activate(deck)

  async function handleExternalEvent(event) {
    if (typeof transport.readSourceSnapshot !== "function") return
    if (event.kind === "SourceRemoved") {
      let snapshot = null
      try {
        snapshot = await transport.readSourceSnapshot(workId)
      } catch (error) {
        notifyExternal({ ...currentSnapshot(), removed: true })
        const key = error?.code || "unknown"
        if (key !== lastPollErrorKey) {
          lastPollErrorKey = key
          reportError(error)
        }
        return
      }
      lastPollErrorKey = null
      if (snapshot) return handleChangedSnapshot(snapshot)
      return
    }
    let snapshot
    try {
      snapshot = await transport.readSourceSnapshot(workId)
    } catch (error) {
      const key = error?.code || "unknown"
      if (key !== lastPollErrorKey) {
        lastPollErrorKey = key
        reportError(error)
      }
      return
    }
    lastPollErrorKey = null
    await handleChangedSnapshot(snapshot)
  }

  async function handleChangedSnapshot(snapshot) {
    notifyExternal({
      id: workId,
      workspaceId,
      title,
      kind,
      text: snapshot.source,
      baseline: { revision: snapshot.content_hash }
    })
    await flow.resolveExternalChange(workId, snapshot)
  }

  async function drainExternalEvents() {
    if (disposed || pollBusy) return
    pollBusy = true
    try {
      const events = await transport.pollFileEvents()
      for (const event of events || []) {
        if (disposed || !event || event.deck_id !== workId) continue
        await handleExternalEvent(event)
      }
    } catch (error) {
      const key = error?.code || "unknown"
      if (key !== lastPollErrorKey) {
        lastPollErrorKey = key
        reportError(error)
      }
    } finally {
      pollBusy = false
    }
  }

  function schedulePoll() {
    if (disposed || !externalPollMs || typeof transport.pollFileEvents !== "function") return
    pollTimer = setTimer(() => {
      pollTimer = null
      void drainExternalEvents().finally(schedulePoll)
    }, externalPollMs)
  }
  schedulePoll()

  function onExternalChange(handler) {
    if (typeof handler !== "function") throw new TypeError("onExternalChange requires a handler.")
    externalHandlers.add(handler)
    return () => { externalHandlers.delete(handler) }
  }

  function onStatus(handler) {
    if (typeof handler !== "function") throw new TypeError("onStatus requires a handler.")
    statusHandlers.add(handler)
    handler(mapStatus())
    return () => { statusHandlers.delete(handler) }
  }

  async function replaceText(text) {
    if (typeof text !== "string") throw new TypeError("replaceText requires a string.")
    if (disposed) throw new Error("Session is disposed.")
    if (typeof setText !== "function") throw new Error("Session policy does not support replaceText.")
    materializeEdits()
    const applied = await setText(text, { id: workId, expectedSource: getText() })
    if (applied === false) throw new Error("Text replacement was not applied.")
    flow.noteChange()
  }

  function applyLocalChange(change) {
    const current = getText()
    const from = change?.from
    const to = change?.to
    const insert = change?.insert
    if (!Number.isInteger(from) || !Number.isInteger(to) || typeof insert !== "string") {
      throw new TypeError("applyLocalChange requires { from, to, insert }.")
    }
    if (from < 0 || to < from || to > current.length) {
      throw new RangeError("applyLocalChange range is outside the current text.")
    }
    return replaceText(current.slice(0, from) + insert + current.slice(to))
  }

  async function flush() {
    const before = baseline
    const ok = await flow.flush()
    if (disposed) {
      return { kind: "failed", error: { category: "cancelled", message: "Session is disposed.", retryable: false } }
    }
    const conflict = flow.conflict
    if (conflict) {
      return {
        kind: "conflict",
        current: {
          id: workId,
          workspaceId,
          title,
          kind,
          text: conflict.diskSource,
          baseline: { revision: conflict.diskHash }
        }
      }
    }
    if (!ok) {
      return {
        kind: "failed",
        error: lastError || { category: "internal", message: "Save did not complete.", retryable: false }
      }
    }
    return { kind: baseline === before ? "clean" : "saved", baseline: { revision: baseline } }
  }

  function dispose() {
    if (disposed) return
    disposed = true
    clearTimer(pollTimer)
    pollTimer = null
    externalHandlers.clear()
    statusHandlers.clear()
    flow.deactivate()
  }

  return {
    get workId() { return workId },
    get kind() { return kind },
    get dirty() { return flow.dirty },
    get conflict() { return flow.conflict },
    getText: () => getText(),
    applyLocalChange,
    replaceText,
    onExternalChange,
    onStatus,
    flush,
    dispose
  }
}
