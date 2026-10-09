import assert from "node:assert/strict"
import test from "node:test"
import { createPlaywrightConfig } from "./playwright.config.js"

test("web E2E can start an isolated Rails server on a configured port", () => {
  const config = createPlaywrightConfig({ ELEF_E2E_START_WEB_SERVER: "1", ELEF_E2E_WEB_PORT: "43127" })

  assert.equal(config.use.baseURL, "http://127.0.0.1:43127")
  assert.equal(config.webServer.url, "http://127.0.0.1:43127/up")
  assert.match(config.webServer.command, /-p 43127$/)
  assert.equal(config.webServer.reuseExistingServer, false)
})

test("web E2E preserves an explicitly supplied endpoint", () => {
  const config = createPlaywrightConfig({
    ELEF_E2E_WEB_PORT: "43128",
    ELEF_E2E_WEB_URL: "http://127.0.0.1:43129"
  })

  assert.equal(config.use.baseURL, "http://127.0.0.1:43129")
  assert.equal(config.webServer, undefined)
})

test("web E2E rejects invalid configured ports", () => {
  assert.throws(() => createPlaywrightConfig({ ELEF_E2E_WEB_PORT: "3000;echo unsafe" }), /valid TCP port/)
  assert.throws(() => createPlaywrightConfig({ ELEF_E2E_WEB_PORT: "65536" }), /valid TCP port/)
})
