import assert from "node:assert/strict"
import test from "node:test"
import { buildNewWorkSource, initialFrontMatter, readStyle } from "../src/index.js"

test("new document source seeds visible theme front matter", () => {
  assert.equal(
    buildNewWorkSource({ kind: "document", title: "Fresh work" }),
    "---\ntheme: match\n---\n# Fresh work\n\n"
  )
})

test("new presentation source seeds the same header", () => {
  assert.equal(
    buildNewWorkSource({ kind: "presentation", title: "Fresh deck" }),
    "---\ntheme: match\n---\n# Fresh deck\n\n"
  )
})

test("explicit workspace default flows into the seed", () => {
  assert.equal(
    buildNewWorkSource({ kind: "document", title: "Themed", theme: "dark" }),
    "---\ntheme: dark\n---\n# Themed\n\n"
  )
})

test("unknown theme falls back to match like Workspace#default_theme", () => {
  assert.equal(
    buildNewWorkSource({ kind: "document", title: "Themed", theme: "nope" }),
    "---\ntheme: match\n---\n# Themed\n\n"
  )
})

test("seeded source parses with editable front matter", () => {
  const source = buildNewWorkSource({ kind: "document", title: "Fresh work" })
  assert.ok(initialFrontMatter(source), "front matter block parses")
  assert.deepEqual(readStyle(source), { theme: "match", typography: "book" })
})

test("titles collapse newlines and surrounding whitespace", () => {
  assert.equal(
    buildNewWorkSource({ kind: "document", title: "  Fresh\nwork  " }),
    "---\ntheme: match\n---\n# Fresh work\n\n"
  )
})

test("kind and title misuse throws", () => {
  assert.throws(() => buildNewWorkSource({ kind: "note", title: "Nope" }), TypeError)
  assert.throws(() => buildNewWorkSource({ kind: "document", title: "   " }), TypeError)
  assert.throws(() => buildNewWorkSource({ kind: null, title: "Nope" }), TypeError)
})
