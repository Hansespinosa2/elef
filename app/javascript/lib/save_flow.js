const MAX_DISCARDED_DRAFTS = 10
const RETRY_DELAYS = [1_000, 3_000, 10_000, 30_000]

export function createSaveFlow({
  saveSource,
  acceptDiskVersion,
  getSource,
  setSource,
  onState = () => {},
  onConflict = () => {},
  onError = () => {},
  materializeEdits = () => {},
  setTimer = setTimeout,
  clearTimer = clearTimeout,
  maxDiscardedDrafts = MAX_DISCARDED_DRAFTS
}) {
  let activeDeck = null
  let activeConflict = null
  let dirty = false
  let blocked = false
  let paused = false
  let saveWorker = null
  let sourceMutation = null
  let revision = 0
  let saveTimer = null
  let retryTimer = null
  let retryAttempt = 0
  const discardedDrafts = []

  function setStatus(value) {
    onState(value, { dirty: dirty || Boolean(sourceMutation), blocked, conflict: activeConflict, discardedDrafts: discardedDrafts.length, canRestoreDraft: discardedDrafts.some(draft => draft.id === activeDeck?.id) })
  }

  function schedule(delay = 650) {
    if (!activeDeck || activeConflict) return
    if (!saveWorker && getSource() === activeDeck.source) {
      dirty = false
      blocked = false
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

  function rememberDraft(source) {
    discardedDrafts.push({ id: activeDeck.id, source })
    while (discardedDrafts.length > Math.max(0, maxDiscardedDrafts)) discardedDrafts.shift()
    setStatus("Saved external version")
  }

  function handleConflict({ id, details = {} }) {
    if (activeDeck?.id !== id) return
    const diskSource = typeof details.current?.source === "string" ? details.current.source : ""
    const diskHash = details.disk_hash
    if (!/^[a-f\d]{64}$/i.test(diskHash || "")) {
      const error = Object.assign(new Error("Elef received an invalid file fingerprint."), {
        code: "invalid_response",
        retryable: false
      })
      onError(error)
      return
    }
    activeConflict = {
      id,
      diskHash,
      diskSource,
      diskSourceFile: details.current?.source_file || activeDeck.source_file,
      localSource: getSource()
    }
    dirty = true
    clearTimer(saveTimer)
    clearTimer(retryTimer)
    saveTimer = null
    retryTimer = null
    setStatus("Conflict needs review")
    onConflict(activeConflict)
  }

  async function checkExternalChange(id, snapshot) {
    if (!activeDeck || activeDeck.id !== id) return "inactive"
    materializeEdits()
    if (sourceMutation) return "busy"
    if (!snapshot || !/^[a-f\d]{64}$/i.test(snapshot.content_hash || "")) {
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

    if (dirty || getSource() !== activeDeck.source || activeConflict) {
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
    activeConflict = null
    dirty = getSource() !== snapshot.source
    blocked = false
    retryAttempt = 0
    if (dirty) schedule()
    else setStatus("External changes loaded")
    return "reloaded"
  }

  async function flush({ force = false } = {}) {
    if (sourceMutation) return false
    clearTimer(saveTimer)
    saveTimer = null
    if (!activeDeck || activeConflict) return !dirty
    if (saveWorker) return saveWorker
    if (!dirty && getSource() === activeDeck.source) return true
    dirty = true
    if (blocked && !force) return false
    if (force) blocked = false
    if (retryTimer) {
      if (!force) return false
      clearTimer(retryTimer)
      retryTimer = null
    }

    saveWorker = (async () => {
      while (activeDeck && dirty && !activeConflict && !sourceMutation) {
        const deck = activeDeck
        const source = getSource()
        setStatus("Saving…")
        try {
          const result = await saveSource(deck.id, source)
          if (activeDeck !== deck) return false
          revision += 1
          deck.content_hash = result.content_hash
          deck.source = source
          retryAttempt = 0
          dirty = getSource() !== source
          setStatus(dirty ? "Unsaved changes" : "Saved")
        } catch (error) {
          dirty = true
          if (error?.code === "conflict") {
            if (!activeConflict) handleConflict({ id: deck.id, details: error.details })
            return false
          }
          setStatus("Save failed")
          onError(error)
          if (error?.retryable !== true) {
            blocked = true
            setStatus("Save blocked · retry manually")
            return false
          }
          const retryDelay = RETRY_DELAYS[Math.min(retryAttempt, RETRY_DELAYS.length - 1)]
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
      if (activeDeck && dirty && !activeConflict && !retryTimer && !saveTimer) schedule(0)
    }
  }

  function activate(deck) {
    revision += 1
    clearTimer(saveTimer)
    clearTimer(retryTimer)
    saveTimer = null
    retryTimer = null
    activeDeck = deck
    activeConflict = null
    dirty = false
    blocked = false
    paused = false
    retryAttempt = 0
    setStatus("Saved")
  }

  function noteChange() {
    revision += 1
    schedule()
  }

  function pause() {
    paused = true
    clearTimer(saveTimer)
    saveTimer = null
  }

  function resume() {
    if (!paused) return
    paused = false
    if (dirty && !activeConflict) schedule(0)
  }

  async function applySource(source, deck) {
    if (sourceMutation) return false
    const token = {}
    sourceMutation = token
    try {
      const applied = await setSource(source, { id: deck.id, expectedSource: getSource() })
      return applied !== false && activeDeck === deck
    } catch (error) {
      onError(error)
      return false
    } finally {
      if (sourceMutation === token) sourceMutation = null
    }
  }

  async function useDiskVersion() {
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
    activeConflict = null
    dirty = getSource() !== conflict.diskSource
    if (dirty) schedule()
    else setStatus("Saved external version")
    return true
  }

  function keepLocalVersion() {
    if (!activeConflict || !activeDeck || sourceMutation) return false
    materializeEdits()
    const conflict = activeConflict
    acceptDiskVersion(conflict.id, conflict.diskHash)
    revision += 1
    activeDeck.content_hash = conflict.diskHash
    activeDeck.source = conflict.diskSource
    activeDeck.source_file = conflict.diskSourceFile
    activeConflict = null
    dirty = true
    setStatus("Saving your chosen version…")
    void flush({ force: true })
    return true
  }

  async function saveMergedVersion(mergedSource) {
    if (!activeConflict || !activeDeck || sourceMutation) return false
    materializeEdits()
    const conflict = activeConflict
    const deck = activeDeck
    if (!(await applySource(mergedSource, deck)) || activeConflict !== conflict) return false
    acceptDiskVersion(conflict.id, conflict.diskHash)
    revision += 1
    deck.content_hash = conflict.diskHash
    deck.source = conflict.diskSource
    deck.source_file = conflict.diskSourceFile
    activeConflict = null
    dirty = getSource() !== deck.source
    if (dirty) void flush({ force: true })
    else setStatus("Saved external version")
    return true
  }

  async function restoreDraft() {
    if (!activeDeck || sourceMutation || activeConflict) return false
    materializeEdits()
    const deck = activeDeck
    const index = discardedDrafts.findLastIndex(draft => draft.id === activeDeck.id)
    if (index < 0) return false
    const draft = discardedDrafts[index]
    if (!(await applySource(draft.source, deck))) {
      if (activeDeck === deck && !activeConflict && (dirty || getSource() !== deck.source)) schedule(0)
      return false
    }
    discardedDrafts.splice(discardedDrafts.indexOf(draft), 1)
    schedule(0)
    return true
  }

  function deactivate() {
    revision += 1
    clearTimer(saveTimer)
    clearTimer(retryTimer)
    saveTimer = null
    retryTimer = null
    activeDeck = null
    activeConflict = null
    dirty = false
    blocked = false
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
    useDiskVersion,
    keepLocalVersion,
    saveMergedVersion,
    restoreDraft,
    get dirty() { return dirty || Boolean(saveWorker) || Boolean(sourceMutation) },
    get revision() { return revision },
    get blocked() { return blocked },
    get conflict() { return activeConflict },
    get discardedDraftCount() { return discardedDrafts.length },
    get canRestoreDraft() { return Boolean(activeDeck && discardedDrafts.some(draft => draft.id === activeDeck.id)) }
  }
}
