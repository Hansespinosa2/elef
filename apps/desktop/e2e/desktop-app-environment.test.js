import assert from "node:assert/strict"
import test from "node:test"
import { createDesktopAppEnvironment } from "./desktop-app-environment.js"

test("desktop process gets late fixture values while keeping its isolated user directories", () => {
  const environment = createDesktopAppEnvironment({
    HOME: "/home/runner",
    ELEF_E2E_LIBRARY_ROOT: "/tmp/fixture/library",
    ELEF_E2E_DESKTOP_LINKED_DOCUMENT_ID: "linked-id",
    ELEF_E2E_UPDATER_PUBLIC_KEY: "test-public-key"
  }, {
    home: "/tmp/fixture/home",
    config: "/tmp/fixture/config",
    data: "/tmp/fixture/data",
    cache: "/tmp/fixture/cache"
  })

  assert.equal(environment.ELEF_E2E_LIBRARY_ROOT, "/tmp/fixture/library")
  assert.equal(environment.ELEF_E2E_DESKTOP_LINKED_DOCUMENT_ID, "linked-id")
  assert.equal(environment.ELEF_E2E_UPDATER_PUBLIC_KEY, "test-public-key")
  assert.equal(environment.HOME, "/tmp/fixture/home")
  assert.equal(environment.XDG_CONFIG_HOME, "/tmp/fixture/config")
  assert.equal(environment.XDG_DATA_HOME, "/tmp/fixture/data")
  assert.equal(environment.XDG_CACHE_HOME, "/tmp/fixture/cache")
})
