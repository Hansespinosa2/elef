import assert from "node:assert/strict"
import test from "node:test"
import { readWebdriverValue, webdriverElementPath } from "./webdriver-port.js"

test("WebDriver element endpoints include the active session", () => {
  assert.equal(webdriverElementPath("session id"), "/session/session%20id/element")
  assert.equal(webdriverElementPath("session id", "element id"), "/session/session%20id/element/element%20id/value")
})

test("WebDriver response parsing accepts successful commands with no response body", async () => {
  assert.equal(await readWebdriverValue(new Response(null, { status: 204 })), undefined)
})

test("WebDriver response parsing returns JSON command values", async () => {
  assert.deepEqual(await readWebdriverValue(Response.json({ value: { accepted: true } })), { accepted: true })
})

test("WebDriver response parsing reports HTTP failures without JSON bodies", async () => {
  await assert.rejects(readWebdriverValue(new Response(null, { status: 500 })), /Driver HTTP 500/)
})

test("WebDriver response parsing reports structured protocol errors", async () => {
  await assert.rejects(readWebdriverValue(Response.json({
    value: { error: "element not interactable", message: "Editor cannot receive keys" }
  }, { status: 400 })), /Editor cannot receive keys/)
})
