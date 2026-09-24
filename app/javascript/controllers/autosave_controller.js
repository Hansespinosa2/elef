import { Controller } from "@hotwired/stimulus"

const DATABASE_NAME = "elef-drafts"
const DATABASE_VERSION = 1
const STORE_NAME = "drafts"

export default class extends Controller {
  static targets = ["field", "status", "retry", "conflict", "conflictMessage", "serverSource"]
  static values = {
    delay: { type: Number, default: 900 },
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
    this.clearSaveTimer()
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
    if (this.hasConflictTarget) this.conflictTarget.hidden = false
    if (this.hasConflictMessageTarget) {
      const recoveryId = payload.recovery_revision_id ? ` Recovery revision ${payload.recovery_revision_id} is available.` : ""
      this.conflictMessageTarget.textContent = `${payload.message || "A newer version is active; your draft was preserved."}${recoveryId}`
    }
    if (this.hasServerSourceTarget) this.serverSourceTarget.textContent = payload.current?.source || ""
  }

  keepLocal() {
    const current = this.conflictPayload?.current
    if (!current) return this.save()

    this.updateRevisionTokens(current)
    this.conflictPayload = null
    this.savedSnapshot = null
    if (this.hasConflictTarget) this.conflictTarget.hidden = true
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
    this.savedSnapshot = null
    this.saveFailed = false
    if (this.hasConflictTarget) this.conflictTarget.hidden = true
    this.element.dispatchEvent(new CustomEvent("autosave:saved", { detail: { snapshot: this.snapshot(), payload: current } }))
    this.setStatus("Saved")
  }

  async save() {
    this.clearSaveTimer()
    if (this.saving || !this.active || !this.saveEnabledValue) return
    const snapshot = this.snapshot()
    this.persistLocalDraft(snapshot)
    this.saving = true
    this.element.dispatchEvent(new CustomEvent("autosave:saving"))
    this.setStatus("Saving…")

    try {
      const response = await fetch(this.element.action, {
        method: "PATCH",
        headers: {
          Accept: "application/json",
          "X-CSRF-Token": document.querySelector('meta[name="csrf-token"]')?.content || ""
        },
        body: new FormData(this.element)
      })
      const payload = await response.json().catch(() => ({}))

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
        this.setStatus("Save failed", "error")
      }
    } finally {
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
    if (this.hasRetryTarget) this.retryTarget.hidden = !(text.startsWith("Save failed") || state === "conflict")
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
    if (!this.localDraftKey) return
    const record = {
      key: this.localDraftKey,
      snapshot,
      values: this.fieldTargets.map(field => field.value),
      updatedAt: Date.now()
    }
    this.writeDraft(record)
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
    const record = await this.readDraft(this.localDraftKey)
    if (!this.active || !record || record.snapshot === this.snapshot()) return

    record.values.forEach((value, index) => {
      const field = this.fieldTargets[index]
      if (!field || field.value === value) return
      field.value = value
      field.dispatchEvent(new Event("input", { bubbles: true }))
    })
    if (!this.active) return
    this.recoveryNotice = true
    this.setStatus("Recovered unsent changes", "recovered")
    this.clearSaveTimer()
    this.scheduleSave(this.delayValue)
  }

  openDatabase() {
    if (!window.indexedDB) return null

    return new Promise((resolve) => {
      const request = window.indexedDB.open(DATABASE_NAME, DATABASE_VERSION)
      request.onupgradeneeded = () => {
        if (!request.result.objectStoreNames.contains(STORE_NAME)) {
          request.result.createObjectStore(STORE_NAME, { keyPath: "key" })
        }
      }
      request.onsuccess = () => resolve(request.result)
      request.onerror = () => resolve(null)
    })
  }

  async readDraft(key) {
    try {
      const database = await this.database
      if (database) {
        return await new Promise((resolve) => {
          const transaction = database.transaction(STORE_NAME, "readonly")
          const request = transaction.objectStore(STORE_NAME).get(key)
          request.onsuccess = () => resolve(request.result || null)
          request.onerror = () => resolve(null)
        })
      }
      return JSON.parse(window.localStorage.getItem(this.storageKey(key)) || "null")
    } catch (_error) {
      return null
    }
  }

  async writeDraft(record) {
    try {
      const database = await this.database
      if (database) {
        const transaction = database.transaction(STORE_NAME, "readwrite")
        transaction.objectStore(STORE_NAME).put(record)
        return
      }
      window.localStorage.setItem(this.storageKey(record.key), JSON.stringify(record))
    } catch (_error) {
      // Private browsing, blocked storage, or a full quota should not disable editing.
    }
  }

  async deleteDraft(key) {
    try {
      const database = await this.database
      if (database) {
        const transaction = database.transaction(STORE_NAME, "readwrite")
        transaction.objectStore(STORE_NAME).delete(key)
        return
      }
      window.localStorage.removeItem(this.storageKey(key))
    } catch (_error) {
      // The server copy remains authoritative if browser cleanup is unavailable.
    }
  }

  storageKey(key) {
    return `elef.draft.${key}`
  }
}
