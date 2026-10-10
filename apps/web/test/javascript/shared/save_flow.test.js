import assert from "node:assert/strict"
import test from "node:test"

import { createSaveFlow } from "@elef/client"
import { applyEditorSource } from "../../../../../packages/editor-runtime/dist/lib/editor_source.js"

const hash = letter => letter.repeat(64)

function deferred() {
  let resolve
  let reject
  const promise = new Promise((yes, no) => { resolve = yes; reject = no })
  return { promise, resolve, reject }
}

function fakeTimers() {
  let nextId = 0
  let now = 0
  const jobs = new Map()
  return {
    setTimer(callback, delay) {
      const id = ++nextId
      jobs.set(id, { callback, at: now + delay })
      return id
    },
    clearTimer(id) { jobs.delete(id) },
    async advance(milliseconds) {
      now += milliseconds
      while (true) {
        const due = [...jobs.entries()].filter(([, job]) => job.at <= now).sort((a, b) => a[1].at - b[1].at)[0]
        if (!due) break
        jobs.delete(due[0])
        due[1].callback()
        await Promise.resolve()
        await Promise.resolve()
      }
    },
    count() { return jobs.size }
  }
}

function setup(overrides = {}) {
  const { initialSource, ...flowOverrides } = overrides
  let source = initialSource ?? "old"
  const deck = { id: "deck-1", source, source_file: "talk.md", content_hash: hash("a") }
  const calls = []
  const accepted = []
  const conflicts = []
  const states = []
  const errors = []
  const flow = createSaveFlow({
    saveSource: async (id, value) => {
      calls.push([id, value])
      return { content_hash: hash("b") }
    },
    acceptDiskVersion: (...args) => accepted.push(args),
    getSource: () => source,
    setSource: async value => { source = value },
    onState: state => states.push(state),
    onConflict: conflict => conflicts.push(conflict),
    onError: error => errors.push(error),
    ...flowOverrides
  })
  flow.activate(deck)
  return { deck, flow, calls, accepted, conflicts, states, errors, setSource: value => { source = value }, getSource: () => source }
}

test("save orchestration serializes writes and drains edits made during an in-flight save", async () => {
  const firstSave = deferred()
  const calls = []
  const context = setup({
    saveSource: async (_id, source) => {
      calls.push(source)
      if (calls.length === 1) return firstSave.promise
      return { content_hash: hash("c") }
    }
  })

  context.setSource("first edit")
  context.flow.noteChange()
  const saving = context.flow.flush({ force: true })
  context.setSource("latest edit")
  context.flow.noteChange()
  firstSave.resolve({ content_hash: hash("b") })

  assert.equal(await saving, true)
  assert.deepEqual(calls, ["first edit", "latest edit"])
  assert.equal(context.deck.source, "latest edit")
  assert.equal(context.flow.dirty, false)
})

test("a shared snapshot drains metadata changes made during a source save", async () => {
  const firstSave = deferred()
  const source = { value: "source" }
  const metadata = { value: "initial title" }
  const calls = []
  const flow = createSaveFlow({
    saveSource: async (_id, value, { snapshot }) => {
      calls.push({ value, snapshot })
      if (calls.length === 1) return firstSave.promise
      return { content_hash: hash("c"), snapshot }
    },
    acceptDiskVersion() {},
    getSource: () => source.value,
    getSnapshot: () => `${source.value}\u001f${metadata.value}`,
    setSource: async value => { source.value = value }
  })
  flow.activate({ id: "deck-1", source: source.value, content_hash: hash("a") })
  metadata.value = "first title"
  flow.noteChange()
  const saving = flow.flush({ force: true })
  metadata.value = "latest title"
  flow.noteChange()
  firstSave.resolve({ content_hash: hash("b"), snapshot: "source\u001ffirst title" })

  assert.equal(await saving, true)
  assert.deepEqual(calls, [
    { value: "source", snapshot: "source\u001ffirst title" },
    { value: "source", snapshot: "source\u001flatest title" }
  ])
  assert.equal(flow.dirty, false)
})

test("paused autosave holds edits until an explicit flush", async () => {
  const timers = fakeTimers()
  const context = setup({ setTimer: timers.setTimer, clearTimer: timers.clearTimer })

  context.flow.pause()
  context.setSource("local edit")
  context.flow.noteChange()

  assert.equal(context.flow.dirty, true)
  assert.equal(timers.count(), 0)
  await timers.advance(10_000)
  assert.equal(context.calls.length, 0)

  assert.equal(await context.flow.flush({ force: true }), true)
  assert.deepEqual(context.calls, [["deck-1", "local edit"]])
  assert.equal(context.flow.dirty, false)
  context.flow.resume()
  assert.equal(timers.count(), 0)
})

test("conflicts stop automatic writes until a deliberate choice updates the disk baseline", async () => {
  const context = setup({
    saveSource: async () => {
      throw { code: "conflict", details: { disk_hash: hash("d"), current: { source: "outside" } } }
    }
  })
  context.setSource("mine")
  context.flow.noteChange()

  assert.equal(await context.flow.flush(), false)
  assert.equal(context.flow.dirty, true)
  assert.equal(context.conflicts[0].diskSource, "outside")
  assert.equal(await context.flow.flush(), false)
  assert.equal(context.calls.length, 0)

  await context.flow.useDiskVersion()
  assert.deepEqual(context.accepted, [["deck-1", hash("d")]])
  assert.equal(context.getSource(), "outside")
  assert.equal(context.flow.dirty, false)
  assert.equal(context.states.at(-1), "Saved")
  assert.equal(await context.flow.restoreDraft(), true)
  assert.equal(context.getSource(), "mine")
})

test("external edits reload clean buffers and surface conflicts when local edits exist", async () => {
  const context = setup()
  const first = await context.flow.checkExternalChange("deck-1", {
    content_hash: hash("d"),
    source: "external clean edit"
  })
  assert.equal(first, "reloaded")
  assert.equal(context.getSource(), "external clean edit")
  assert.equal(context.deck.content_hash, hash("d"))
  assert.deepEqual(context.accepted, [["deck-1", hash("d")]])

  context.setSource("local unsaved edit")
  context.flow.noteChange()
  const second = await context.flow.checkExternalChange("deck-1", {
    content_hash: hash("e"),
    source: "external concurrent edit"
  })
  assert.equal(second, "conflict")
  assert.equal(context.getSource(), "local unsaved edit")
  assert.equal(context.conflicts.at(-1).diskSource, "external concurrent edit")
})

function mergeSetup(outcome, local = "old") {
  const snapshots = []
  const merges = []
  const context = setup({
    initialSource: local,
    takeSnapshot: async (id, reason, source) => { snapshots.push([id, reason, source]) },
    mergeExternalChange: async (id, localSource) => {
      merges.push([id, localSource])
      if (outcome instanceof Error) throw outcome
      return outcome
    }
  })
  return { ...context, snapshots, merges }
}

test("a suspicious external rewrite conflicts on a clean buffer instead of reloading silently", async () => {
  const context = mergeSetup({ kind: "suspicious" })
  const result = await context.flow.resolveExternalChange("deck-1", {
    content_hash: hash("d"),
    source: ""
  })
  assert.equal(result, "conflict")
  assert.deepEqual(context.merges, [["deck-1", "old"]])
  assert.deepEqual(context.snapshots, [["deck-1", "pre-merge", "old"], ["deck-1", "external-change", undefined]])
  assert.equal(context.getSource(), "old")
  assert.equal(context.conflicts.length, 1)
  assert.equal(context.conflicts[0].diskSource, "")
})

test("an overlapping external rewrite conflicts on a clean buffer", async () => {
  const local = "x".repeat(275)
  const context = mergeSetup({ kind: "overlap" }, local)
  const result = await context.flow.resolveExternalChange("deck-1", {
    content_hash: hash("d"),
    source: "external rewrite"
  })
  assert.equal(result, "conflict")
  assert.deepEqual(context.merges, [["deck-1", local]])
  assert.deepEqual(context.snapshots, [["deck-1", "pre-merge", local], ["deck-1", "external-change", undefined]])
  assert.equal(context.getSource(), local)
})

test("a clean merge result still reloads a clean buffer silently", async () => {
  const local = "x".repeat(275)
  const context = mergeSetup({ kind: "merged", source: "external clean edit" }, local)
  const result = await context.flow.resolveExternalChange("deck-1", {
    content_hash: hash("d"),
    source: "external clean edit"
  })
  assert.equal(result, "reloaded")
  assert.equal(context.getSource(), "external clean edit")
  assert.equal(context.conflicts.length, 0)
})

test("a merge failure on a clean buffer conflicts instead of reloading silently", async () => {
  const local = "x".repeat(275)
  const context = mergeSetup(Object.assign(new Error("merge unavailable"), { code: "storage_unavailable", retryable: true }), local)
  const result = await context.flow.resolveExternalChange("deck-1", {
    content_hash: hash("d"),
    source: "external rewrite"
  })
  assert.equal(result, "conflict")
  assert.equal(context.getSource(), local)
  assert.equal(context.errors.length, 1)
})

test("an ordinary external edit reloads a clean buffer without consulting merge", async () => {
  const context = mergeSetup({ kind: "overlap" })
  const result = await context.flow.resolveExternalChange("deck-1", {
    content_hash: hash("d"),
    source: "external clean edit"
  })
  assert.equal(result, "reloaded")
  assert.deepEqual(context.merges, [])
  assert.deepEqual(context.snapshots, [])
  assert.equal(context.getSource(), "external clean edit")
  assert.equal(context.conflicts.length, 0)
})

test("the clean pre-gate trips on the exact suspicious boundaries", async () => {
  const cases = [
    ["x".repeat(199), "", "conflict"],
    ["x".repeat(199), "y", "reloaded"],
    ["x".repeat(200), "y".repeat(99), "conflict"],
    ["x".repeat(200), "y".repeat(100), "reloaded"],
    ["x".repeat(201), "y".repeat(100), "conflict"],
    ["x".repeat(201), "y".repeat(101), "reloaded"]
  ]
  for (const [local, external, expected] of cases) {
    const context = mergeSetup({ kind: "overlap" }, local)
    const result = await context.flow.resolveExternalChange("deck-1", {
      content_hash: hash("d"),
      source: external
    })
    assert.equal(result, expected, `local ${local.length} chars vs external ${external.length} chars`)
    assert.equal(context.merges.length, expected === "conflict" ? 1 : 0)
  }
})

test("external snapshots for a closed or inactive deck are ignored", async () => {
  const context = setup()
  assert.equal(await context.flow.checkExternalChange("other-deck", {
    content_hash: hash("d"), source: "other source"
  }), "inactive")
})

test("an external snapshot matching the in-flight local bytes advances the save baseline", async () => {
  const context = setup()
  context.setSource("local edit")
  context.flow.noteChange()
  const result = await context.flow.checkExternalChange("deck-1", {
    content_hash: hash("d"),
    source: "local edit"
  })
  assert.equal(result, "matching-local")
  assert.equal(context.conflicts.length, 0)
  assert.equal(context.accepted.at(-1)[1], hash("d"))
})

test("external source-file selection changes update a clean deck and conflict with dirty edits", async () => {
  const context = setup()
  const sameBytes = await context.flow.checkExternalChange("deck-1", {
    content_hash: hash("a"), source: "old", source_file: "presentation.md"
  })
  assert.equal(sameBytes, "source-file-changed")
  assert.equal(context.deck.source_file, "presentation.md")

  context.setSource("local unsaved edit")
  context.flow.noteChange()
  const result = await context.flow.checkExternalChange("deck-1", {
    content_hash: hash("a"), source: "old", source_file: "document.md"
  })
  assert.equal(result, "conflict")
  assert.equal(context.conflicts.at(-1).diskSourceFile, "document.md")
  assert.equal(await context.flow.useDiskVersion(), true)
  assert.equal(context.deck.source_file, "document.md")
})

test("keeping local content and a merged version both save against the accepted disk hash", async () => {
  const saves = []
  const context = setup({
    saveSource: async (_id, source) => {
      saves.push(source)
      return { content_hash: hash("e") }
    }
  })
  context.flow.handleConflict({ id: "deck-1", details: { disk_hash: hash("d"), current: { source: "disk" } } })
  context.setSource("local")
  context.flow.keepLocalVersion()
  await context.flow.flush()
  assert.deepEqual(context.accepted[0], ["deck-1", hash("d")])
  assert.deepEqual(saves, ["local"])

  context.flow.handleConflict({ id: "deck-1", details: { disk_hash: hash("f"), current: { source: "disk v2" } } })
  await context.flow.saveMergedVersion("merged")
  await context.flow.flush()
  assert.deepEqual(context.accepted[1], ["deck-1", hash("f")])
  assert.deepEqual(saves, ["local", "merged"])
  assert.equal(context.deck.source, "merged")
})

test("discarded drafts are bounded", async () => {
  const context = setup({ maxDiscardedDrafts: 2 })
  for (let index = 0; index < 3; index += 1) {
    context.setSource(`draft ${index}`)
    context.flow.handleConflict({ id: "deck-1", details: { disk_hash: hash(String(index + 2)), current: { source: `disk ${index}` } } })
    await context.flow.useDiskVersion()
  }

  assert.equal(context.flow.discardedDraftCount, 2)
  await context.flow.restoreDraft()
  assert.equal(context.getSource(), "draft 2")
})

test("transient save failures retry with bounded backoff instead of every keystroke", async () => {
  const timers = fakeTimers()
  let attempts = 0
  const context = setup({
    setTimer: timers.setTimer,
    clearTimer: timers.clearTimer,
    saveSource: async () => {
      attempts += 1
      throw Object.assign(new Error("temporary filesystem failure"), { code: "io_error", retryable: true })
    }
  })
  context.setSource("local")
  context.flow.noteChange()
  await context.flow.flush({ force: true })
  assert.equal(attempts, 1)
  assert.equal(timers.count(), 1)

  context.setSource("newer local")
  context.flow.noteChange()
  await context.flow.flush()
  await timers.advance(999)
  assert.equal(attempts, 1)
  await timers.advance(1)
  await Promise.resolve()
  assert.equal(attempts, 2)
  assert.equal(context.flow.dirty, true)
})

test("permanent save failures stop retrying until the source changes or the user retries", async () => {
  let attempts = 0
  const context = setup({
    saveSource: async () => {
      attempts += 1
      throw Object.assign(new Error("deck was removed"), { code: "not_found", retryable: false })
    }
  })
  context.setSource("local")
  context.flow.noteChange()
  assert.equal(await context.flow.flush(), false)
  assert.equal(context.flow.blocked, true)
  assert.equal(context.states.at(-1), "Save failed")
  context.setSource("newer local")
  context.flow.noteChange()
  assert.equal(await context.flow.flush(), false)
  assert.equal(attempts, 2)
  assert.equal(context.flow.blocked, true)

  await context.flow.flush({ force: true })
  assert.equal(attempts, 3)
})

test("an invalid conflict fingerprint blocks saving instead of retrying in a loop", async () => {
  const timers = fakeTimers()
  let attempts = 0
  const context = setup({
    setTimer: timers.setTimer,
    clearTimer: timers.clearTimer,
    saveSource: async () => {
      attempts += 1
      throw { code: "conflict", details: { current: { source: "external" } } }
    }
  })
  context.setSource("local")
  context.flow.noteChange()

  assert.equal(await context.flow.flush({ force: true }), false)
  assert.equal(context.flow.blocked, true)
  assert.equal(timers.count(), 0)
  assert.equal(attempts, 1)
})

test("undo to the old baseline waits for the outstanding write and persists the final buffer", async () => {
  const pending = deferred()
  const calls = []
  const context = setup({ saveSource: async (_id, source) => {
    calls.push(source)
    return calls.length === 1 ? pending.promise : { content_hash: hash("c") }
  } })
  context.setSource("new")
  context.flow.noteChange()
  const first = context.flow.flush()
  context.setSource("old")
  context.flow.noteChange()
  assert.equal(context.flow.dirty, true)
  let navigationAllowed = false
  const leaving = context.flow.flush().then(saved => { navigationAllowed = saved })
  await Promise.resolve()
  assert.equal(navigationAllowed, false)
  pending.resolve({ content_hash: hash("b") })
  await Promise.all([first, leaving])
  assert.equal(navigationAllowed, true)
  assert.deepEqual(calls, ["new", "old"])
  assert.equal(context.deck.source, "old")
})

test("discarded recovery drafts belong to their deck across switching and reopening", async () => {
  const context = setup()
  context.setSource("deck A draft")
  context.flow.handleConflict({ id: context.deck.id, details: { disk_hash: hash("b"), current: { source: "external" } } })
  await context.flow.useDiskVersion()
  context.setSource("deck B")
  context.flow.activate({ id: "deck-2", source: "deck B", content_hash: hash("c") })
  assert.equal(context.flow.canRestoreDraft, false)
  assert.equal(await context.flow.restoreDraft(), false)
  assert.equal(context.getSource(), "deck B")
  context.flow.activate(context.deck)
  assert.equal(context.flow.canRestoreDraft, true)
  await context.flow.restoreDraft()
  assert.equal(context.getSource(), "deck A draft")
  await context.flow.flush()
})

test("disk and merge choices keep their conflict and original fingerprint until the buffer applies", async () => {
  for (const choice of ["disk", "merge"]) {
    const applying = deferred()
    const context = setup({ setSource: async source => {
      await applying.promise
      context.setSource(source)
      return true
    } })
    context.setSource("local draft")
    context.flow.noteChange()
    context.flow.handleConflict({ id: context.deck.id, details: {
      disk_hash: hash("b"), current: { source: "external", source_file: "talk.md" }
    } })
    const resolution = choice === "disk" ? context.flow.useDiskVersion() : context.flow.saveMergedVersion("merged")
    assert.equal(context.flow.dirty, true)
    assert.equal(context.flow.conflict.diskSource, "external")
    assert.equal(await context.flow.flush({ force: true }), false)
    assert.equal(context.flow.keepLocalVersion(), false)
    assert.deepEqual(context.accepted, [])
    assert.deepEqual(context.calls, [])
    assert.equal(context.deck.content_hash, hash("a"))
    applying.resolve()
    assert.equal(await resolution, true)
    assert.deepEqual(context.accepted, [[context.deck.id, hash("b")]])
    assert.equal(context.flow.conflict, null)
    assert.equal(context.getSource(), choice === "disk" ? "external" : "merged")
  }
})

test("typing while a clean external reload waits becomes a conflict without advancing its fingerprint", async () => {
  const ready = deferred()
  const context = setup({ setSource: (source, origin) => applyEditorSource(source, {
    ...origin, getDeckId: () => context.deck.id, getSource: context.getSource,
    waitForEditor: () => ready.promise, setFallback: () => assert.fail("fallback")
  }) })
  const reloading = context.flow.checkExternalChange(context.deck.id, { source: "external", content_hash: hash("b"), source_file: "talk.md" })
  assert.equal(context.flow.dirty, true)
  assert.equal(await context.flow.flush(), false)
  context.setSource("new local edit")
  context.flow.noteChange()
  ready.resolve({ setExternalValue: context.setSource })
  assert.equal(await reloading, "conflict")
  assert.equal(context.getSource(), "new local edit")
  assert.equal(context.deck.content_hash, hash("a"))
  assert.deepEqual(context.accepted, [])
  assert.equal(context.flow.conflict.diskSource, "external")
})

test("an obsolete external reload does not clear another deck's edits after readiness", async () => {
  const applying = deferred()
  const context = setup({ setSource: () => applying.promise })
  const reloading = context.flow.checkExternalChange(context.deck.id, { source: "external A", content_hash: hash("b") })
  const next = { id: "deck-2", source: "B original", source_file: "document.md", content_hash: hash("c") }
  context.flow.activate(next)
  context.setSource("B edited")
  context.flow.noteChange()
  applying.resolve(false)
  assert.equal(await reloading, "inactive")
  assert.equal(context.getSource(), "B edited")
  assert.equal(context.flow.dirty, true)
  assert.equal(next.content_hash, hash("c"))
  assert.deepEqual(context.accepted, [])
})

test("recovery remains owned and blocks leaving until its source has applied", async () => {
  let block = null
  const context = setup({ setSource: async source => {
    if (block && !(await block.promise)) return false
    context.setSource(source)
    return true
  } })
  context.setSource("draft A")
  context.flow.noteChange()
  context.flow.handleConflict({ id: context.deck.id, details: { disk_hash: hash("b"), current: { source: "external" } } })
  await context.flow.useDiskVersion()
  block = deferred()
  const recovering = context.flow.restoreDraft()
  assert.equal(context.flow.dirty, true)
  assert.equal(await context.flow.flush(), false)
  assert.equal(context.flow.discardedDraftCount, 1)
  block.resolve(false)
  assert.equal(await recovering, false)
  assert.equal(context.getSource(), "external")
  assert.equal(context.flow.discardedDraftCount, 1)
  block = null
  assert.equal(await context.flow.restoreDraft(), true)
  assert.equal(context.getSource(), "draft A")
  assert.equal(context.flow.discardedDraftCount, 0)
})

test("external snapshot arrival before a visual frame flush preserves the visual edit in a conflict", async () => {
  let pending = "visual edit waiting for its frame"
  const context = setup({ materializeEdits: () => {
    if (!pending) return
    context.setSource(pending)
    pending = null
    context.flow.noteChange()
  } })
  assert.equal(context.flow.dirty, false)
  assert.equal(await context.flow.checkExternalChange(context.deck.id, {
    source: "external", content_hash: hash("b"), source_file: "talk.md"
  }), "conflict")
  assert.equal(context.getSource(), "visual edit waiting for its frame")
  assert.equal(context.flow.conflict.localSource, "visual edit waiting for its frame")
  assert.equal(context.deck.content_hash, hash("a"))
  assert.deepEqual(context.accepted, [])
})

test("typing during refused recovery resumes autosave while retaining the recoverable draft", async () => {
  const timers = fakeTimers()
  let pending = null
  const context = setup({ setTimer: timers.setTimer, clearTimer: timers.clearTimer,
    setSource: async source => {
      if (pending && !(await pending.promise)) return false
      context.setSource(source)
      return true
    }
  })
  context.setSource("recoverable draft")
  context.flow.noteChange()
  context.flow.handleConflict({ id: context.deck.id, details: { disk_hash: hash("b"), current: { source: "external" } } })
  await context.flow.useDiskVersion()
  pending = deferred()
  const recovering = context.flow.restoreDraft()
  context.setSource("newer typing")
  context.flow.noteChange()
  assert.equal(timers.count(), 0)
  pending.resolve(false)
  assert.equal(await recovering, false)
  assert.equal(context.flow.discardedDraftCount, 1)
  assert.equal(timers.count(), 1)
  await timers.advance(0)
  assert.deepEqual(context.calls, [[context.deck.id, "newer typing"]])
  assert.equal(context.getSource(), "newer typing")
  assert.equal(context.flow.dirty, false)
  assert.equal(context.flow.discardedDraftCount, 1)
})
