import type { EditorAdapterSetMeta } from "./editor_adapter.js"

const MAX_DISCARDED_DRAFTS = 10
const RETRY_DELAYS = [1_000, 3_000, 10_000, 30_000]
// Clean fast-path pre-gate. Mirrors is_suspicious_external_change in
// crates/local-store/src/lib.rs exactly (200-char floor, char counts, the
// empty-external and 2:1 truncation rules): a clean buffer facing a
// suspicious-looking external rewrite must consult merge instead of
// reloading silently (P02-07). The Rust merge hook keeps the final verdict;
// this only decides whether the cheap call-free reload may run.
const SUSPICIOUS_MIN_LOCAL_CHARS = 200

export interface SaveWork {
  id: string
  content_hash: string
  source: string
  source_file?: string | undefined
  savedSnapshot?: string
}

export interface SaveSourceResult {
  content_hash: string
  source?: unknown
  snapshot?: unknown
}

export interface ConflictSnapshotInput {
  source?: unknown
  source_file?: string | undefined
}

export interface ConflictDetailsInput {
  current?: ConflictSnapshotInput
  disk_hash?: unknown
  message?: unknown
  recovery_revision_id?: unknown
}

export interface SaveConflict {
  id: string
  diskHash: string
  diskSnapshot: string
  diskSource: string
  diskSourceFile?: string | undefined
  localSource: string
  current: unknown
  message: unknown
  recovery_revision_id: unknown
}

export interface ExternalSnapshot {
  source: string
  content_hash: string
  source_file?: string | undefined
}

export interface MergeOutcome {
  kind: string
  source?: unknown
}

export interface SaveFlowStatus {
  dirty: boolean
  blocked: boolean
  conflict: SaveConflict | null
  discardedDrafts: number
  canRestoreDraft: boolean
}

// Thrown transport/host values are untyped by contract; every read below is
// optional-chained exactly like the JavaScript, so any value behaves
// identically and only the type changes.
export interface TransportFailure {
  code?: unknown
  message?: unknown
  details?: unknown
  retryable?: unknown
}

export function asTransportFailure(error: unknown): TransportFailure {
  return (error ?? {}) as TransportFailure
}

export interface SaveFlowOptions {
  saveSource(id: string, source: string, options: { snapshot: string }): Promise<SaveSourceResult>
  acceptDiskVersion(id: string, contentHash: string): void
  mergeExternalChange?: ((id: string, localSource: string) => Promise<MergeOutcome | null | undefined>) | null
  takeSnapshot?: ((id: string, reason: string, source?: string) => Promise<unknown>) | null
  getSource(): string
  getSnapshot?: () => string
  setSource(source: string, meta: EditorAdapterSetMeta): boolean | Promise<boolean>
  getConflictSnapshot?: (details: ConflictDetailsInput) => string
  getConflictBaseline?: (details: ConflictDetailsInput) => unknown
  isValidConflictBaseline?: (value: unknown) => boolean
  saveDelay?: number
  onState?: (state: string, details: SaveFlowStatus) => void
  onConflict?: (conflict: SaveConflict) => void
  onError?: (error: unknown) => void
  materializeEdits?: () => void
  setTimer?: typeof setTimeout
  clearTimer?: typeof clearTimeout
  maxDiscardedDrafts?: number
}

// Last index whose item matches, or -1. The shared tsconfig targets ES2022
// (whose lib lacks Array.findLastIndex), so the scan is explicit; the dense
// drafts array visits identically to the native method.
function findLastIndexWhere<T>(items: ReadonlyArray<T>, predicate: (item: T) => boolean): number {
  for (let index = items.length - 1; index >= 0; index -= 1) {
    const item = items[index]
    if (item !== undefined && predicate(item)) return index
  }
  return -1
}

function isSuspiciousExternalChange(local: unknown, external: unknown): boolean {
  const localText = typeof local === "string" ? local : ""
  const externalText = typeof external === "string" ? external : ""
  if (externalText === "") {
    return localText !== ""
  }
  const localChars = [...localText].length
  if (localChars < SUSPICIOUS_MIN_LOCAL_CHARS) {
    return false
  }
  return [...externalText].length * 2 < localChars
}

export function createSaveFlow({
  saveSource,
  acceptDiskVersion,
  mergeExternalChange = null,
  takeSnapshot = null,
  getSource,
  getSnapshot = getSource,
  setSource,
  getConflictSnapshot = details => typeof details.current?.source === "string" ? details.current.source : getSnapshot(),
  getConflictBaseline = details => details.disk_hash,
  isValidConflictBaseline = value => /^[a-f\d]{64}$/i.test(String(value || "")),
  saveDelay = 650,
  onState = () => {},
  onConflict = () => {},
  onError = () => {},
  materializeEdits = () => {},
  setTimer = setTimeout,
  clearTimer: clearTimerOption = clearTimeout,
  maxDiscardedDrafts = MAX_DISCARDED_DRAFTS
}: SaveFlowOptions) {
  // Nullable handles clear as undefined: every host clearTimeout (and the
  // unit-test fakes) treats both as a no-op, exactly like before.
  const clearTimer = (timer: ReturnType<typeof setTimeout> | null): void => {
    clearTimerOption(timer ?? undefined)
  }
  let activeWork: SaveWork | null = null
  let activeConflict: SaveConflict | null = null
  let dirty = false
  let blocked = false
  let blockedSnapshot: string | null = null
  let paused = false
  let saveWorker: Promise<boolean> | null = null
  let sourceMutation: object | null = null
  let revision = 0
  let saveTimer: ReturnType<typeof setTimeout> | null = null
  let retryTimer: ReturnType<typeof setTimeout> | null = null
  let retryAttempt = 0
  const discardedDrafts: Array<{ id: string; source: string }> = []

  function setStatus(value: string): void {
    onState(value, { dirty: dirty || Boolean(sourceMutation), blocked, conflict: activeConflict, discardedDrafts: discardedDrafts.length, canRestoreDraft: discardedDrafts.some(draft => draft.id === activeWork?.id) })
  }

  function schedule(delay: number = saveDelay): void {
    if (!activeWork || activeConflict) return
    if (!saveWorker && getSnapshot() === activeWork.savedSnapshot) {
      dirty = false
      blocked = false
      blockedSnapshot = null
      setStatus("Saved")
      return
    }
    dirty = true
    if (blocked) {
      setStatus("Save blocked · retry manually")
      return
    }
    setStatus("Unsaved changes")
    if (paused || sourceMutation) return
    clearTimer(saveTimer)
    if (retryTimer) return
    saveTimer = setTimer(() => {
      saveTimer = null
      void flush()
    }, delay)
  }

  function rememberDraft(source: string): void {
    if (!activeWork) return
    discardedDrafts.push({ id: activeWork.id, source })
    while (discardedDrafts.length > Math.max(0, maxDiscardedDrafts)) discardedDrafts.shift()
    setStatus("Saved external version")
  }

  function handleConflict({ id, details = {} }: { id: string; details?: ConflictDetailsInput }): boolean | undefined {
    if (activeWork?.id !== id) return
    const diskSource = typeof details.current?.source === "string" ? details.current.source : ""
    const diskHash = getConflictBaseline(details)
    if (!isValidConflictBaseline(diskHash)) {
      const error = Object.assign(new Error("Elef received an invalid file fingerprint."), {
        code: "invalid_response",
        retryable: false
      })
      onError(error)
      return false
    }
    activeConflict = {
      id,
      diskHash: diskHash as string,
      diskSnapshot: getConflictSnapshot(details),
      diskSource,
      diskSourceFile: details.current?.source_file || activeWork.source_file,
      localSource: getSource(),
      current: details.current,
      message: details.message,
      recovery_revision_id: details.recovery_revision_id
    }
    dirty = true
    clearTimer(saveTimer)
    clearTimer(retryTimer)
    saveTimer = null
    retryTimer = null
    setStatus("Conflict needs review")
    onConflict(activeConflict)
    return true
  }

  async function checkExternalChange(id: string, snapshot: ExternalSnapshot): Promise<string> {
    if (!activeWork || activeWork.id !== id) return "inactive"
    materializeEdits()
    if (sourceMutation) return "busy"
    if (!snapshot || !isValidConflictBaseline(snapshot.content_hash)) {
      const error = Object.assign(new Error("Elef received an invalid file fingerprint."), {
        code: "invalid_response",
        retryable: false
      })
      onError(error)
      return "invalid"
    }
    const sourceFileChanged = typeof snapshot.source_file === "string" && snapshot.source_file !== activeWork.source_file
    if (snapshot.content_hash === activeWork.content_hash && !sourceFileChanged) return "current"
    if (activeConflict?.diskHash === snapshot.content_hash && activeConflict.diskSourceFile === snapshot.source_file) {
      return "conflict"
    }

    if (!activeConflict && snapshot.source === getSource()) {
      revision += 1
      acceptDiskVersion(id, snapshot.content_hash)
      activeWork.content_hash = snapshot.content_hash
      activeWork.source = snapshot.source
      activeWork.source_file = snapshot.source_file || activeWork.source_file
      return sourceFileChanged ? "source-file-changed" : "matching-local"
    }

    if (dirty || getSnapshot() !== activeWork.savedSnapshot || activeConflict) {
      dirty = true
      handleConflict({
        id,
        details: {
          disk_hash: snapshot.content_hash,
          current: { source: snapshot.source, source_file: snapshot.source_file }
        }
      })
      return "conflict"
    }

    clearTimer(saveTimer)
    clearTimer(retryTimer)
    saveTimer = null
    retryTimer = null
    const work = activeWork
    const applied = await applySource(snapshot.source, work)
    if (activeWork !== work) return "inactive"
    if (!applied) {
      handleConflict({ id, details: { disk_hash: snapshot.content_hash, current: snapshot } })
      return "conflict"
    }
    acceptDiskVersion(id, snapshot.content_hash)
    revision += 1
    work.content_hash = snapshot.content_hash
    work.source = snapshot.source
    work.source_file = snapshot.source_file || work.source_file
    work.savedSnapshot = getSnapshot()
    activeConflict = null
    dirty = getSnapshot() !== work.savedSnapshot
    blocked = false
    retryAttempt = 0
    if (dirty) schedule()
    else setStatus("External changes loaded")
    return "reloaded"
  }

  async function resolveExternalChange(id: string, snapshot: ExternalSnapshot): Promise<string> {
    if (!activeWork || activeWork.id !== id) return "inactive"
    materializeEdits()
    if (sourceMutation) return "busy"
    if (!mergeExternalChange || !takeSnapshot) return checkExternalChange(id, snapshot)
    if (!snapshot || !isValidConflictBaseline(snapshot.content_hash)) {
      const error = Object.assign(new Error("Elef received an invalid file fingerprint."), {
        code: "invalid_response",
        retryable: false
      })
      onError(error)
      return "invalid"
    }
    if (snapshot.source === getSource()) {
      return checkExternalChange(id, snapshot)
    }
    // A clean buffer facing changed bytes normally reloads without any
    // merge or snapshot calls. Only a suspicious-looking rewrite diverts
    // through snapshots and the merge consult below, and any outcome other
    // than a clean merge takes the conflict path (P02-07).
    const wasClean = !dirty && getSnapshot() === activeWork.savedSnapshot && !activeConflict
    const localSource = getSource()
    if (wasClean && !isSuspiciousExternalChange(localSource, snapshot.source)) {
      return checkExternalChange(id, snapshot)
    }
    const conflictUnverifiable = (): string => {
      handleConflict({
        id,
        details: {
          disk_hash: snapshot.content_hash,
          current: { source: snapshot.source, source_file: snapshot.source_file }
        }
      })
      return "conflict"
    }
    // A save (or conflict resolution) that lands while the merge awaits
    // leaves this snapshot older than the base. Applying it would clobber
    // the fresh base and flush into a self-inflicted conflict, so every
    // post-await exit below drops the stale merge as superseded; the
    // watcher's later event for the newer bytes re-drives resolution.
    const mergeWork = activeWork
    const baseBeforeMerge = mergeWork ? mergeWork.content_hash : null
    const mergeSuperseded = (): boolean =>
      mergeWork !== null && activeWork === mergeWork && activeWork.content_hash !== baseBeforeMerge
    try {
      await takeSnapshot(id, "pre-merge", localSource)
      await takeSnapshot(id, "external-change")
    } catch (error) {
      onError(error)
      if (mergeSuperseded()) return "superseded"
      if (wasClean) return conflictUnverifiable()
      return checkExternalChange(id, snapshot)
    }
    let outcome: MergeOutcome | null | undefined
    try {
      outcome = await mergeExternalChange(id, localSource)
    } catch (error) {
      onError(error)
      if (mergeSuperseded()) return "superseded"
      if (wasClean) return conflictUnverifiable()
      return checkExternalChange(id, snapshot)
    }
    if (mergeSuperseded()) return "superseded"
    if (!outcome || outcome.kind !== "merged" || typeof outcome.source !== "string") {
      if (wasClean) return conflictUnverifiable()
      return checkExternalChange(id, snapshot)
    }
    if (wasClean) return checkExternalChange(id, snapshot)
    const work = activeWork
    if (!(await applySource(outcome.source, work, { preserveMetadata: true })) || activeWork !== work) {
      if (activeWork?.id === id) return checkExternalChange(id, snapshot)
      return "inactive"
    }
    acceptDiskVersion(id, snapshot.content_hash)
    revision += 1
    work.content_hash = snapshot.content_hash
    work.source = snapshot.source
    work.source_file = snapshot.source_file || work.source_file
    activeConflict = null
    dirty = true
    setStatus("Saving merged changes…")
    await flush({ force: true })
    return "merged"
  }

  async function flush({ force = false }: { force?: boolean } = {}): Promise<boolean> {
    if (sourceMutation) return false
    clearTimer(saveTimer)
    saveTimer = null
    if (!activeWork || activeConflict) return !dirty
    if (saveWorker) return saveWorker
    if (!dirty && getSnapshot() === activeWork.savedSnapshot) return true
    dirty = true
    if (blocked && !force) return false
    if (force) {
      blocked = false
      blockedSnapshot = null
    }
    if (retryTimer) {
      if (!force) return false
      clearTimer(retryTimer)
      retryTimer = null
    }

    saveWorker = (async () => {
      while (activeWork && dirty && !activeConflict && !sourceMutation) {
        const work: SaveWork = activeWork
        const source = getSource()
        const snapshot = getSnapshot()
        setStatus("Saving…")
        try {
          const result = await saveSource(work.id, source, { snapshot })
          if (activeWork !== work) return false
          revision += 1
          work.content_hash = result.content_hash
          work.source = typeof result.source === "string" ? result.source : source
          work.savedSnapshot = typeof result.snapshot === "string" ? result.snapshot : snapshot
          retryAttempt = 0
          blocked = false
          blockedSnapshot = null
          dirty = getSnapshot() !== work.savedSnapshot
          setStatus(dirty ? "Unsaved changes" : "Saved")
        } catch (error) {
          dirty = true
          const failure = asTransportFailure(error)
          if (failure.code === "conflict") {
            if (!activeConflict && !handleConflict({ id: work.id, details: (failure.details ?? {}) as ConflictDetailsInput })) {
              blocked = true
              setStatus("Save blocked · retry manually")
            }
            return false
          }
          onError(error)
          if (failure.retryable !== true) {
            if (getSnapshot() !== snapshot) {
              blocked = false
              blockedSnapshot = null
              continue
            }
            blocked = true
            blockedSnapshot = snapshot
            setStatus("Save failed")
            return false
          }
          setStatus("Save failed")
          const retryDelay = RETRY_DELAYS[Math.min(retryAttempt, RETRY_DELAYS.length - 1)] ?? 30_000
          retryAttempt += 1
          if (!retryTimer && activeWork === work) {
            retryTimer = setTimer(() => {
              retryTimer = null
              void flush({ force: true })
            }, retryDelay)
            setStatus(`Save failed · retrying in ${Math.ceil(retryDelay / 1000)}s`)
          }
          return false
        }
      }
      return !dirty && !activeConflict
    })()

    try {
      return await saveWorker
    } finally {
      saveWorker = null
      if (activeWork && dirty && !activeConflict && !blocked && !retryTimer && !saveTimer) schedule(0)
    }
  }

  function activate(work: SaveWork): void {
    revision += 1
    clearTimer(saveTimer)
    clearTimer(retryTimer)
    saveTimer = null
    retryTimer = null
    activeWork = work
    activeWork.savedSnapshot = getSnapshot()
    activeConflict = null
    dirty = false
    blocked = false
    blockedSnapshot = null
    paused = false
    retryAttempt = 0
    setStatus("Saved")
  }

  function noteChange(delay?: number): void {
    revision += 1
    if (blocked && blockedSnapshot !== null && getSnapshot() !== blockedSnapshot) {
      blocked = false
      blockedSnapshot = null
    }
    schedule(delay)
  }

  function pause(): void {
    paused = true
    clearTimer(saveTimer)
    saveTimer = null
  }

  function resume(): void {
    if (!paused) return
    paused = false
    if (dirty && !activeConflict) schedule(0)
  }

  async function applySource(source: string, work: SaveWork, options: { preserveMetadata?: boolean } = {}): Promise<boolean> {
    if (sourceMutation) return false
    const token = {}
    sourceMutation = token
    try {
      const applied = await setSource(source, { id: work.id, expectedSource: getSource(), ...options })
      return applied !== false && activeWork === work
    } catch (error) {
      onError(error)
      return false
    } finally {
      if (sourceMutation === token) sourceMutation = null
    }
  }

  async function useDiskVersion(): Promise<boolean> {
    if (!activeConflict || !activeWork || sourceMutation) return false
    materializeEdits()
    const conflict = activeConflict
    const work = activeWork
    rememberDraft(getSource())
    if (!(await applySource(conflict.diskSource, work)) || activeConflict !== conflict) return false
    acceptDiskVersion(conflict.id, conflict.diskHash)
    revision += 1
    work.content_hash = conflict.diskHash
    work.source = conflict.diskSource
    work.source_file = conflict.diskSourceFile
    work.savedSnapshot = conflict.diskSnapshot
    activeConflict = null
    dirty = getSnapshot() !== work.savedSnapshot
    if (dirty) schedule()
    else setStatus("Saved")
    return true
  }

  function keepLocalVersion(): boolean {
    if (!activeConflict || !activeWork || sourceMutation) return false
    materializeEdits()
    const conflict = activeConflict
    acceptDiskVersion(conflict.id, conflict.diskHash)
    revision += 1
    activeWork.content_hash = conflict.diskHash
    activeWork.source = conflict.diskSource
    activeWork.source_file = conflict.diskSourceFile
    activeWork.savedSnapshot = conflict.diskSnapshot
    activeConflict = null
    dirty = true
    setStatus("Saving your chosen version…")
    void flush({ force: true })
    return true
  }

  async function saveMergedVersion(mergedSource: string): Promise<boolean> {
    if (!activeConflict || !activeWork || sourceMutation) return false
    materializeEdits()
    const conflict = activeConflict
    const work = activeWork
    if (!(await applySource(mergedSource, work, { preserveMetadata: true })) || activeConflict !== conflict) return false
    acceptDiskVersion(conflict.id, conflict.diskHash)
    revision += 1
    work.content_hash = conflict.diskHash
    work.source = conflict.diskSource
    work.source_file = conflict.diskSourceFile
    work.savedSnapshot = conflict.diskSnapshot
    activeConflict = null
    dirty = getSnapshot() !== work.savedSnapshot
    if (dirty) void flush({ force: true })
    else setStatus("Saved external version")
    return true
  }

  async function restoreDraft(): Promise<boolean> {
    if (!activeWork || sourceMutation || activeConflict) return false
    materializeEdits()
    const work = activeWork
    const index = findLastIndexWhere(discardedDrafts, draft => draft.id === work.id)
    if (index < 0) return false
    const draft = discardedDrafts[index]
    if (!draft) return false
    if (!(await applySource(draft.source, work))) {
      if (activeWork === work && !activeConflict && (dirty || getSource() !== work.source)) schedule(0)
      return false
    }
    discardedDrafts.splice(discardedDrafts.indexOf(draft), 1)
    schedule(0)
    return true
  }

  function deactivate(): void {
    revision += 1
    clearTimer(saveTimer)
    clearTimer(retryTimer)
    saveTimer = null
    retryTimer = null
    activeWork = null
    activeConflict = null
    dirty = false
    blocked = false
    blockedSnapshot = null
    paused = false
    setStatus("Saved")
  }

  return {
    activate,
    deactivate,
    noteChange,
    pause,
    resume,
    flush,
    handleConflict,
    checkExternalChange,
    resolveExternalChange,
    useDiskVersion,
    keepLocalVersion,
    saveMergedVersion,
    restoreDraft,
    get dirty() { return dirty || Boolean(saveWorker) || Boolean(sourceMutation) },
    get saving() { return Boolean(saveWorker) },
    get revision() { return revision },
    get blocked() { return blocked },
    get conflict() { return activeConflict },
    get discardedDraftCount() { return discardedDrafts.length },
    get canRestoreDraft() {
      const work = activeWork
      return Boolean(work && discardedDrafts.some(draft => draft.id === work.id))
    }
  }
}

export type SaveFlow = ReturnType<typeof createSaveFlow>
