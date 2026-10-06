import { Controller } from "@hotwired/stimulus"

const DATABASE_NAME = "elef-drafts"
const DATABASE_VERSION = 1
const STORE_NAME = "drafts"

export default class extends Controller {
  static targets = ["field", "status", "retry", "conflict", "conflictMessage", "localSource", "serverSource", "mergeSource"]
  static values = {
    delay: { type: Number, default: 900 },
    timeout: { type: Number, default: 15000 },
    workId: String,
    workKind: String,
    workIdentity: String,
    saveEnabled: { type: Boolean, default: true }
  }

  connect() {
    this.timer = null
    this.timerGeneration = 0
    this.saving = false
    this.active = true
    this.pendingSubmit = null
    this.recoveryNotice = false
    this.savedSnapshot = this.snapshot()
    this.saveFailed = false
    this.preventConflictDismiss = (event) => {
      if (this.conflictPayload) event.preventDefault()
    }
    this.resolveConflictClick = (event) => {
      const button = event.target.closest?.("[data-conflict-resolution]")
      if (!button || !this.hasConflictTarget || !this.conflictTarget.contains(button)) return
      if (button.dataset.conflictResolution === "disk") this.discardLocal()
      else if (button.dataset.conflictResolution === "local") this.keepLocal()
      else if (button.dataset.conflictResolution === "merge") this.saveMergedVersion()
    }
    if (this.hasConflictTarget) {
      this.conflictTarget.addEventListener("cancel", this.preventConflictDismiss)
      this.conflictTarget.addEventListener("click", this.resolveConflictClick)
    }
    const workKind = this.hasWorkKindValue ? this.workKindValue : "work"
    this.freshNewWorkNavigation = !this.hasWorkIdValue && window.performance?.getEntriesByType?.("navigation")?.[0]?.type === "navigate"
    this.localDraftKey = this.hasWorkIdValue
      ? `${workKind}:${this.workIdValue}:${this.hasWorkIdentityValue ? this.workIdentityValue : "legacy"}`
      : `${workKind}:new:${window.location.pathname}`
    this.database = this.openDatabase()
    this.restoreLocalDraft()
  }

  disconnect() {
    this.active = false
    if (this.hasConflictTarget) {
      this.conflictTarget.removeEventListener("cancel", this.preventConflictDismiss)
      this.conflictTarget.removeEventListener("click", this.resolveConflictClick)
    }
    this.editorReadyCleanup?.()
    this.clearSaveTimer()
    clearTimeout(this.requestTimeout)
    this.requestTimeout = null
    this.requestController?.abort()
  }

  // Let an outstanding PATCH finish before the explicit form submission so
  // an older autosave cannot overwrite the manually saved version.
  submit(event) {
    this.clearSaveTimer()
    if (!this.saveEnabledValue) {
      this.clearLocalDraft()
      return
    }
    if (!this.saving) return
    event.preventDefault()
    event.stopImmediatePropagation()
    this.pendingSubmit = event.submitter
  }

  schedule() {
    if (this.synchronizingCanonicalSource) return

    this.clearSaveTimer()
    const snapshot = this.snapshot()
    if (this.conflictPayload) {
      this.setStatus("Resolve the external edit before saving", "conflict")
      this.persistLocalDraft(snapshot)
      return
    }
    if (!this.saving && !this.saveFailed && this.savedSnapshot === snapshot) {
      this.setStatus("Saved")
      this.clearLocalDraft()
      return
    }

    this.setStatus("Unsaved changes")
    this.persistLocalDraft(snapshot)
    this.scheduleSave(this.delayValue)
  }

  retry() {
    if (this.conflictPayload) {
      this.keepLocal()
      return
    }
    this.save()
  }

  showConflict(payload) {
    const source = this.element.querySelector('[name$="[source]"]')?.value || ""
    if (this.hasLocalSourceTarget) this.localSourceTarget.textContent = source
    if (this.hasMergeSourceTarget) this.mergeSourceTarget.value = source
    if (this.hasConflictMessageTarget) {
      const recoveryId = payload.recovery_revision_id ? ` Recovery revision ${payload.recovery_revision_id} is available.` : ""
      this.conflictMessageTarget.textContent = `${payload.message || "A newer version is active; your draft was preserved."}${recoveryId}`
    }
    if (this.hasServerSourceTarget) this.serverSourceTarget.textContent = payload.current?.source || ""
    if (this.hasConflictTarget && !this.conflictTarget.open) this.conflictTarget.showModal()
  }

  keepLocal() {
    const current = this.conflictPayload?.current
    if (!current) return this.save()

    this.updateRevisionTokens(current)
    this.conflictPayload = null
    this.savedSnapshot = null
    this.closeConflictDialog()
    this.setStatus("Unsaved changes")
    this.schedule()
  }

  discardLocal() {
    const current = this.conflictPayload?.current
    if (!current) return

    const titleField = this.element.querySelector('[name$="[title]"]')
    const sourceField = this.element.querySelector('[name$="[source]"]')
    if (titleField && current.title !== undefined) titleField.value = current.title
    if (sourceField && current.source !== undefined) {
      sourceField.value = current.source
      sourceField.dispatchEvent(new Event("input", { bubbles: true }))
    }
    this.updateRevisionTokens(current)
    this.clearSaveTimer()
    this.clearLocalDraft()
    this.conflictPayload = null
    this.savedSnapshot = this.snapshot()
    this.saveFailed = false
    this.closeConflictDialog()
    this.element.dispatchEvent(new CustomEvent("autosave:saved", { detail: { snapshot: this.snapshot(), payload: current } }))
    this.setStatus("Saved")
  }

  saveMergedVersion() {
    const current = this.conflictPayload?.current
    const sourceField = this.element.querySelector('[name$="[source]"]')
    if (!current || !sourceField || !this.hasMergeSourceTarget) return

    this.clearSaveTimer()
    this.updateRevisionTokens(current)
    this.conflictPayload = null
    this.savedSnapshot = null
    this.saveFailed = false
    sourceField.value = this.mergeSourceTarget.value
    this.closeConflictDialog()
    sourceField.dispatchEvent(new Event("input", { bubbles: true }))
    this.scheduleSave(0)
    return true
  }

  closeConflictDialog() {
    if (this.hasConflictTarget && this.conflictTarget.open) this.conflictTarget.close()
  }

  async save() {
    this.clearSaveTimer()
    if (this.saving || !this.active || !this.saveEnabledValue) return
    const snapshot = this.snapshot()
    this.saving = true
    this.element.dispatchEvent(new CustomEvent("autosave:saving"))
    const requestController = new AbortController()
    this.requestController = requestController
    let timedOut = false
    let recoveryCopySaved = false

    try {
      // Attempt a recovery copy before PATCH so reloads can recover work if
      // the request stalls. Continue saving if browser storage is unavailable,
      // but make that loss-of-recovery risk visible to the author.
      recoveryCopySaved = await this.persistLocalDraft(snapshot)
      if (!this.active) return
      this.setStatus(recoveryCopySaved ? "Saving…" : "Saving… Browser recovery is unavailable.")

      let timeoutReject
      const timeoutFailure = new Promise((_, reject) => { timeoutReject = reject })
      this.requestTimeout = setTimeout(() => {
        timedOut = true
        requestController.abort()
        const error = new Error("Save timed out")
        error.name = "AutosaveTimeout"
        timeoutReject(error)
      }, this.timeoutValue)

      const request = (async () => {
        const response = await fetch(this.element.action, {
          method: "PATCH",
          headers: {
            Accept: "application/json",
            "X-CSRF-Token": document.querySelector('meta[name="csrf-token"]')?.content || ""
          },
          signal: requestController.signal,
          body: new FormData(this.element)
        })
        const payload = await response.json().catch(() => ({}))
        return { response, payload }
      })()
      const { response, payload } = await Promise.race([request, timeoutFailure])

      if (response.status === 409) {
        if (!this.active) return
        this.clearSaveTimer()
        this.savedSnapshot = null
        this.saveFailed = false
        this.conflictPayload = payload
        this.element.dispatchEvent(new CustomEvent("autosave:conflict", { detail: payload }))
        this.showConflict(payload)
        this.setStatus(payload.message || "A newer version is active; your draft was preserved.", "conflict")
        return
      }
      if (!response.ok) throw new Error("Save failed")

      if (!this.active) return
      this.updateRevisionTokens(payload)
      let savedSnapshot = snapshot
      if (this.snapshot() === snapshot && typeof payload.source === "string") {
        this.synchronizeCanonicalSource(payload.source)
        savedSnapshot = this.snapshot()
      }
      this.savedSnapshot = savedSnapshot
      this.saveFailed = false
      this.element.dispatchEvent(new CustomEvent("autosave:saved", { detail: { snapshot: savedSnapshot, payload } }))
      const currentSnapshot = this.snapshot()
      this.clearSaveTimer()
      this.setStatus(currentSnapshot === savedSnapshot ? "Saved" : "Unsaved changes")
      if (currentSnapshot === savedSnapshot) this.clearLocalDraft()
      // schedule() may have fired while this request was in flight.
      // Persist the newer fields even if that debounce timer already elapsed.
      if (currentSnapshot !== savedSnapshot) {
        this.persistLocalDraft(currentSnapshot)
        this.scheduleSave(0)
      }
    } catch (_error) {
      if (this.active) {
        this.saveFailed = true
        const failure = timedOut ? "Save timed out; your changes remain in the editor." : "Save failed"
        const recoveryWarning = recoveryCopySaved
          ? ""
          : " Browser recovery is unavailable; keep this page open and copy your changes before leaving."
        this.setStatus(`${failure}${recoveryWarning}`, "error")
      }
    } finally {
      clearTimeout(this.requestTimeout)
      this.requestTimeout = null
      if (this.requestController === requestController) this.requestController = null
      this.saving = false
      if (this.active && this.pendingSubmit) {
        const submitter = this.pendingSubmit
        this.pendingSubmit = null
        this.clearSaveTimer()
        this.element.requestSubmit(submitter)
      }
    }
  }

  snapshot() {
    return this.fieldTargets.map(field => field.value).join("\u001f")
  }

  clearSaveTimer() {
    this.timerGeneration += 1
    if (this.timer !== null) clearTimeout(this.timer)
    this.timer = null
  }

  scheduleSave(delay) {
    this.clearSaveTimer()
    const generation = this.timerGeneration
    this.timer = setTimeout(() => {
      if (generation !== this.timerGeneration) return
      this.timer = null
      this.save()
    }, delay)
  }

  setStatus(text, state = "") {
    if (this.hasStatusTarget) {
      this.statusTarget.textContent = text
      this.statusTarget.setAttribute("data-autosave-state", state || (text.startsWith("Save failed") ? "error" : ""))
    }
    if (this.hasRetryTarget) {
      this.retryTarget.hidden = !(text.startsWith("Save failed") || text.startsWith("Save timed out") || state === "conflict")
    }
  }

  updateRevisionTokens(payload) {
    const tokenField = this.element.querySelector('[name$="[base_revision]"]')
    const lockField = this.element.querySelector('[name$="[lock_version]"]')
    if (tokenField && payload.revision_token) tokenField.value = payload.revision_token
    if (lockField && payload.lock_version !== undefined) lockField.value = payload.lock_version
    this.updateReleaseStatus(payload)
  }

  synchronizeCanonicalSource(source) {
    const sourceField = this.element.querySelector('[name$="[source]"]')
    if (!sourceField || sourceField.value === source) return

    this.synchronizingCanonicalSource = true
    try {
      const editor = this.element.querySelector(".source-field")?.editorController
      if (editor?.replaceServerSource) {
        editor.replaceServerSource(source)
      } else {
        sourceField.value = source
        sourceField.dispatchEvent(new Event("input", { bubbles: true }))
      }
    } finally {
      this.synchronizingCanonicalSource = false
    }
  }

  updateReleaseStatus(payload) {
    const status = payload.published_release_status || payload.current?.published_release_status
    const element = this.element.querySelector("[data-release-status]")
    if (!element || !status) return

    element.dataset.releaseStatus = status
    element.textContent = {
      stale: "Published release is stale — republish to present the latest draft.",
      current: "Published release is current.",
      unpublished: ""
    }[status] || ""
  }

  persistLocalDraft(snapshot = this.snapshot()) {
    if (!this.localDraftKey) return false
    const record = {
      key: this.localDraftKey,
      snapshot,
      values: this.fieldTargets.map(field => field.value),
      updatedAt: Date.now()
    }
    return this.writeDraft(record)
  }

  clearLocalDraft() {
    if (!this.localDraftKey) return
    this.deleteDraft(this.localDraftKey)
  }

  async restoreLocalDraft() {
    if (!this.localDraftKey) return
    if (this.freshNewWorkNavigation) {
      this.clearLocalDraft()
      return
    }
    const initialSnapshot = this.snapshot()
    const record = await this.readDraft(this.localDraftKey)
    if (!this.active || !record || typeof record.snapshot !== "string" || !Array.isArray(record.values) || record.snapshot === this.snapshot()) return

    const editorHost = this.element.querySelector(".source-field")
    await this.waitForEditorReady(editorHost)
    if (!this.active || this.snapshot() !== initialSnapshot || record.snapshot === this.snapshot()) return

    const sourceField = this.fieldTargets.find(field => field.name?.endsWith("[source]"))
    const sourceIndex = sourceField ? this.fieldTargets.indexOf(sourceField) : -1
    if (sourceField && typeof record.values[sourceIndex] !== "string") return
    if (sourceField && !editorHost?.editorController && editorHost) {
      editorHost.dataset.editorInitialSourceValue = JSON.stringify(record.values[sourceIndex])
    }

    record.values.forEach((value, index) => {
      const field = this.fieldTargets[index]
      if (typeof value !== "string" || !field || field.value === value) return
      field.value = value
      field.dispatchEvent(new Event("input", { bubbles: true }))
    })
    if (!this.active) return
    this.recoveryNotice = true
    this.setStatus("Recovered unsent changes", "recovered")
    this.clearSaveTimer()
    this.scheduleSave(this.delayValue)
  }

  waitForEditorReady(editorHost) {
    if (!editorHost || editorHost.editorController) return Promise.resolve()

    return new Promise((resolve) => {
      let timeout
      const finish = () => {
        editorHost.removeEventListener("elef:editor-ready", finish)
        clearTimeout(timeout)
        if (this.editorReadyCleanup === finish) this.editorReadyCleanup = null
        resolve()
      }
      this.editorReadyCleanup = finish
      editorHost.addEventListener("elef:editor-ready", finish, { once: true })
      timeout = setTimeout(finish, 5_000)
      if (editorHost.editorController) finish()
    })
  }

  openDatabase() {
    try {
      if (!window.indexedDB) return null

      return new Promise((resolve) => {
        let settled = false
        const resolveOnce = (database) => {
          if (settled) {
            database?.close()
            return
          }
          settled = true
          resolve(database)
        }
        const request = window.indexedDB.open(DATABASE_NAME, DATABASE_VERSION)
        request.onupgradeneeded = () => {
          if (!request.result.objectStoreNames.contains(STORE_NAME)) {
            request.result.createObjectStore(STORE_NAME, { keyPath: "key" })
          }
        }
        request.onsuccess = () => resolveOnce(request.result)
        request.onerror = () => resolveOnce(null)
        request.onblocked = () => resolveOnce(null)
      })
    } catch (_error) {
      return null
    }
  }

  async readDraft(key) {
    let databaseRecord = null
    try {
      const database = await this.database
      if (database) {
        databaseRecord = await new Promise((resolve) => {
          const transaction = database.transaction(STORE_NAME, "readonly")
          const request = transaction.objectStore(STORE_NAME).get(key)
          request.onsuccess = () => resolve(request.result || null)
          request.onerror = () => resolve(null)
        })
      }
    } catch (_error) {
      databaseRecord = null
    }

    let localRecord = null
    try {
      localRecord = JSON.parse(window.localStorage.getItem(this.storageKey(key)) || "null")
    } catch (_error) {
      localRecord = null
    }

    if (!databaseRecord) return localRecord
    if (!localRecord) return databaseRecord
    return Number(localRecord.updatedAt || 0) > Number(databaseRecord.updatedAt || 0)
      ? localRecord
      : databaseRecord
  }

  async writeDraft(record) {
    let database
    try {
      database = await this.database
    } catch (_error) {
      database = null
    }

    if (database) {
      try {
        const committed = await new Promise((resolve) => {
          const transaction = database.transaction(STORE_NAME, "readwrite")
          transaction.oncomplete = () => resolve(true)
          transaction.onabort = transaction.onerror = () => resolve(false)
          transaction.objectStore(STORE_NAME).put(record)
        })
        if (committed) {
          try {
            window.localStorage.removeItem(this.storageKey(record.key))
          } catch (_error) {
            // A newer IndexedDB record wins if an old fallback cannot be removed.
          }
          return true
        }
      } catch (_error) {
        // Fall back to local storage if IndexedDB is blocked or full.
      }
    }

    try {
      window.localStorage.setItem(this.storageKey(record.key), JSON.stringify(record))
      return true
    } catch (_error) {
      // Private browsing, blocked storage, or a full quota should not disable editing.
      return false
    }
  }

  async deleteDraft(key) {
    let deleted = true
    try {
      const database = await this.database
      if (database) {
        const transaction = database.transaction(STORE_NAME, "readwrite")
        const completed = new Promise((resolve) => {
          transaction.oncomplete = () => resolve(true)
          transaction.onabort = transaction.onerror = () => resolve(false)
        })
        transaction.objectStore(STORE_NAME).delete(key)
        deleted = await completed
      }
    } catch (_error) {
      deleted = false
    }

    try {
      window.localStorage.removeItem(this.storageKey(key))
    } catch (_error) {
      deleted = false
    }

    return deleted
  }

  storageKey(key) {
    return `elef.draft.${key}`
  }
}
