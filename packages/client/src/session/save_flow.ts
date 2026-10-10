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

export interface SaveDeck {
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
  let activeDeck: SaveDeck | null = null
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
    onState(value, { dirty: dirty || Boolean(sourceMutation), blocked, conflict: activeConflict, discardedDrafts: discardedDrafts.length, canRestoreDraft: discardedDrafts.some(draft => draft.id === activeDeck?.id) })
  }

  function schedule(delay: number = saveDelay): void {
    if (!activeDeck || activeConflict) return
    if (!saveWorker && getSnapshot() === activeDeck.savedSnapshot) {
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
    if (!activeDeck) return
    discardedDrafts.push({ id: activeDeck.id, source })
    while (discardedDrafts.length > Math.max(0, maxDiscardedDrafts)) discardedDrafts.shift()
    setStatus("Saved external version")
  }

  function handleConflict({ id, details = {} }: { id: string; details?: ConflictDetailsInput }): boolean | undefined {
    if (activeDeck?.id !== id) return
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
      diskSourceFile: details.current?.source_file || activeDeck.source_file,
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
    if (!activeDeck || activeDeck.id !== id) return "inactive"
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
    const sourceFileChanged = typeof snapshot.source_file === "string" && snapshot.source_file !== activeDeck.source_file
    if (snapshot.content_hash === activeDeck.content_hash && !sourceFileChanged) return "current"
    if (activeConflict?.diskHash === snapshot.content_hash && activeConflict.diskSourceFile === snapshot.source_file) {
      return "conflict"
    }

    if (!activeConflict && snapshot.source === getSource()) {
      revision += 1
      acceptDiskVersion(id, snapshot.content_hash)
      activeDeck.content_hash = snapshot.content_hash
      activeDeck.source = snapshot.source
      activeDeck.source_file = snapshot.source_file || activeDeck.source_file
      return sourceFileChanged ? "source-file-changed" : "matching-local"
    }

    if (dirty || getSnapshot() !== activeDeck.savedSnapshot || activeConflict) {
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
    const deck = activeDeck
    const applied = await applySource(snapshot.source, deck)
    if (activeDeck !== deck) return "inactive"
    if (!applied) {
      handleConflict({ id, details: { disk_hash: snapshot.content_hash, current: snapshot } })
      return "conflict"
    }
    acceptDiskVersion(id, snapshot.content_hash)
    revision += 1
    deck.content_hash = snapshot.content_hash
    deck.source = snapshot.source
    deck.source_file = snapshot.source_file || deck.source_file
    deck.savedSnapshot = getSnapshot()
    activeConflict = null
    dirty = getSnapshot() !== deck.savedSnapshot
    blocked = false
    retryAttempt = 0
    if (dirty) schedule()
    else setStatus("External changes loaded")
    return "reloaded"
  }

  async function resolveExternalChange(id: string, snapshot: ExternalSnapshot): Promise<string> {
    if (!activeDeck || activeDeck.id !== id) return "inactive"
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
    const wasClean = !dirty && getSnapshot() === activeDeck.savedSnapshot && !activeConflict
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
    try {
      await takeSnapshot(id, "pre-merge", localSource)
      await takeSnapshot(id, "external-change")
    } catch (error) {
      onError(error)
      if (wasClean) return conflictUnverifiable()
      return checkExternalChange(id, snapshot)
    }
    let outcome: MergeOutcome | null | undefined
    try {
      outcome = await mergeExternalChange(id, localSource)
    } catch (error) {
      onError(error)
      if (wasClean) return conflictUnverifiable()
      return checkExternalChange(id, snapshot)
    }
    if (!outcome || outcome.kind !== "merged" || typeof outcome.source !== "string") {
      if (wasClean) return conflictUnverifiable()
      return checkExternalChange(id, snapshot)
    }
    if (wasClean) return checkExternalChange(id, snapshot)
    const deck = activeDeck
    if (!(await applySource(outcome.source, deck, { preserveMetadata: true })) || activeDeck !== deck) {
      if (activeDeck?.id === id) return checkExternalChange(id, snapshot)
      return "inactive"
    }
    acceptDiskVersion(id, snapshot.content_hash)
    revision += 1
    deck.content_hash = snapshot.content_hash
    deck.source = snapshot.source
    deck.source_file = snapshot.source_file || deck.source_file
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
    if (!activeDeck || activeConflict) return !dirty
    if (saveWorker) return saveWorker
    if (!dirty && getSnapshot() === activeDeck.savedSnapshot) return true
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
      while (activeDeck && dirty && !activeConflict && !sourceMutation) {
        const deck: SaveDeck = activeDeck
        const source = getSource()
        const snapshot = getSnapshot()
        setStatus("Saving…")
        try {
          const result = await saveSource(deck.id, source, { snapshot })
          if (activeDeck !== deck) return false
          revision += 1
          deck.content_hash = result.content_hash
          deck.source = typeof result.source === "string" ? result.source : source
          deck.savedSnapshot = typeof result.snapshot === "string" ? result.snapshot : snapshot
          retryAttempt = 0
          blocked = false
          blockedSnapshot = null
          dirty = getSnapshot() !== deck.savedSnapshot
          setStatus(dirty ? "Unsaved changes" : "Saved")
        } catch (error) {
          dirty = true
          const failure = asTransportFailure(error)
          if (failure.code === "conflict") {
            if (!activeConflict && !handleConflict({ id: deck.id, details: (failure.details ?? {}) as ConflictDetailsInput })) {
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
          if (!retryTimer && activeDeck === deck) {
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
      if (activeDeck && dirty && !activeConflict && !blocked && !retryTimer && !saveTimer) schedule(0)
    }
  }

  function activate(deck: SaveDeck): void {
    revision += 1
    clearTimer(saveTimer)
    clearTimer(retryTimer)
    saveTimer = null
    retryTimer = null
    activeDeck = deck
    activeDeck.savedSnapshot = getSnapshot()
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

  async function applySource(source: string, deck: SaveDeck, options: { preserveMetadata?: boolean } = {}): Promise<boolean> {
    if (sourceMutation) return false
    const token = {}
    sourceMutation = token
    try {
      const applied = await setSource(source, { id: deck.id, expectedSource: getSource(), ...options })
      return applied !== false && activeDeck === deck
    } catch (error) {
      onError(error)
      return false
    } finally {
      if (sourceMutation === token) sourceMutation = null
    }
  }

  async function useDiskVersion(): Promise<boolean> {
    if (!activeConflict || !activeDeck || sourceMutation) return false
    materializeEdits()
    const conflict = activeConflict
    const deck = activeDeck
    rememberDraft(getSource())
    if (!(await applySource(conflict.diskSource, deck)) || activeConflict !== conflict) return false
    acceptDiskVersion(conflict.id, conflict.diskHash)
    revision += 1
    deck.content_hash = conflict.diskHash
    deck.source = conflict.diskSource
    deck.source_file = conflict.diskSourceFile
    deck.savedSnapshot = conflict.diskSnapshot
    activeConflict = null
    dirty = getSnapshot() !== deck.savedSnapshot
    if (dirty) schedule()
    else setStatus("Saved")
    return true
  }

  function keepLocalVersion(): boolean {
    if (!activeConflict || !activeDeck || sourceMutation) return false
    materializeEdits()
    const conflict = activeConflict
    acceptDiskVersion(conflict.id, conflict.diskHash)
    revision += 1
    activeDeck.content_hash = conflict.diskHash
    activeDeck.source = conflict.diskSource
    activeDeck.source_file = conflict.diskSourceFile
    activeDeck.savedSnapshot = conflict.diskSnapshot
    activeConflict = null
    dirty = true
    setStatus("Saving your chosen version…")
    void flush({ force: true })
    return true
  }

  async function saveMergedVersion(mergedSource: string): Promise<boolean> {
    if (!activeConflict || !activeDeck || sourceMutation) return false
    materializeEdits()
    const conflict = activeConflict
    const deck = activeDeck
    if (!(await applySource(mergedSource, deck, { preserveMetadata: true })) || activeConflict !== conflict) return false
    acceptDiskVersion(conflict.id, conflict.diskHash)
    revision += 1
    deck.content_hash = conflict.diskHash
    deck.source = conflict.diskSource
    deck.source_file = conflict.diskSourceFile
    deck.savedSnapshot = conflict.diskSnapshot
    activeConflict = null
    dirty = getSnapshot() !== deck.savedSnapshot
    if (dirty) void flush({ force: true })
    else setStatus("Saved external version")
    return true
  }

  async function restoreDraft(): Promise<boolean> {
    if (!activeDeck || sourceMutation || activeConflict) return false
    materializeEdits()
    const deck = activeDeck
    const index = findLastIndexWhere(discardedDrafts, draft => draft.id === deck.id)
    if (index < 0) return false
    const draft = discardedDrafts[index]
    if (!draft) return false
    if (!(await applySource(draft.source, deck))) {
      if (activeDeck === deck && !activeConflict && (dirty || getSource() !== deck.source)) schedule(0)
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
    activeDeck = null
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
      const deck = activeDeck
      return Boolean(deck && discardedDrafts.some(draft => draft.id === deck.id))
    }
  }
}

export type SaveFlow = ReturnType<typeof createSaveFlow>
