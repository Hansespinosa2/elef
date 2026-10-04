import assert from "node:assert/strict"
import { readFile } from "node:fs/promises"
import test from "node:test"
import { mergeAuthoringRegistryEntries } from "../../../app/javascript/lib/authoring_registry_merge.js"

const builtIns = JSON.parse(await readFile(new URL("../../../app/javascript/data/default_authoring_registry.json", import.meta.url), "utf8"))

test("default authoring entries with the same ID in different namespaces both survive", () => {
  const registry = mergeAuthoringRegistryEntries(builtIns)
  const find = (namespace, trigger) => registry.find(entry => entry.namespace === namespace && entry.trigger === trigger)

  assert.equal(find("/", "bold")?.name, "Bold text")
  assert.equal(find(".", "b")?.name, "Bold")
  assert.equal(find("/", "equation")?.namespace, "/")
  assert.equal(find("@", "equation")?.namespace, "@")
  assert.equal(find("/", "frac")?.namespace, "/")
  assert.equal(find("@", "frac")?.namespace, "@")
  assert.equal(find("/", "sqrt")?.namespace, "/")
  assert.equal(find("@", "sqrt")?.namespace, "@")
  assert.equal(find("/", "sup")?.namespace, "/")
  assert.equal(find("@", "sup")?.namespace, "@")
})

test("custom entries replace only a matching namespace and identity", () => {
  const registry = mergeAuthoringRegistryEntries(builtIns, [
    { id: "default-bold", namespace: "/", trigger: "bold", name: "Custom bold" }
  ])

  assert.equal(registry.find(entry => entry.namespace === "/" && entry.trigger === "bold")?.name, "Custom bold")
  assert.equal(registry.find(entry => entry.namespace === "." && entry.trigger === "b")?.name, "Bold")
})

test("custom Rails-shaped snippet rows are enriched for the source palette", () => {
  const registry = mergeAuthoringRegistryEntries(builtIns, [{
    id: "personal-note",
    name: "Personal note",
    description: "A custom personal note",
    trigger: "note",
    category: "Markdown",
    body: "**${1:note}**",
    built_in: false
  }])
  const note = registry.find(entry => entry.id === "personal-note")

  assert.equal(note.namespace, "/")
  assert.deepEqual(note.contexts, ["source"])
  assert.equal(note.behavior.type, "insert")
  assert.deepEqual(note.behavior.placeholders, [{ position: 1, label: "note" }])
})

test("custom Elef directives retain the web registry argument schema", () => {
  const registry = mergeAuthoringRegistryEntries(builtIns, [{
    id: "personal-align",
    name: "Align",
    description: "Choose a block alignment",
    trigger: "align",
    category: "Elef DSL",
    body: ":::align{${1}}",
    built_in: false
  }])
  const align = registry.find(entry => entry.id === "personal-align")

  assert.equal(align.namespace, ":")
  assert.deepEqual(align.argument_schema.values, [
    ["left", "center", "right", "top", "middle", "bottom"],
    ["top", "middle", "bottom"]
  ])
  assert.deepEqual(align.argument_schema.argument_count, { minimum: 1, maximum: 2 })
})

test("custom Rails-shaped math rows are enriched for the math palette", () => {
  const registry = mergeAuthoringRegistryEntries(builtIns, [], [{
    id: "personal-lambda",
    name: "Lambda",
    description: "The Greek letter lambda",
    prefix: "@",
    aliases: ["lambda"],
    expansion: "\\lambda",
    built_in: false
  }])
  const lambda = registry.find(entry => entry.id === "personal-lambda")

  assert.equal(lambda.namespace, "@")
  assert.equal(lambda.trigger, "lambda")
  assert.deepEqual(lambda.contexts, ["math"])
  assert.equal(lambda.behavior.template, "\\lambda")
})
