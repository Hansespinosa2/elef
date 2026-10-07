import assert from "node:assert/strict"
import test from "node:test"

import { createWorkSession } from "../../../app/javascript/lib/work_session.js"

const hash = letter => letter.repeat(64)

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

async function flush(rounds = 100) {
  for (let i = 0; i < rounds; i++) await Promise.resolve()
}

function setup(overrides = {}) {
  const timers = fakeTimers()
  let text = overrides.text ?? "old"
  const deck = { id: "deck-1", source: text, source_file: "talk.md", content_hash: hash("a") }
  const state = {
    saves: [],
    accepted: [],
    snapshots: [],
    merges: [],
    reads: [],
    polls: 0,
    pollQueue: [],
    savedHash: overrides.savedHash ?? hash("b"),
    saveImpl: null,
    readImpl: async id => {
      state.reads.push(id)
      return { source: text, source_file: "talk.md", content_hash: hash("a") }
    },
    mergeImpl: async (id, local) => {
      state.merges.push([id, local])
      return { kind: "overlap" }
    }
  }
  const transport = {
    saveSource: async (id, source, options) => {
      state.saves.push([id, source, options])
      if (state.saveImpl) return state.saveImpl(id, source, options)
      return { content_hash: state.savedHash }
    },
    acceptDiskVersion: (id, contentHash) => { state.accepted.push([id, contentHash]) },
    readSourceSnapshot: id => state.readImpl(id),
    mergeExternalChange: (id, localSource) => state.mergeImpl(id, localSource),
    takeSnapshot: async (id, reason, source) => {
      state.snapshots.push([id, reason, source])
      return { id: "snap-1" }
    },
    pollFileEvents: async () => {
      state.polls += 1
      return state.pollQueue.splice(0)
    }
  }
  const conflicts = []
  const errors = []
  const statuses = []
  const externals = []
  const session = createWorkSession({
    transport: overrides.transport ?? transport,
    policy: {
      workId: "deck-1",
      kind: "presentation",
      deck,
      getText: () => text,
      setText: async value => { text = value; return true },
      saveDelay: 50,
      externalPollMs: 100,
      setTimer: timers.setTimer.bind(timers),
      clearTimer: timers.clearTimer.bind(timers),
      onConflict: conflict => conflicts.push(conflict),
      onError: error => errors.push(error),
      ...overrides.policy
    }
  })
  session.onStatus(status => statuses.push(status.kind))
  session.onExternalChange(snapshot => externals.push(snapshot))
  return {
    timers,
    transport,
    state,
    session,
    conflicts,
    errors,
    statuses,
    externals,
    getText: () => text,
    setDirectText: value => { text = value }
  }
}

test("work session exposes the contract surface and starts clean", async () => {
  const { session, statuses } = setup()
  assert.equal(session.workId, "deck-1")
  assert.equal(session.kind, "presentation")
  assert.equal(session.getText(), "old")
  assert.equal(session.dirty, false)
  assert.equal(session.conflict, null)
  assert.deepEqual(statuses, ["clean"])
  assert.deepEqual(await session.flush(), { kind: "clean", baseline: { revision: hash("a") } })
  session.dispose()
})

test("work session validates transport and policy", () => {
  const timers = fakeTimers()
  const deck = { id: "deck-1", source: "old", source_file: "talk.md", content_hash: hash("a") }
  const transport = { saveSource: async () => ({}), acceptDiskVersion: () => {} }
  const policy = { workId: "deck-1", deck, getText: () => "old" }
  assert.throws(() => createWorkSession({}), TypeError)
  assert.throws(() => createWorkSession({ transport: {}, policy }), TypeError)
  assert.throws(() => createWorkSession({ transport, policy: null }), TypeError)
  assert.throws(() => createWorkSession({ transport, policy: { ...policy, workId: "" } }), TypeError)
  assert.throws(() => createWorkSession({ transport, policy: { ...policy, getText: null } }), TypeError)
  assert.throws(() => createWorkSession({ transport, policy: { ...policy, deck: { ...deck, id: "other" } } }), TypeError)
  assert.throws(() => createWorkSession({ transport, policy: { ...policy, deck: { ...deck, content_hash: "nope" } } }), TypeError)
  void timers
})

test("work session saves local edits and tracks the baseline", async () => {
  const { session, state, statuses, timers } = setup()
  await session.replaceText("new")
  assert.equal(session.dirty, true)
  assert.deepEqual(statuses, ["clean", "dirty"])
  await timers.advance(50)
  await flush()
  assert.deepEqual(state.saves, [["deck-1", "new", { snapshot: "new" }]])
  assert.deepEqual(statuses, ["clean", "dirty", "saving", "clean"])
  assert.deepEqual(await session.flush(), { kind: "clean", baseline: { revision: hash("b") } })
  state.savedHash = hash("d")
  await session.replaceText("newer")
  assert.deepEqual(await session.flush(), { kind: "saved", baseline: { revision: hash("d") } })
  assert.deepEqual(await session.flush(), { kind: "clean", baseline: { revision: hash("d") } })
  session.dispose()
})

test("work session splices local changes and rejects bad ranges", async () => {
  const { session, timers } = setup({ text: "old" })
  await session.applyLocalChange({ from: 0, to: 3, insert: "NEW" })
  assert.equal(session.getText(), "NEW")
  await timers.advance(50)
  await flush()
  assert.equal(session.dirty, false)
  assert.throws(() => session.applyLocalChange({ from: 0, to: 99, insert: "x" }), RangeError)
  assert.throws(() => session.applyLocalChange({ from: 2, to: 1, insert: "x" }), RangeError)
  assert.throws(() => session.applyLocalChange({ from: 0, to: 1 }), TypeError)
  assert.throws(() => session.applyLocalChange(null), TypeError)
  session.dispose()
})

test("work session merges clean external changes silently", async () => {
  const fixture = setup({ policy: { saveDelay: 5000 } })
  const { session, state, timers, conflicts, externals } = fixture
  state.readImpl = async id => {
    state.reads.push(id)
    return { source: "one\nTWO\n", source_file: "talk.md", content_hash: hash("c") }
  }
  state.mergeImpl = async (id, local) => {
    state.merges.push([id, local])
    return { kind: "merged", source: "ONE\nTWO\n" }
  }
  await session.replaceText("ONE\ntwo\n")
  state.pollQueue.push({ deck_id: "other", kind: "SourceChanged" }, { deck_id: "deck-1", kind: "SourceChanged" })
  await timers.advance(100)
  await flush()
  assert.deepEqual(state.reads, ["deck-1"])
  assert.deepEqual(state.snapshots, [
    ["deck-1", "pre-merge", "ONE\ntwo\n"],
    ["deck-1", "external-change", undefined]
  ])
  assert.deepEqual(state.merges, [["deck-1", "ONE\ntwo\n"]])
  assert.equal(fixture.getText(), "ONE\nTWO\n")
  assert.deepEqual(state.saves, [["deck-1", "ONE\nTWO\n", { snapshot: "ONE\nTWO\n" }]])
  assert.deepEqual(state.accepted, [["deck-1", hash("c")]])
  assert.equal(conflicts.length, 0)
  assert.deepEqual(externals, [{
    id: "deck-1",
    workspaceId: "",
    title: "",
    kind: "presentation",
    text: "one\nTWO\n",
    sourceFile: "talk.md",
    baseline: { revision: hash("c") }
  }])
  assert.equal(session.dirty, false)
  session.dispose()
})

test("work session routes overlap to the conflict path after snapshotting", async () => {
  const fixture = setup({ policy: { saveDelay: 5000 } })
  const { session, state, timers, conflicts } = fixture
  state.readImpl = async () => ({ source: "disk", source_file: "talk.md", content_hash: hash("c") })
  await session.replaceText("local")
  state.pollQueue.push({ deck_id: "deck-1", kind: "SourceChanged" })
  await timers.advance(100)
  await flush()
  assert.deepEqual(state.snapshots, [
    ["deck-1", "pre-merge", "local"],
    ["deck-1", "external-change", undefined]
  ])
  assert.equal(conflicts.length, 1)
  assert.equal(fixture.getText(), "local")
  assert.equal(state.saves.length, 0)
  assert.notEqual(session.conflict, null)
  session.dispose()
})

test("work session never auto-loads suspicious changes", async () => {
  const fixture = setup({ policy: { saveDelay: 5000 } })
  const { session, state, timers, conflicts } = fixture
  state.readImpl = async () => ({ source: "disk", source_file: "talk.md", content_hash: hash("c") })
  state.mergeImpl = async () => ({ kind: "suspicious" })
  await session.replaceText("local")
  state.pollQueue.push({ deck_id: "deck-1", kind: "SourceChanged" })
  await timers.advance(100)
  await flush()
  assert.deepEqual(state.snapshots.map(entry => entry[1]), ["pre-merge", "external-change"])
  assert.equal(conflicts.length, 1)
  assert.equal(fixture.getText(), "local")
  assert.equal(state.saves.length, 0)
  session.dispose()
})

test("work session falls back to conflict when merge hooks fail or misbehave", async () => {
  for (const mergeImpl of [
    async () => { throw Object.assign(new Error("ipc down"), { code: "internal", retryable: true }) },
    async () => ({ kind: "merged" }),
    async () => null
  ]) {
    const fixture = setup({ policy: { saveDelay: 5000 } })
    const { session, state, timers, conflicts, errors } = fixture
    state.readImpl = async () => ({ source: "disk", source_file: "talk.md", content_hash: hash("c") })
    state.mergeImpl = mergeImpl
    await session.replaceText("local")
    state.pollQueue.push({ deck_id: "deck-1", kind: "SourceChanged" })
    await timers.advance(100)
    await flush()
    assert.equal(conflicts.length, 1)
    assert.equal(fixture.getText(), "local")
    assert.equal(state.saves.length, 0)
    session.dispose()
    void errors
  }
  const failing = setup({ policy: { saveDelay: 5000 } })
  failing.transport.takeSnapshot = async () => { throw Object.assign(new Error("disk full"), { code: "storage_unavailable" }) }
  failing.state.readImpl = async () => ({ source: "disk", source_file: "talk.md", content_hash: hash("c") })
  await failing.session.replaceText("local")
  failing.state.pollQueue.push({ deck_id: "deck-1", kind: "SourceChanged" })
  await failing.timers.advance(100)
  await flush()
  assert.equal(failing.conflicts.length, 1)
  assert.equal(failing.errors.length, 1)
  failing.session.dispose()
})

test("work session reloads clean external changes without merging", async () => {
  const fixture = setup()
  const { session, state, timers, conflicts, externals } = fixture
  state.readImpl = async () => ({ source: "disk v2", source_file: "talk.md", content_hash: hash("c") })
  state.pollQueue.push({ deck_id: "deck-1", kind: "SourceChanged" })
  await timers.advance(100)
  await flush()
  assert.equal(fixture.getText(), "disk v2")
  assert.deepEqual(state.merges, [])
  assert.deepEqual(state.snapshots, [])
  assert.equal(conflicts.length, 0)
  assert.equal(externals.length, 1)
  session.dispose()
})

test("work session reports removal without touching the editor", async () => {
  const fixture = setup({ text: "local edits" })
  const { session, state, timers, externals, errors } = fixture
  const missing = Object.assign(new Error("gone"), { code: "not_found", retryable: false })
  state.readImpl = async () => { throw missing }
  state.pollQueue.push({ deck_id: "deck-1", kind: "SourceRemoved" })
  await timers.advance(100)
  await flush()
  assert.equal(fixture.getText(), "local edits")
  assert.equal(externals.length, 1)
  assert.equal(externals[0].removed, true)
  assert.equal(externals[0].text, "local edits")
  assert.equal(errors.length, 1)
  state.pollQueue.push({ deck_id: "deck-1", kind: "SourceRemoved" })
  await timers.advance(100)
  await flush()
  assert.equal(errors.length, 1)
  session.dispose()
})

test("work session without merge hooks uses the legacy external path", async () => {
  const timers = fakeTimers()
  let text = "old"
  const deck = { id: "deck-1", source: "old", source_file: "talk.md", content_hash: hash("a") }
  const conflicts = []
  const session = createWorkSession({
    transport: {
      saveSource: async () => ({ content_hash: hash("b") }),
      acceptDiskVersion: () => {},
      readSourceSnapshot: async () => ({ source: "disk", source_file: "talk.md", content_hash: hash("c") }),
      pollFileEvents: async () => [{ deck_id: "deck-1", kind: "SourceChanged" }]
    },
    policy: {
      workId: "deck-1",
      deck,
      getText: () => text,
      setText: async value => { text = value; return true },
      saveDelay: 50,
      externalPollMs: 100,
      setTimer: timers.setTimer.bind(timers),
      clearTimer: timers.clearTimer.bind(timers),
      onConflict: conflict => conflicts.push(conflict)
    }
  })
  await timers.advance(100)
  await flush()
  assert.equal(text, "disk")
  assert.equal(conflicts.length, 0)
  session.dispose()
})

test("work session stops polling after dispose", async () => {
  const { session, state, timers, statuses } = setup()
  const polls = state.polls
  session.dispose()
  const statusCount = statuses.length
  await timers.advance(1000)
  await flush()
  assert.equal(state.polls, polls)
  assert.equal(statuses.length, statusCount)
  assert.equal(timers.count(), 0)
  assert.deepEqual(await session.flush(), {
    kind: "failed",
    error: { category: "cancelled", message: "Session is disposed.", retryable: false }
  })
  await assert.rejects(session.replaceText("late"), /disposed/)
})

test("work session maps conflicts and failures through flush", async () => {
  const { session, state, timers } = setup()
  state.saveImpl = async () => {
    throw { code: "conflict", details: { disk_hash: hash("c"), current: { source: "disk", source_file: "talk.md" } } }
  }
  await session.replaceText("local")
  await timers.advance(50)
  await flush()
  assert.notEqual(session.conflict, null)
  assert.deepEqual(await session.flush(), {
    kind: "conflict",
    current: {
      id: "deck-1",
      workspaceId: "",
      title: "",
      kind: "presentation",
      text: "disk",
      sourceFile: "talk.md",
      baseline: { revision: hash("c") }
    }
  })
  session.dispose()

  const blocked = setup()
  blocked.state.saveImpl = async () => { throw { code: "permission_denied", message: "nope", retryable: false } }
  await blocked.session.replaceText("local")
  await blocked.timers.advance(50)
  await flush()
  const failed = await blocked.session.flush()
  assert.equal(failed.kind, "failed")
  assert.equal(failed.error.category, "permission_denied")
  blocked.session.dispose()
})

test("work session exposes host orchestration extras", async () => {
  const { session, state, timers, conflicts, setDirectText } = setup()
  const started = session.revision
  setDirectText("changed")
  session.noteChange()
  assert.ok(session.revision > started)
  assert.equal(session.dirty, true)
  session.pause()
  await timers.advance(500)
  await flush()
  assert.deepEqual(state.saves, [])
  session.resume()
  await timers.advance(500)
  await flush()
  assert.equal(state.saves.length, 1)
  assert.equal(session.blocked, false)
  assert.equal(session.saving, false)
  assert.equal(session.canRestoreDraft, false)
  assert.equal(session.discardedDraftCount, 0)
  assert.equal(session.handleConflict({ id: "deck-1", details: { disk_hash: hash("c"), current: { source: "disk", source_file: "talk.md" } } }), true)
  assert.equal(conflicts.length, 1)
  session.keepLocalVersion()
  await flush()
  assert.equal(session.conflict, null)
  session.dispose()
})

test("work session extras resolve conflicts and restore drafts", async () => {
  const fixture = setup({ text: "local" })
  const { session, state } = fixture
  session.handleConflict({ id: "deck-1", details: { disk_hash: hash("c"), current: { source: "disk", source_file: "talk.md" } } })
  assert.equal(await session.useDiskVersion(), true)
  assert.equal(fixture.getText(), "disk")
  assert.equal(session.canRestoreDraft, true)
  assert.equal(session.discardedDraftCount, 1)
  assert.equal(await session.restoreDraft(), true)
  assert.equal(fixture.getText(), "local")
  session.dispose()
  void state
})

test("work session flush forces through blocked saves", async () => {
  const { session, state, timers } = setup()
  state.saveImpl = async () => { throw { code: "permission_denied", message: "nope", retryable: false } }
  await session.replaceText("local")
  await timers.advance(50)
  await flush()
  assert.equal(session.blocked, true)
  state.saveImpl = null
  const forced = await session.flush({ force: true })
  assert.equal(forced.kind, "saved")
  assert.equal(session.blocked, false)
  session.dispose()
})

test("work session unsubscribes handlers", async () => {
  const { session, statuses, externals, timers } = setup()
  const extraStatuses = []
  const extraExternals = []
  const offStatus = session.onStatus(status => extraStatuses.push(status.kind))
  const offExternal = session.onExternalChange(snapshot => extraExternals.push(snapshot))
  offStatus()
  offExternal()
  await session.replaceText("new")
  await timers.advance(50)
  await flush()
  assert.deepEqual(extraStatuses, ["clean"])
  assert.deepEqual(extraExternals, [])
  assert.ok(statuses.length > 1)
  assert.ok(externals.length >= 0)
  session.dispose()
})
