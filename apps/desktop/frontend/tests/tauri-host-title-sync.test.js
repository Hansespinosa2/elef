import assert from "node:assert/strict"
import test from "node:test"

import { createTauriHost } from "../src/tauri-host.js"

const WORK_ID = "path:notes"

function workFolderSummary(overrides = {}) {
  return {
    id: WORK_ID,
    name: "Old title",
    kind: "document",
    modified_ms: 1_700_000_000_000,
    warnings: [],
    notices: [],
    ...overrides,
  }
}

function hostWith(calls, { list = [workFolderSummary()], rename = null } = {}) {
  return createTauriHost({
    invoke: async (command, payload) => {
      calls.push([command, payload])
      if (command === "list_work_folders") return list
      if (command === "read_source_snapshot") return { source: "# Old\n", content_hash: "h1" }
      if (command === "save_source") return { content_hash: "h2" }
      if (command === "rename_work_folder") {
        if (rename instanceof Error) throw rename
        return rename ?? workFolderSummary({ name: payload.name })
      }
      throw new Error(`unexpected command ${command}`)
    },
  })
}

async function saveText(host, text) {
  await host.library.listWorks()
  return host.works.saveWork(WORK_ID, text, { revision: "h1" })
}

function renameCalls(calls) {
  return calls.filter(([command]) => command === "rename_work_folder")
}

test("saveWork renames the folder when the first h1 below front matter changes", async () => {
  const calls = []
  const host = hostWith(calls)
  const result = await saveText(host, "---\ntitle: Ignored\n---\n# New title\n\nBody.\n")
  assert.deepEqual(result, { kind: "saved", baseline: { revision: "h2" } })
  assert.deepEqual(renameCalls(calls), [["rename_work_folder", { id: WORK_ID, name: "New title" }]])
  const snapshot = await host.works.getWork(WORK_ID)
  assert.equal(snapshot.title, "New title")
})

test("saveWork skips the rename when the heading already matches the title", async () => {
  const calls = []
  const host = hostWith(calls)
  await saveText(host, "# Old title\n\nBody.\n")
  assert.deepEqual(renameCalls(calls), [])
})

test("saveWork keeps the title when the source has no heading", async () => {
  const calls = []
  const host = hostWith(calls)
  await saveText(host, "Just prose, no heading.\n")
  assert.deepEqual(renameCalls(calls), [])
})

test("saveWork sanitizes folder-hostile characters instead of rejecting the save", async () => {
  const calls = []
  const host = hostWith(calls)
  await saveText(host, "# a/b: c?\n\nBody.\n")
  assert.deepEqual(renameCalls(calls), [["rename_work_folder", { id: WORK_ID, name: "a b c" }]])
})

test("saveWork keeps the title when the heading cannot name a folder", async () => {
  for (const heading of ["...", "///", ". .."]) {
    const calls = []
    const host = hostWith(calls)
    await saveText(host, `# ${heading}\n\nBody.\n`)
    assert.deepEqual(renameCalls(calls), [], `heading ${JSON.stringify(heading)} must not rename`)
  }
})

test("saveWork still succeeds when the rename collides", async () => {
  const calls = []
  const host = hostWith(calls, { rename: Object.assign(new Error("taken"), { code: "InvalidInput" }) })
  const result = await saveText(host, "# Taken name\n\nBody.\n")
  assert.deepEqual(result, { kind: "saved", baseline: { revision: "h2" } })
  assert.equal(renameCalls(calls).length, 1)
  const snapshot = await host.works.getWork(WORK_ID)
  assert.equal(snapshot.title, "Old title")
})

test("saveWork resolves the current title through a list fallback when unlisted", async () => {
  const calls = []
  const host = hostWith(calls)
  // No listWorks first: summaries is empty, so the sync falls back to a
  // single list instead of opening (and repairing) the work folder.
  await host.works.saveWork(WORK_ID, "# Fresh title\n\nBody.\n", { revision: "h1" })
  assert.deepEqual(renameCalls(calls), [["rename_work_folder", { id: WORK_ID, name: "Fresh title" }]])
  assert.deepEqual(
    calls.map(([command]) => command),
    ["save_source", "read_source_snapshot", "list_work_folders", "rename_work_folder"]
  )
})

test("saveWork syncs presentation titles through the same folder path", async () => {
  const calls = []
  const host = hostWith(calls, { list: [workFolderSummary({ kind: "presentation", name: "Old deck" })] })
  await host.library.listWorks()
  await host.works.saveWork(WORK_ID, "# New deck\n\n---\n", { revision: "h1" })
  assert.deepEqual(renameCalls(calls), [["rename_work_folder", { id: WORK_ID, name: "New deck" }]])
})
