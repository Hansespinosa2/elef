import assert from "node:assert/strict"
import { readFile } from "node:fs/promises"
import path from "node:path"
import { fileURLToPath } from "node:url"
import test from "node:test"

import { createTitleSaveFlow } from "@elef/client"
import { followHeadingTitleAfterSave } from "@elef/editor-runtime/follow-heading-title"

// Mirror of the shell surfaces sessionTransport.saveSource wires into
// followHeadingTitleAfterSave: the folder list, the open work, and the
// three DOM setters (editor title, breadcrumb, title input).
function harness({ activeName = "Untitled document", activeId = "work-1", host } = {}) {
  const folders = [{ id: "work-1", name: activeName }]
  const active = { id: activeId, name: activeName }
  let titleInput = activeName
  const setterCalls = []
  const renames = []
  const state = {
    folders,
    active,
    get titleInput() { return titleInput },
    setterCalls,
    renames,
    shell: {
      folders,
      active,
      setWorkTitle: name => setterCalls.push(["workTitle", name]),
      setBreadcrumb: name => setterCalls.push(["breadcrumb", name]),
      setTitleInput: name => { titleInput = name; setterCalls.push(["titleInput", name]) }
    },
    flow: null
  }
  state.flow = createTitleSaveFlow({
    getWork: () => state.active,
    getTitle: () => state.titleInput,
    renameWork: async (work, title) => {
      renames.push([work.id, title])
      return { ...work, name: title }
    }
  })
  return { state, host }
}

test("an adopted h1 mirrors into every shell surface and leaves the title flow clean", async () => {
  const { state, host } = harness({ host: { followHeadingTitle: async () => "New title" } })
  const name = await followHeadingTitleAfterSave(host, "work-1", "# New title\n", state.shell)

  assert.equal(name, "New title")
  assert.equal(state.folders[0].name, "New title")
  assert.equal(state.active.name, "New title")
  assert.deepEqual(state.setterCalls, [
    ["workTitle", "New title"],
    ["breadcrumb", "New title"],
    ["titleInput", "New title"]
  ])
  // The regression: without the title-input mirror the title flow reads
  // the stale input as a pending manual edit and renames the work back.
  assert.equal(state.flow.isDirty(), false)
  assert.equal(await state.flow.flush(), true)
  assert.deepEqual(state.renames, [])
})

test("a host without the follow hook leaves every surface untouched", async () => {
  const { state, host } = harness({ host: {} })
  const name = await followHeadingTitleAfterSave(host, "work-1", "# New title\n", state.shell)

  assert.equal(name, null)
  assert.equal(state.folders[0].name, "Untitled document")
  assert.deepEqual(state.setterCalls, [])
  assert.equal(state.flow.isDirty(), false)
})

test("an unchanged heading leaves the title flow untouched", async () => {
  const { state, host } = harness({ host: { followHeadingTitle: async () => null } })
  const name = await followHeadingTitleAfterSave(host, "work-1", "# Untitled document\n", state.shell)

  assert.equal(name, null)
  assert.deepEqual(state.setterCalls, [])
  assert.equal(state.flow.isDirty(), false)
  assert.deepEqual(state.renames, [])
})

test("a rejected rename keeps the old title on every surface", async () => {
  const { state, host } = harness({
    host: { followHeadingTitle: async () => { throw Object.assign(new Error("taken"), { code: "InvalidInput" }) } }
  })
  const name = await followHeadingTitleAfterSave(host, "work-1", "# Taken name\n", state.shell)

  assert.equal(name, null)
  assert.equal(state.folders[0].name, "Untitled document")
  assert.equal(state.active.name, "Untitled document")
  assert.deepEqual(state.setterCalls, [])
  assert.equal(state.flow.isDirty(), false)
})

test("a named work never moves implicitly, even when its H1 differs", async () => {
  // The committed shared-scenario contract: fixture folders keep their
  // names across edits (e.g. "E2E seed" holding "# Before E2E"). Only an
  // explicit card or title rename moves a named folder.
  let hostCalls = 0
  const { state, host } = harness({
    activeName: "E2E seed",
    host: { followHeadingTitle: async () => { hostCalls += 1; return "Before E2E" } }
  })
  const name = await followHeadingTitleAfterSave(host, "work-1", "# Before E2E\n\nSeed paragraph.\n", state.shell)

  assert.equal(name, null)
  assert.equal(hostCalls, 0)
  assert.equal(state.folders[0].name, "E2E seed")
  assert.equal(state.active.name, "E2E seed")
  assert.deepEqual(state.setterCalls, [])
  assert.equal(state.flow.isDirty(), false)
})

test("the open flow adopts untitled titles before installing the session", async () => {
  // Source-pattern pin in the desktop_host.test.js style: adoption happens
  // at open (never on session saves), so the pin asserts the opener calls
  // the helper with the opening work before the session installs.
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../../..")
  const application = await readFile(
    path.join(root, "packages/editor-runtime/src/lib/file_library_application.ts"), "utf8"
  )
  const anchor = application.indexOf("const { work, prepared } = transition")
  assert.ok(anchor >= 0, "open flow exists")
  const block = application.slice(anchor, application.indexOf("transport.activateWorkFolder(work, id)", anchor))
  assert.ok(
    block.includes("followHeadingTitleAfterSave(libraryHost, work.id, work.source"),
    "open adopts the H1 before the session installs"
  )
  const saveStart = application.indexOf("saveSource: async (id: string, source: string)")
  const saveEnd = application.indexOf("function openSession(workFolder: WorkFolder)")
  assert.ok(saveStart >= 0 && saveEnd > saveStart, "session transport exists")
  assert.ok(
    !application.slice(saveStart, saveEnd).includes("followHeadingTitleAfterSave("),
    "session saves never rename"
  )
})

test("an adopted name for a background work updates its card but not the open surfaces", async () => {
  const { state, host } = harness({
    activeId: "work-9",
    host: { followHeadingTitle: async () => "New card title" }
  })
  const name = await followHeadingTitleAfterSave(host, "work-1", "# New card title\n", state.shell)

  assert.equal(name, "New card title")
  assert.equal(state.folders[0].name, "New card title")
  assert.deepEqual(state.setterCalls, [])
})
