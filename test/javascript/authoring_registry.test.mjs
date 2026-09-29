import assert from "node:assert/strict"
import test from "node:test"
import { readFile } from "node:fs/promises"

const source = await readFile(new URL("../../app/javascript/controllers/authoring_registry.js", import.meta.url), "utf8")
const registryModule = await import(`data:text/javascript;base64,${Buffer.from(source).toString("base64")}`)

test("both palettes can share one cached editor registry", () => {
  const entries = [{ id: "align", namespace: ":", trigger: "align" }, { id: "alpha", namespace: "@", trigger: "a" }]
  const element = { dataset: { authoringRegistry: JSON.stringify(entries) } }
  const first = registryModule.authoringRegistryFor(element)
  element.dataset.authoringRegistry = "[]"
  const second = registryModule.authoringRegistryFor(element)
  assert.deepEqual(first, entries)
  assert.equal(second, first)
})

test("malformed registry data leaves assistance safely empty", () => {
  assert.deepEqual(registryModule.authoringRegistryFor({ dataset: { authoringRegistry: "{" } }), [])
})
