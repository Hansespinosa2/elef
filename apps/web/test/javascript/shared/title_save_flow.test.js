import assert from "node:assert/strict"
import test from "node:test"

import { createTitleSaveFlow } from "../../../../../packages/client/src/session/title_save_flow.js"

function harness({ renameDeck = async (id, name) => ({ id, name }) } = {}) {
  let deck = { id: "deck-1", name: "First title" }
  let input = deck.name
  let timer = null
  const calls = []
  const states = []
  const errors = []
  const flow = createTitleSaveFlow({
    getDeck: () => deck,
    getTitle: () => input,
    renameDeck: async (...args) => {
      calls.push(args.map((value, index) => index === 0 ? value.id : value))
      return renameDeck(...args)
    },
    onRenamed: renamed => { deck = { ...deck, ...renamed } },
    onState: (state, detail) => states.push([state, detail]),
    onError: error => errors.push(error),
    setTimer: callback => { timer = callback; return callback },
    clearTimer: value => { if (timer === value) timer = null }
  })
  return {
    flow,
    calls,
    states,
    errors,
    get deck() { return deck },
    set input(value) { input = value },
    runTimer() { const callback = timer; timer = null; callback?.() }
  }
}

test("title autosave debounces edits and persists the latest folder name", async () => {
  const state = harness()
  state.input = "Working title"
  state.flow.noteChange()
  state.input = "Final title"
  state.flow.noteChange()

  assert.equal(state.flow.isDirty(), true)
  state.runTimer()
  await state.flow.flush()

  assert.deepEqual(state.calls, [["deck-1", "Final title"]])
  assert.equal(state.deck.name, "Final title")
  assert.equal(state.flow.isDirty(), false)
  assert.equal(state.errors.length, 0)
})

test("title flush serializes edits made while a folder rename is in flight", async () => {
  let resolveFirst
  let resolveSecond
  const state = harness({
    renameDeck: (deck, name) => {
      const id = deck.id
      return new Promise(resolve => {
        if (name === "First rename") resolveFirst = () => resolve({ id, name })
        else resolveSecond = () => resolve({ id, name })
      })
    }
  })
  state.input = "First rename"
  state.flow.noteChange()
  const flushing = state.flow.flush()
  await new Promise(resolve => setImmediate(resolve))
  state.input = "Latest rename"
  state.flow.noteChange()
  resolveFirst()
  await new Promise(resolve => setImmediate(resolve))
  resolveSecond()
  assert.equal(await flushing, true)

  assert.deepEqual(state.calls, [["deck-1", "First rename"], ["deck-1", "Latest rename"]])
  assert.equal(state.deck.name, "Latest rename")
  assert.equal(state.flow.isDirty(), false)
})

test("failed and empty title saves stay dirty until an explicit correction or retry", async () => {
  const state = harness({ renameDeck: async () => { throw Object.assign(new Error("rename failed"), { code: "io_error", retryable: false }) } })
  state.input = "Unavailable title"
  state.flow.noteChange()
  assert.equal(await state.flow.flush(), false)
  assert.equal(state.flow.isDirty(), true)
  assert.equal(state.flow.isBlocked(), true)
  assert.equal(state.errors[0].code, "io_error")

  state.input = ""
  state.flow.noteChange()
  assert.equal(await state.flow.flush({ force: true }), false)
  assert.equal(state.flow.isBlocked(), true)
  assert.match(state.errors.at(-1).message, /cannot be empty/)
})
