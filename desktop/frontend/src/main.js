import { invoke } from "@tauri-apps/api/core"
import { listen } from "@tauri-apps/api/event"
import { getCurrentWindow } from "@tauri-apps/api/window"
import { editorFor } from "controllers/editor_controller"
import { createDeckCard } from "./deck-card.js"
import { createTransportAdapter } from "./transport-adapter.js"
import "./editor-runtime.js"
import "./editor.css"

const elements = {
  libraryName: document.querySelector("#library-name"),
  welcome: document.querySelector("#welcome-view"),
  library: document.querySelector("#library-view"),
  deckView: document.querySelector("#deck-view"),
  list: document.querySelector("#deck-list"),
  count: document.querySelector("#deck-count"),
  empty: document.querySelector("#empty-library"),
  search: document.querySelector("#deck-search"),
  status: document.querySelector("#status-text"),
  notice: document.querySelector("#notice"),
  createDialog: document.querySelector("#create-dialog"),
  createForm: document.querySelector("#create-form"),
  aboutDialog: document.querySelector("#about-dialog"),
  conflictDialog: document.querySelector("#conflict-dialog"),
  editorField: document.querySelector("#desktop-editor-field"),
  editorInput: document.querySelector("#deck-source"),
  saveState: document.querySelector("#save-state"),
  conflictLocal: document.querySelector("#conflict-local"),
  conflictDisk: document.querySelector("#conflict-disk"),
  conflictMerge: document.querySelector("#conflict-merge"),
  restoreDraft: document.querySelector("#restore-local-draft")
}

let library = null
let decks = []
let activeDeck = null
let activeConflict = null
let saveTimer = null
let saveWorker = null
let dirty = false
const discardedDrafts = []

const transport = createTransportAdapter({ invoke, onConflict: showConflict })

function setStatus(message) {
  elements.status.textContent = message
}

function showNotice(message, tone = "info") {
  elements.notice.textContent = message
  elements.notice.dataset.tone = tone
  elements.notice.hidden = false
}

function clearNotice() {
  elements.notice.hidden = true
  elements.notice.textContent = ""
}

function showError(error) {
  const message = typeof error?.message === "string" ? error.message : "The operation could not be completed."
  setStatus(message)
  showNotice(message, "error")
}

function showLibrary() {
  elements.welcome.hidden = Boolean(library)
  elements.library.hidden = !library
  elements.deckView.hidden = true
  elements.libraryName.textContent = library ? library.root.split(/[\\/]/).filter(Boolean).at(-1) || library.root : "No library selected"
  document.querySelector("#new-deck").disabled = !library
  document.querySelector("#breadcrumb-current").textContent = "Decks"
}

function renderDecks() {
  const query = elements.search.value.trim().toLocaleLowerCase()
  const filtered = decks.filter(deck => deck.name.toLocaleLowerCase().includes(query))
  elements.list.replaceChildren(...filtered.map(deck => createDeckCard(document, deck, {
    open: id => void openDeck(id),
    rename: item => void renameDeck(item),
    delete: item => void deleteDeck(item)
  })))
  elements.count.textContent = `${decks.length} ${decks.length === 1 ? "deck" : "decks"}${query ? ` · ${filtered.length} shown` : ""}`
  elements.empty.hidden = decks.length !== 0
  elements.list.hidden = filtered.length === 0
  if (decks.length && filtered.length === 0) {
    const noResults = document.createElement("p")
    noResults.className = "no-results"
    noResults.textContent = "No decks match this search."
    elements.list.append(noResults)
    elements.list.hidden = false
  }
}

async function refreshLibrary() {
  if (!library) return
  try {
    decks = await invoke("list_decks")
    renderDecks()
    setStatus(`${decks.length} ${decks.length === 1 ? "deck" : "decks"}`)
    clearNotice()
  } catch (error) {
    showError(error)
  }
}

async function chooseLibrary() {
  clearNotice()
  setStatus("Choose a folder for your library…")
  try {
    const selected = await invoke("choose_library_root")
    if (!selected) {
      setStatus("Library selection cancelled")
      return
    }
    library = selected
    decks = selected.decks
    showLibrary()
    renderDecks()
    setStatus(`${decks.length} ${decks.length === 1 ? "deck" : "decks"}`)
  } catch (error) {
    showError(error)
  }
}

function showCreateDialog(kind = "presentation") {
  document.querySelector("#new-deck-kind").value = kind
  elements.createDialog.showModal()
  document.querySelector("#new-deck-name").focus()
}

async function createDeck(event) {
  event.preventDefault()
  const form = new FormData(elements.createForm)
  const name = String(form.get("name") || "").trim()
  const kind = String(form.get("kind") || "presentation")
  if (!name) return
  elements.createDialog.close()
  try {
    const opened = await invoke("create_deck", { name, kind })
    await refreshLibrary()
    await openDeck(opened.id)
  } catch (error) {
    showError(error)
  }
}

async function openDeck(id) {
  try {
    if (activeDeck && activeDeck.id !== id && dirty && !(await flushSave())) return
    const deck = await transport.openDeck(id)
    activeDeck = deck
    dirty = false
    document.querySelector("#deck-title").textContent = deck.name
    document.querySelector("#deck-kind").textContent = deck.source_file === "document.md" ? "DOCUMENT" : "PRESENTATION"
    document.querySelector("#deck-source-name").textContent = deck.source_file
    elements.editorField.dataset.editorInitialSourceValue = JSON.stringify(deck.source)
    await setEditorSource(deck.source)
    elements.editorInput.disabled = false
    setSaveState("Saved")
    document.querySelector("#deck-id").textContent = deck.id
    const notice = document.querySelector("#deck-notice")
    notice.textContent = deck.notices.join(" ")
    notice.hidden = deck.notices.length === 0
    elements.library.hidden = true
    elements.deckView.hidden = false
    document.querySelector("#breadcrumb-current").textContent = deck.name
    setStatus("Deck opened")
  } catch (error) {
    showError(error)
  }
}

async function renameDeck(deck) {
  const name = window.prompt("Rename deck", deck.name)
  if (name === null || name.trim() === deck.name) return
  try {
    await invoke("rename_deck", { id: deck.id, name: name.trim() })
    await refreshLibrary()
  } catch (error) {
    showError(error)
  }
}

async function deleteDeck(deck) {
  try {
    const result = await invoke("delete_deck", { id: deck.id })
    if (result.deleted) {
      await refreshLibrary()
      setStatus(`Moved “${deck.name}” to Trash`)
    }
  } catch (error) {
    showError(error)
  }
}

function setSaveState(state) {
  elements.saveState.textContent = state
  elements.saveState.dataset.state = state.toLowerCase().replaceAll(" ", "-")
}

function scheduleSave(delay = 650) {
  if (!activeDeck || activeConflict) return
  dirty = currentSource() !== activeDeck.source
  if (!dirty) {
    setSaveState("Saved")
    return
  }
  setSaveState("Unsaved changes")
  clearTimeout(saveTimer)
  saveTimer = setTimeout(() => void flushSave(), delay)
}

async function flushSave() {
  clearTimeout(saveTimer)
  if (!activeDeck || activeConflict) return !dirty
  if (saveWorker) return saveWorker
  if (!dirty) return true

  saveWorker = (async () => {
    while (activeDeck && dirty && !activeConflict) {
      const deckId = activeDeck.id
      const source = currentSource()
      setSaveState("Saving…")
      try {
        const result = await transport.saveSource(deckId, source)
        if (activeDeck?.id !== deckId) return false
        activeDeck.content_hash = result.content_hash
        activeDeck.source = source
        dirty = currentSource() !== source
        setSaveState(dirty ? "Unsaved changes" : "Saved")
      } catch (error) {
        dirty = true
        if (error?.code === "conflict") {
          setSaveState("Conflict needs review")
        } else {
          setSaveState("Save failed")
          showError(error)
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
  }
}

function showConflict({ id, details }) {
  if (activeDeck?.id !== id) return
  const current = details.current || {}
  activeConflict = {
    id,
    diskHash: details.disk_hash,
    diskSource: typeof current.source === "string" ? current.source : ""
  }
  elements.conflictLocal.textContent = currentSource()
  elements.conflictDisk.textContent = activeConflict.diskSource
  elements.conflictMerge.value = currentSource()
  if (!elements.conflictDialog.open) elements.conflictDialog.showModal()
}

function currentSource() {
  return editorFor(elements.editorField)?.sourceValue ?? elements.editorInput.value
}

async function setEditorSource(source) {
  let controller = editorFor(elements.editorField)
  if (!controller) {
    await new Promise(resolve => elements.editorField.addEventListener("elef:editor-ready", resolve, { once: true }))
    controller = editorFor(elements.editorField)
  }
  if (controller) controller.setExternalValue(source)
  else elements.editorInput.value = source
}

async function resolveConflictWithDisk() {
  if (!activeConflict || !activeDeck) return
  discardedDrafts.push(currentSource())
  elements.restoreDraft.hidden = false
  transport.acceptDiskVersion(activeConflict.id, activeConflict.diskHash)
  activeDeck.content_hash = activeConflict.diskHash
  activeDeck.source = activeConflict.diskSource
  await setEditorSource(activeConflict.diskSource)
  activeConflict = null
  dirty = false
  elements.conflictDialog.close()
  setSaveState("Saved external version")
}

function resolveConflictWithLocal() {
  if (!activeConflict || !activeDeck) return
  transport.acceptDiskVersion(activeConflict.id, activeConflict.diskHash)
  activeDeck.content_hash = activeConflict.diskHash
  activeDeck.source = activeConflict.diskSource
  activeConflict = null
  elements.conflictDialog.close()
  dirty = true
  setSaveState("Saving your chosen version…")
  void flushSave()
}

async function resolveConflictWithMerge() {
  if (!activeConflict || !activeDeck) return
  const mergedSource = elements.conflictMerge.value
  transport.acceptDiskVersion(activeConflict.id, activeConflict.diskHash)
  activeDeck.content_hash = activeConflict.diskHash
  activeDeck.source = activeConflict.diskSource
  await setEditorSource(mergedSource)
  activeConflict = null
  elements.conflictDialog.close()
  dirty = mergedSource !== activeDeck.source
  if (dirty) void flushSave()
  else setSaveState("Saved external version")
}

async function handleMenuAction(action) {
  if (action === "choose-library") return chooseLibrary()
  if (action === "new-presentation") return showCreateDialog("presentation")
  if (action === "new-document") return showCreateDialog("document")
  if (action === "about") return elements.aboutDialog.showModal()
  if (action === "start-presentation") showNotice("Presentation mode is planned for a later milestone.")
}

document.querySelector("#choose-library").addEventListener("click", () => void chooseLibrary())
document.querySelector("#change-library").addEventListener("click", () => void chooseLibrary())
document.querySelector("#new-deck").addEventListener("click", () => showCreateDialog())
document.querySelector("#refresh-library").addEventListener("click", () => void refreshLibrary())
document.querySelector("#back-to-library").addEventListener("click", () => {
  if (dirty) {
    void flushSave().then(saved => {
      if (!saved) return
      showLibrary()
      setStatus("Library")
    })
    return
  }
  showLibrary()
  setStatus("Library")
})
document.querySelector("#create-form").addEventListener("submit", event => {
  if (event.submitter?.value === "create") void createDeck(event)
})
document.querySelector("#deck-search").addEventListener("input", renderDecks)
document.querySelector("#empty-library [data-action='create-presentation']").addEventListener("click", () => showCreateDialog("presentation"))
elements.editorField.addEventListener("input", () => scheduleSave())
document.querySelector("#use-disk-version").addEventListener("click", resolveConflictWithDisk)
document.querySelector("#keep-local-version").addEventListener("click", resolveConflictWithLocal)
document.querySelector("#save-merged-version").addEventListener("click", resolveConflictWithMerge)
elements.restoreDraft.addEventListener("click", () => {
  const draft = discardedDrafts.pop()
  if (draft === undefined) return
  void setEditorSource(draft)
  elements.restoreDraft.hidden = discardedDrafts.length === 0
  scheduleSave(0)
})
window.addEventListener("beforeunload", event => {
  if (!dirty) return
  event.preventDefault()
  event.returnValue = ""
})
void getCurrentWindow().onCloseRequested(event => {
  if (!dirty) return
  event.preventDefault()
  void flushSave().then(saved => {
    if (saved) void getCurrentWindow().close()
  })
})
window.addEventListener("keydown", event => {
  if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
    event.preventDefault()
    elements.search.focus()
  }
})

void listen("desktop-menu-action", event => void handleMenuAction(event.payload))
void invoke("get_library_status").then(status => {
  library = status
  decks = status?.decks || []
  showLibrary()
  if (library) renderDecks()
  setStatus(library ? `${decks.length} ${decks.length === 1 ? "deck" : "decks"}` : "Choose a library folder to begin")
}).catch(showError)
