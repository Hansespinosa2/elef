import assert from "node:assert/strict"
import { readFile } from "node:fs/promises"
import test from "node:test"
import { mergeAuthoringRegistryEntries } from "../src/registry-merge.js"

const builtIns = JSON.parse(await readFile(new URL("../src/default-authoring-registry.json", import.meta.url), "utf8"))

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
