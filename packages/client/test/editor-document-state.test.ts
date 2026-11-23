import { test } from "node:test"
import assert from "node:assert/strict"
import { Text } from "@codemirror/state"
import { diffDocumentText } from "../src/features/editor/document_state.js"

test("canonical source changes preserve untouched mixed line endings", () => {
  const current = Text.of(["# Notes", "", "Body\rcontinued"])
  const next = Text.of(["# Notes", "", "Updated body\rcontinued"])
  const change = diffDocumentText(current, next)
  assert.ok(change)
  assert.deepEqual({ from: change.from, to: change.to }, { from: 9, to: 10 })
  assert.ok(current.replace(change.from, change.to, change.insert).eq(next))
  assert.equal(diffDocumentText(next, next), null)
})

test("canonical diffs retain the distinction between literal and structural line breaks", () => {
  const current = Text.of(["a\nb", "c"])
  const next = Text.of(["a", "b\nc"])
  assert.equal(current.toString(), next.toString())
  const change = diffDocumentText(current, next)
  assert.ok(change)
  assert.ok(current.replace(change.from, change.to, change.insert).eq(next))
})
