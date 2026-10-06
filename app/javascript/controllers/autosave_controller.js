import { Controller } from "@hotwired/stimulus"
import { createSaveFlow } from "lib/save_flow"
import { editorFor } from "lib/editor_controller_lookup"
import { applyEditorSource } from "lib/editor_source"
import { waitForEditorController } from "lib/editor_ready"
import { presentConflictDialog } from "lib/conflict_dialog"

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
    this.active = true
    this.pendingSubmit = null
    this.hasSavedSinceConnect = false
    this.conflictPayload = null
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
    this.flowDeckId = this.hasWorkIdValue ? String(this.workIdValue) : this.localDraftKey
    this.flow = this.createSaveFlow()
    this.flow.activate({
      id: this.flowDeckId,
      source: this.currentSource(),
      source_file: "",
      content_hash: this.currentRevisionBaseline()
    })
    this.restoreLocalDraft()
  }

  disconnect() {
    this.active = false
    if (this.hasConflictTarget) {
      this.conflictTarget.removeEventListener("cancel", this.preventConflictDismiss)
      this.conflictTarget.removeEventListener("click", this.resolveConflictClick)
    }
    this.editorReadyCleanup?.()
    this.flow?.deactivate()
    clearTimeout(this.requestTimeout)
    this.requestTimeout = null
    this.requestController?.abort()
  }

  // Let an outstanding PATCH finish before the explicit form submission so
  // an older autosave cannot overwrite the manually saved version.
  submit(event) {
    if (!this.saveEnabledValue) {
      this.clearLocalDraft()
      return
    }
    this.flow?.pause()
    if (!this.flow?.saving) return
    event.preventDefault()
    event.stopImmediatePropagation()
    this.pendingSubmit = event.submitter
    void this.flow.flush({ force: true }).then(saved => {
      if (saved) this.releasePendingSubmit()
    })
  }

  schedule() {
    if (this.synchronizingCanonicalSource) return

    const snapshot = this.snapshot()
    if (this.flow?.conflict) {
      this.setStatus("Resolve the external edit before saving", "conflict")
      this.persistLocalDraft(snapshot)
      return
    }
    if (!this.saveEnabledValue) {
      this.persistLocalDraft(snapshot)
      this.setStatus("Unsaved changes")
      return
    }

    this.persistLocalDraft(snapshot)
    this.flow?.noteChange()
  }

  retry() {
    if (this.flow?.conflict) {
      this.flow.keepLocalVersion()
      return
    }
    return this.flow?.flush({ force: true })
  }

  showConflict(payload) {
    const source = this.element.querySelector('[name$="[source]"]')?.value || ""
    const recoveryId = payload.recovery_revision_id ? ` Recovery revision ${payload.recovery_revision_id} is available.` : ""
    presentConflictDialog(this.hasConflictTarget ? this.conflictTarget : null, {
      message: `${payload.message || "A newer version is active; your draft was preserved."}${recoveryId}`,
      localSource: source,
      diskSource: payload.current?.source || "",
      diskSourceFile: payload.current?.source_file || "",
      mergeSource: source
    })
  }

  keepLocal() {
    return this.flow?.keepLocalVersion() || false
  }

  discardLocal() {
    return this.flow?.useDiskVersion() || false
  }

  saveMergedVersion() {
    if (!this.flow?.conflict || !this.hasMergeSourceTarget) return false
    return this.flow.saveMergedVersion(this.mergeSourceTarget.value)
  }

  closeConflictDialog() {
    if (this.hasConflictTarget && this.conflictTarget.open) this.conflictTarget.close()
  }

  save() {
    return this.flow?.flush({ force: true })
  }

  createSaveFlow() {
    return createSaveFlow({
      saveDelay: this.delayValue,
      saveSource: (_id, source, { snapshot }) => this.saveToRails(source, snapshot),
      acceptDiskVersion: (_id, baseline) => {
        this.updateRevisionTokens(this.conflictPayload?.current || { revision_token: baseline })
      },
      getConflictBaseline: details => details.current?.revision_token ||
        (details.current?.lock_version === undefined ? null : String(details.current.lock_version)),
      isValidConflictBaseline: value => typeof value === "string" && value.length > 0,
      getSource: () => this.currentSource(),
      getSnapshot: () => this.snapshot(),
      getConflictSnapshot: details => this.snapshotForConflict(details.current),
      setSource: (source, options) => this.applyExternalSource(source, options),
      onState: (state, details) => this.handleSaveState(state, details),
      onConflict: conflict => this.handleSaveConflict(conflict),
      onError: error => { this.lastSaveError = error },
      materializeEdits: () => this.materializeEditorEdits()
    })
  }

  currentRevisionBaseline() {
    const token = this.element.querySelector('[name$="[base_revision]"]')?.value
    return token || `initial:${this.flowDeckId}`
  }

  currentSource() {
    const field = this.sourceField()
    return editorFor(field)?.sourceValue ?? field?.value ?? ""
  }

  sourceField() {
    return this.element.querySelector('[name$="[source]"]')
  }

  materializeEditorEdits() {
    const editor = editorFor(this.element.querySelector(".source-field"))
    editor?.projectionController?.()?.flushPendingProjectionEdits?.()
  }

  async saveToRails(source, _snapshot) {
    if (!this.active || !this.saveEnabledValue) {
      throw Object.assign(new Error("This work is no longer available for autosave."), { code: "not_found", retryable: false })
    }

    this.materializeEditorEdits()
    const fieldValues = this.fieldTargets.map(field => field.value)
    const sourceField = this.sourceField()
    const sourceIndex = this.fieldTargets.indexOf(sourceField)
    const currentSource = sourceField ? this.currentSource() : source
    const currentSnapshot = this.snapshot()
    const formData = new FormData(this.element)
    if (sourceField?.name) formData.set(sourceField.name, currentSource)
    const recoveryCopySaved = await this.persistLocalDraft(currentSnapshot)
    if (!this.active) return { content_hash: this.currentRevisionBaseline(), source: currentSource, snapshot: currentSnapshot }
    this.setStatus(recoveryCopySaved ? "Saving…" : "Saving… Browser recovery is unavailable.")

    const requestController = new AbortController()
    this.requestController = requestController
    let timeoutReject
    const timeoutFailure = new Promise((_, reject) => { timeoutReject = reject })
    this.requestTimeout = setTimeout(() => {
      requestController.abort()
      timeoutReject(Object.assign(new Error("Save timed out"), { code: "timeout", retryable: true }))
    }, this.timeoutValue)

    try {
      const request = (async () => {
        const response = await fetch(this.element.action, {
          method: "PATCH",
          headers: {
            Accept: "application/json",
            "X-CSRF-Token": document.querySelector('meta[name="csrf-token"]')?.content || ""
          },
          signal: requestController.signal,
          body: formData
        })
        const payload = await response.json().catch(() => ({}))
        return { response, payload }
      })()
      const { response, payload } = await Promise.race([request, timeoutFailure])

      if (response.status === 409) {
        throw Object.assign(new Error(payload.message || "A newer version is active; your draft was preserved."), {
          code: "conflict", retryable: false, details: payload
        })
      }
      if (!response.ok) {
        throw Object.assign(new Error("Save failed"), {
          code: response.status >= 500 || response.status === 429 ? "server_error" : "invalid_input",
          retryable: response.status >= 500 || response.status === 429
        })
      }

      const contentHash = payload.revision_token ||
        (payload.lock_version === undefined ? this.currentRevisionBaseline() : String(payload.lock_version))
      if (!this.active) return { content_hash: contentHash, source: currentSource, snapshot: currentSnapshot }
      this.updateRevisionTokens(payload)
      this.hasSavedSinceConnect = true
      const savedSource = typeof payload.source === "string" ? payload.source : currentSource
      if (this.currentSource() === currentSource && typeof payload.source === "string") this.synchronizeCanonicalSource(savedSource)
      if (sourceIndex >= 0) fieldValues[sourceIndex] = savedSource
      const savedSnapshot = fieldValues.join("\u001f")
      this.element.dispatchEvent(new CustomEvent("autosave:saved", { detail: { snapshot: savedSnapshot, payload } }))
      return {
        ...payload,
        content_hash: contentHash,
        source: savedSource,
        snapshot: savedSnapshot
      }
    } catch (error) {
      if (error?.code === "timeout") {
        error.message = "Save timed out; your changes remain in the editor."
        if (!recoveryCopySaved) error.message += " Browser recovery is unavailable; keep this page open and copy your changes before leaving."
      } else if (!error?.code && error?.name !== "AbortError") {
        error.code = "network_error"
        error.retryable = true
        error.message = "Network save failed; retrying."
      }
      throw error
    } finally {
      clearTimeout(this.requestTimeout)
      this.requestTimeout = null
      if (this.requestController === requestController) this.requestController = null
    }
  }

  handleSaveState(state, details) {
    const resolvingConflict = Boolean(this.conflictPayload && !details.conflict)
    const status = state === "Save failed" && this.lastSaveError?.message ? this.lastSaveError.message : state
    this.setStatus(status, details.conflict ? "conflict" : details.blocked ? "error" : "")
    if (state === "Saving…" || state.startsWith("Saving…")) {
      this.element.dispatchEvent(new CustomEvent("autosave:saving"))
    }
    if (this.hasRetryTarget) this.retryTarget.hidden = !(details.blocked || details.conflict || state.startsWith("Save failed"))
    if (details.canRestoreDraft && this.hasRestoreTarget) this.restoreTarget.hidden = false
    if (!details.conflict && this.conflictPayload) {
      this.conflictPayload = null
      this.closeConflictDialog()
    }
    if ((this.hasSavedSinceConnect || resolvingConflict) && !details.dirty && state.startsWith("Saved")) this.clearLocalDraft()
    if (this.pendingSubmit && !details.dirty && state.startsWith("Saved")) {
      setTimeout(() => this.releasePendingSubmit(), 0)
    }
  }

  releasePendingSubmit() {
    if (!this.active || !this.pendingSubmit) return
    if (this.flow?.saving) {
      setTimeout(() => this.releasePendingSubmit(), 10)
      return
    }
    if (this.flow?.dirty) return
    const submitter = this.pendingSubmit
    this.pendingSubmit = null
    this.element.requestSubmit(submitter)
  }

  handleSaveConflict(conflict) {
    this.conflictPayload = {
      message: conflict.message,
      current: conflict.current,
      recovery_revision_id: conflict.recovery_revision_id
    }
    this.element.dispatchEvent(new CustomEvent("autosave:conflict", { detail: this.conflictPayload }))
    this.showConflict(this.conflictPayload)
  }

  async applyExternalSource(source, { id, expectedSource, preserveMetadata = false }) {
    const editorHost = this.element.querySelector(".source-field")
    const current = this.conflictPayload?.current
    const applied = await applyEditorSource(source, {
      id,
      expectedSource,
      getDeckId: () => this.flowDeckId,
      getSource: () => this.currentSource(),
      waitForEditor: () => waitForEditorController(editorHost, editorFor),
      materializeEdits: () => this.materializeEditorEdits(),
      setFallback: value => {
        const field = this.sourceField()
        field.value = value
        field.dispatchEvent(new Event("input", { bubbles: true }))
      }
    })
    if (preserveMetadata || !applied || typeof current?.source !== "string" || current.source !== source) return applied

    for (const field of this.fieldTargets) {
      const match = field.name?.match(/\[([^\]]+)\]$/)
      const key = match?.[1]
      if (key && key !== "source" && Object.prototype.hasOwnProperty.call(current, key)) {
        field.value = current[key] == null ? "" : String(current[key])
      }
    }
    return true
  }

  snapshot() {
    return this.fieldTargets.map(field => field.value).join("\u001f")
  }

  snapshotForConflict(current = {}) {
    return this.fieldTargets.map(field => {
      const key = field.name?.match(/\[([^\]]+)\]$/)?.[1]
      return key && Object.prototype.hasOwnProperty.call(current, key)
        ? current[key] == null ? "" : String(current[key])
        : field.value
    }).join("\u001f")
  }

  scheduleSave(delay) {
    if (!this.saveEnabledValue) return
    this.flow?.noteChange(delay)
  }

  setStatus(text, state = "") {
    if (this.hasStatusTarget) {
      this.statusTarget.textContent = text
      this.statusTarget.setAttribute("data-autosave-state", state || (text.startsWith("Save failed") ? "error" : ""))
    }
    if (this.hasRetryTarget) {
      this.retryTarget.hidden = !(text.startsWith("Save failed") || text.startsWith("Save timed out") || state === "conflict" || state === "error")
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
    this.setStatus("Recovered unsent changes", "recovered")
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
