import assert from "node:assert/strict"
import test from "node:test"
import { buildAuthoringEntry, removeAuthoringEntry, upsertAuthoringEntry } from "../src/authoring-settings.js"

test("snippet settings preserve Markdown content and produce the Rails row shape", () => {
  const entry = buildAuthoringEntry("snippets", {
    name: "Research note",
    trigger: "note",
    description: "A reusable note",
    category: "Markdown",
    body: "\n## ${1:Finding}\n\n${2:Evidence}\n"
  }, "personal-note")

  assert.deepEqual(entry, {
    id: "personal-note",
    name: "Research note",
    description: "A reusable note",
    built_in: false,
    trigger: "note",
    category: "Markdown",
    body: "\n## ${1:Finding}\n\n${2:Evidence}\n"
  })
  assert.throws(() => buildAuthoringEntry("snippets", { ...entry, trigger: "Bad Trigger" }, entry.id), /lowercase/)
})

test("math shortcut settings normalize aliases and preserve TeX expansion", () => {
  const entry = buildAuthoringEntry("math_shortcuts", {
    name: "Lambda",
    description: "Greek lambda",
    prefix: "@",
    aliases: "Lambda, lambda L",
    expansion: " \\lambda ${1} "
  }, "personal-lambda")

  assert.deepEqual(entry.aliases, ["lambda", "l"])
  assert.equal(entry.expansion, " \\lambda ${1} ")
  assert.throws(() => buildAuthoringEntry("math_shortcuts", { ...entry, aliases: "invalid.alias" }, entry.id), /valid aliases/)
})

test("authoring entry edits and deletes are immutable and ID-scoped", () => {
  const original = [{ id: "one", name: "Old" }, { id: "two", name: "Keep" }]
  const updated = upsertAuthoringEntry(original, { id: "one", name: "New" })

  assert.deepEqual(original, [{ id: "one", name: "Old" }, { id: "two", name: "Keep" }])
  assert.deepEqual(updated, [{ id: "two", name: "Keep" }, { id: "one", name: "New" }])
  assert.deepEqual(removeAuthoringEntry(updated, "one"), [{ id: "two", name: "Keep" }])
})
