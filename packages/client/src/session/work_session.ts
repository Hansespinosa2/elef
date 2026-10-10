// Shared work-session factory over createSaveFlow, implementing the
// contracts WorkSession surface (packages/contracts/src/session.ts).
//
// Client-owned since Phase 08 (moved from apps/web/app/javascript/lib/). It is
// host-agnostic: the host supplies a transport (persistence IPC) and a
// policy (editor bindings, timing, callbacks). No host branches are
// allowed here.
//
// Session lifetime: one session per opened work. Switching works means
// dispose() plus a new session. The host must show the deck text in the
// editor before creating the session, so the initial baseline matches.
//
// External changes arrive through transport.pollFileEvents() on the policy
// cadence. SourceChanged events merge silently when the merge hook reports
// a clean merge; overlap, suspicious, and hook failures take the conflict
// path after snapshots of both sides. SourceRemoved events notify
// subscribers with a removed-marked snapshot; the editor text is left
// untouched. Notifications carry two pre-migration extensions beyond the
// contract WorkSnapshot: sourceFile (the disk source file name) and removed.
import {
  asTransportFailure,
  createSaveFlow,
  type ConflictDetailsInput,
  type ExternalSnapshot,
  type MergeOutcome,
  type SaveConflict,
  type SaveDeck,
  type SaveFlowStatus,
  type SaveSourceResult,
} from "./save_flow.js"
import { assertEditorAdapter, type EditorAdapterSetMeta } from "./editor_adapter.js"

let sessionEpoch = 0

const ERROR_CATEGORIES: Record<string, string> = {
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

export interface SessionElefError {
  category: string
  message: string
  retryable: boolean
}

export type SessionStatus =
  | { kind: "clean" }
  | { kind: "dirty" }
  | { kind: "saving" }
  | { kind: "error"; error: SessionElefError }

export interface SessionSnapshotNotification {
  id: string
  workspaceId: string
  title: string
  kind: string
  text: string
  sourceFile?: string | undefined
  baseline: { revision: string }
  removed?: boolean
}

export interface SessionFileEvent {
  kind: string
  deck_id: string
}

export interface WorkSessionTransport {
  saveSource(id: string, source: string, options: { snapshot: string }): Promise<SaveSourceResult>
  acceptDiskVersion(id: string, contentHash: string): void
  mergeExternalChange?: (id: string, localSource: string) => Promise<MergeOutcome | null | undefined>
  takeSnapshot?: (id: string, reason: string, source?: string) => Promise<unknown>
  readSourceSnapshot?: (id: string) => Promise<ExternalSnapshot | null>
  pollFileEvents?: () => Promise<Array<SessionFileEvent> | null | undefined>
}

export interface WorkSessionPolicy {
  workId: string
  kind?: string
  deck: SaveDeck
  getText(): string
  setText?: ((source: string, meta: EditorAdapterSetMeta) => boolean | Promise<boolean>) | null
  getSnapshot?: () => string
  getConflictSnapshot?: (details: ConflictDetailsInput) => string
  getConflictBaseline?: (details: ConflictDetailsInput) => unknown
  isValidConflictBaseline?: (value: unknown) => boolean
  saveDelay?: number
  externalPollMs?: number
  snapshotIntervalMs?: number
  workspaceId?: string
  title?: string
  materializeEdits?: () => void
  onState?: ((state: string, details: SaveFlowStatus) => void) | null
  onConflict?: (conflict: SaveConflict) => void
  onError?: (error: unknown) => void
  setTimer?: typeof setTimeout
  clearTimer?: typeof clearTimeout
}

export type SessionFlushResult =
  | { kind: "clean"; baseline: { revision: string } }
  | { kind: "saved"; baseline: { revision: string } }
  | { kind: "conflict"; current: SessionSnapshotNotification }
  | { kind: "failed"; error: SessionElefError }

function toElefError(error: unknown): SessionElefError {
  if (!error || typeof error !== "object") {
    return { category: "internal", message: String(error ?? "Unknown error."), retryable: false }
  }
  const failure = error as { code?: unknown; message?: unknown; retryable?: unknown }
  return {
    category: (typeof failure.code === "string" && ERROR_CATEGORIES[failure.code]) || "internal",
    message: typeof failure.message === "string" ? failure.message : "Operation failed.",
    retryable: failure.retryable === true
  }
}

export function createWorkSession({ transport: transportOption, policy: policyOption }: {
  transport: WorkSessionTransport | null | undefined
  policy: WorkSessionPolicy | null | undefined
}) {
  // Baseline opacity: the flow only compares baselines for equality, so any
  // non-empty token binds the session. Desktop passes 64-hex content hashes;
  // web passes revision tokens shaped `lock_version:digest` (see Work#revision_token).
  if (!transportOption || typeof transportOption !== "object") {
    throw new TypeError("createWorkSession requires a transport.")
  }
  if (typeof transportOption.saveSource !== "function" || typeof transportOption.acceptDiskVersion !== "function") {
    throw new TypeError("Session transport requires saveSource() and acceptDiskVersion().")
  }
  if (!policyOption || typeof policyOption !== "object") {
    throw new TypeError("createWorkSession requires a policy.")
  }
  // Const bindings so the validated narrowing persists into every closure below.
  const transport = transportOption
  const policy = policyOption
  const {
    workId,
    kind = "presentation",
    deck,
    getText,
    setText = null,
    getSnapshot,
    getConflictSnapshot,
    getConflictBaseline,
    isValidConflictBaseline,
    saveDelay = 650,
    externalPollMs = 0,
    snapshotIntervalMs = 0,
    workspaceId = "",
    title = "",
    materializeEdits = () => {},
    onState = null,
    onConflict = () => {},
    onError = () => {},
    setTimer = setTimeout,
    clearTimer: clearTimerOption = clearTimeout
  } = policy
  // Nullable handles clear as undefined: every host clearTimeout (and the
  // unit-test fakes) treats both as a no-op, exactly like before.
  const clearTimer = (timer: ReturnType<typeof setTimeout> | null): void => {
    clearTimerOption(timer ?? undefined)
  }
  if (typeof workId !== "string" || workId.length === 0) {
    throw new TypeError("Session policy requires a workId.")
  }
  if (typeof getText !== "function") {
    throw new TypeError("Session policy requires getText().")
  }
  assertEditorAdapter({ getText, setText: setText ?? (() => false), materializeEdits })
  if (!deck || deck.id !== workId || typeof deck.content_hash !== "string" || deck.content_hash.length === 0) {
    throw new TypeError("Session policy requires the opened deck for workId.")
  }

  const epoch = ++sessionEpoch
  let baseline = deck.content_hash
  let lastError: SessionElefError | null = null
  let lastPollErrorKey: unknown = null
  let disposed = false
  let pollTimer: ReturnType<typeof setTimeout> | null = null
  let pollBusy = false
  let snapshotTimer: ReturnType<typeof setTimeout> | null = null
  let snapshotBusy = false
  let lastSnapshotErrorKey: unknown = null
  const externalHandlers = new Set<(snapshot: SessionSnapshotNotification) => void>()
  const statusHandlers = new Set<(status: SessionStatus) => void>()

  function currentSnapshot(): SessionSnapshotNotification {
    return {
      id: workId,
      workspaceId,
      title,
      kind,
      text: getText(),
      sourceFile: deck.source_file,
      baseline: { revision: baseline }
    }
  }

  function reportError(error: unknown): void {
    lastError = toElefError(error)
    onError(error)
  }

  function notifyExternal(snapshot: SessionSnapshotNotification): void {
    for (const handler of [...externalHandlers]) handler(snapshot)
  }

  function mapStatus(state?: string): SessionStatus {
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

  function notifyStatus(state: string): void {
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
      ? ((id: string, localSource: string) => {
        const hook = transport.mergeExternalChange
        if (typeof hook !== "function") throw new TypeError("transport.mergeExternalChange is not a function")
        return hook.call(transport, id, localSource)
      })
      : null,
    takeSnapshot: typeof transport.takeSnapshot === "function"
      ? ((id: string, reason: string, source?: string) => {
        const hook = transport.takeSnapshot
        if (typeof hook !== "function") throw new TypeError("transport.takeSnapshot is not a function")
        return hook.call(transport, id, reason, source)
      })
      : null,
    getSource: () => getText(),
    setSource: setText ? ((source, meta) => setText(source, meta)) : () => false,
    ...(getSnapshot ? { getSnapshot } : null),
    ...(getConflictSnapshot ? { getConflictSnapshot } : null),
    ...(getConflictBaseline ? { getConflictBaseline } : null),
    ...(isValidConflictBaseline ? { isValidConflictBaseline } : null),
    saveDelay,
    materializeEdits,
    onState: (state, details) => {
      notifyStatus(state)
      if (typeof onState === "function") onState(state, details)
    },
    onConflict,
    onError: reportError,
    setTimer,
    clearTimer: clearTimerOption
  })
  flow.activate(deck)

  async function handleExternalEvent(event: SessionFileEvent): Promise<void> {
    if (typeof transport.readSourceSnapshot !== "function") return
    if (event.kind === "SourceRemoved") {
      let snapshot: ExternalSnapshot | null = null
      try {
        snapshot = await transport.readSourceSnapshot(workId)
      } catch (error) {
        notifyExternal({ ...currentSnapshot(), removed: true })
        const key = asTransportFailure(error).code || "unknown"
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
    let snapshot: ExternalSnapshot | null
    try {
      snapshot = await transport.readSourceSnapshot(workId)
    } catch (error) {
      const key = asTransportFailure(error).code || "unknown"
      if (key !== lastPollErrorKey) {
        lastPollErrorKey = key
        reportError(error)
      }
      return
    }
    lastPollErrorKey = null
    // A null read here throws downstream exactly like before (the transport
    // contract resolves snapshots for non-removed reads); drainExternalEvents
    // reports it as a poll error.
    await handleChangedSnapshot(snapshot as ExternalSnapshot)
  }

  async function handleChangedSnapshot(snapshot: ExternalSnapshot): Promise<void> {
    notifyExternal({
      id: workId,
      workspaceId,
      title,
      kind,
      text: snapshot.source,
      sourceFile: snapshot.source_file,
      baseline: { revision: snapshot.content_hash }
    })
    await flow.resolveExternalChange(workId, snapshot)
  }

  async function drainExternalEvents(): Promise<void> {
    if (disposed || pollBusy) return
    pollBusy = true
    try {
      const poll = transport.pollFileEvents
      if (typeof poll !== "function") return
      const events = await poll()
      for (const event of events || []) {
        if (disposed || !event || event.deck_id !== workId) continue
        await handleExternalEvent(event)
      }
    } catch (error) {
      const key = asTransportFailure(error).code || "unknown"
      if (key !== lastPollErrorKey) {
        lastPollErrorKey = key
        reportError(error)
      }
    } finally {
      pollBusy = false
    }
  }

  function schedulePoll(): void {
    if (disposed || !externalPollMs || typeof transport.pollFileEvents !== "function") return
    pollTimer = setTimer(() => {
      pollTimer = null
      void drainExternalEvents().finally(schedulePoll)
    }, externalPollMs)
  }
  schedulePoll()

  function hasUnsavedEdits(): boolean {
    try {
      return Boolean(flow.dirty)
    } catch {
      return false
    }
  }

  async function runSnapshotCadence(): Promise<unknown> {
    if (disposed || snapshotBusy) return null
    snapshotBusy = true
    try {
      const snapshotHook = transport.takeSnapshot
      if (typeof snapshotHook !== "function") return null
      if (!hasUnsavedEdits()) return null
      return await snapshotHook(workId, "periodic", getText())
    } catch (error) {
      const key = asTransportFailure(error).code || "unknown"
      if (key !== lastSnapshotErrorKey) {
        lastSnapshotErrorKey = key
        reportError(error)
      }
      return null
    } finally {
      snapshotBusy = false
    }
  }

  function scheduleSnapshots(): void {
    if (disposed || !snapshotIntervalMs || typeof transport.takeSnapshot !== "function") return
    snapshotTimer = setTimer(() => {
      snapshotTimer = null
      void runSnapshotCadence().finally(scheduleSnapshots)
    }, snapshotIntervalMs)
  }
  scheduleSnapshots()

  function onExternalChange(handler: (snapshot: SessionSnapshotNotification) => void): () => void {
    if (typeof handler !== "function") throw new TypeError("onExternalChange requires a handler.")
    externalHandlers.add(handler)
    return () => { externalHandlers.delete(handler) }
  }

  function onStatus(handler: (status: SessionStatus) => void): () => void {
    if (typeof handler !== "function") throw new TypeError("onStatus requires a handler.")
    statusHandlers.add(handler)
    handler(mapStatus())
    return () => { statusHandlers.delete(handler) }
  }

  async function replaceText(text: string): Promise<void> {
    if (typeof text !== "string") throw new TypeError("replaceText requires a string.")
    if (disposed) throw new Error("Session is disposed.")
    if (typeof setText !== "function") throw new Error("Session policy does not support replaceText.")
    materializeEdits()
    const applied = await setText(text, { id: workId, expectedSource: getText() })
    if (applied === false) throw new Error("Text replacement was not applied.")
    flow.noteChange()
  }

  function applyLocalChange(change: { from?: unknown; to?: unknown; insert?: unknown } | null | undefined): Promise<void> {
    const current = getText()
    const from = change?.from
    const to = change?.to
    const insert = change?.insert
    if (typeof from !== "number" || !Number.isInteger(from) || typeof to !== "number" || !Number.isInteger(to) || typeof insert !== "string") {
      throw new TypeError("applyLocalChange requires { from, to, insert }.")
    }
    if (from < 0 || to < from || to > current.length) {
      throw new RangeError("applyLocalChange range is outside the current text.")
    }
    return replaceText(current.slice(0, from) + insert + current.slice(to))
  }

  async function flush(options?: { force?: boolean }): Promise<SessionFlushResult> {
    const before = baseline
    const ok = await flow.flush(options || {})
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
          sourceFile: conflict.diskSourceFile,
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

  function dispose(): void {
    if (disposed) return
    disposed = true
    clearTimer(pollTimer)
    pollTimer = null
    clearTimer(snapshotTimer)
    snapshotTimer = null
    externalHandlers.clear()
    statusHandlers.clear()
    flow.deactivate()
  }

  return {
    get workId() { return workId },
    get kind() { return kind },
    get epoch() { return epoch },
    get disposed() { return disposed },
    get dirty() { return flow.dirty },
    get conflict() { return flow.conflict },
    getText: () => getText(),
    applyLocalChange,
    replaceText,
    onExternalChange,
    onStatus,
    flush,
    dispose,
    // Pre-migration host orchestration seam. The desktop host still owns the
    // editor buffer and conflict dialogs, so it drives these flow methods
    // directly. Later phases move text ownership into the session and remove
    // them one by one; new hosts must use the contract surface above.
    get revision() { return flow.revision },
    get blocked() { return flow.blocked },
    get saving() { return flow.saving },
    get canRestoreDraft() { return flow.canRestoreDraft },
    get discardedDraftCount() { return flow.discardedDraftCount },
    noteChange: flow.noteChange,
    pause: flow.pause,
    resume: flow.resume,
    handleConflict: flow.handleConflict,
    useDiskVersion: flow.useDiskVersion,
    keepLocalVersion: flow.keepLocalVersion,
    saveMergedVersion: flow.saveMergedVersion,
    restoreDraft: flow.restoreDraft,
    // Test seam: lets e2e prove the periodic-snapshot run path without
    // waiting out the five-minute cadence in real time.
    runSnapshotCadence
  }
}

export type WorkSession = ReturnType<typeof createWorkSession>
