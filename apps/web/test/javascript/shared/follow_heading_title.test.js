import assert from "node:assert/strict"
import { readFile } from "node:fs/promises"
import path from "node:path"
import { fileURLToPath } from "node:url"
import test from "node:test"

import { createTitleSaveFlow } from "@elef/client"
import {
  followHeadingTitleAfterSave,
  resumeHeadingTitleFollow,
  suspendHeadingTitleFollow
} from "@elef/editor-runtime/follow-heading-title"

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

test("a suspended follow preserves the work path on quit flush", async () => {
  let hostCalls = 0
  const { state, host } = harness({
    host: { followHeadingTitle: async () => { hostCalls += 1; return "New title" } }
  })
  suspendHeadingTitleFollow()
  try {
    const name = await followHeadingTitleAfterSave(host, "work-1", "# New title\n", state.shell)
    assert.equal(name, null)
    assert.equal(hostCalls, 0)
    assert.equal(state.folders[0].name, "Old title")
    assert.deepEqual(state.setterCalls, [])
  } finally {
    resumeHeadingTitleFollow()
  }
  // The suspension resets: the next save follows again.
  const name = await followHeadingTitleAfterSave(host, "work-1", "# New title\n", state.shell)
  assert.equal(name, "New title")
  assert.equal(hostCalls, 1)
  assert.equal(state.folders[0].name, "New title")
})

test("flushForClose suspends the H1 follow around the quit save with reset", async () => {
  // Source-pattern pin in the desktop_host.test.js style: the helper test
  // above pins suspension semantics, but only this pins that the quit path
  // actually suspends and resets. Removing the wiring must fail here.
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../../..")
  const application = await readFile(
    path.join(root, "packages/editor-runtime/src/lib/file_library_application.ts"), "utf8"
  )
  const start = application.indexOf("async function flushForClose()")
  assert.ok(start >= 0, "flushForClose exists")
  const block = application.slice(start, application.indexOf("\n  }\n", start))
  assert.ok(block.includes("suspendHeadingTitleFollow()"), "quit flush suspends the H1 follow")
  assert.ok(
    block.indexOf("suspendHeadingTitleFollow()") < block.indexOf("await saveFlow.flush()"),
    "suspension starts before the quit save"
  )
  assert.ok(
    block.includes("finally") && block.includes("resumeHeadingTitleFollow()"),
    "suspension resets even when the app stays open"
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
