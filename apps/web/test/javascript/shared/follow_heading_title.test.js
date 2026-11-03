import assert from "node:assert/strict"
import test from "node:test"

import { createTitleSaveFlow } from "@elef/client"
import { followHeadingTitleAfterSave } from "@elef/editor-runtime/follow-heading-title"

// Mirror of the shell surfaces sessionTransport.saveSource wires into
// followHeadingTitleAfterSave: the folder list, the open work, and the
// three DOM setters (editor title, breadcrumb, title input).
function harness({ activeName = "Old title", activeId = "work-1", host } = {}) {
  const folders = [{ id: "work-1", name: "Old title" }]
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
  assert.equal(state.folders[0].name, "Old title")
  assert.deepEqual(state.setterCalls, [])
  assert.equal(state.flow.isDirty(), false)
})

test("an unchanged heading leaves the title flow untouched", async () => {
  const { state, host } = harness({ host: { followHeadingTitle: async () => null } })
  const name = await followHeadingTitleAfterSave(host, "work-1", "# Old title\n", state.shell)

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
  assert.equal(state.folders[0].name, "Old title")
  assert.equal(state.active.name, "Old title")
  assert.deepEqual(state.setterCalls, [])
  assert.equal(state.flow.isDirty(), false)
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
