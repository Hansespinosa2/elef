import assert from "node:assert/strict"
import { execFileSync } from "node:child_process"
import { browser } from "@wdio/globals"

describe("Stable and Dev app identity isolation", () => {
  it("opens only the selected library stored for this app identity", async () => {
    const expectedRoot = process.env.ELEF_E2E_IDENTITY_EXPECTED_ROOT
    assert.ok(expectedRoot, "the identity probe must receive its disposable expected library root")

    await browser.waitUntil(async () => {
      const status = await browser.execute(async () => {
        return await window.__TAURI__.core.invoke("get_library_status")
      })
      return status?.root === expectedRoot
    }, {
      timeout: 30_000,
      interval: 250,
      timeoutMsg: "The app did not restore the library-root.json under its own app-data identifier"
    })

    const status = await browser.execute(async () => {
      return await window.__TAURI__.core.invoke("get_library_status")
    })
    assert.equal(status.root, expectedRoot)
  })

  it("registers its Linux single-instance bus name under its own identifier", async () => {
    if (process.platform !== "linux") return
    const expectedBusName = process.env.ELEF_E2E_IDENTITY_EXPECTED_BUS_NAME
    assert.ok(expectedBusName, "the identity probe must receive its expected D-Bus name")
    const busNames = execFileSync("busctl", ["--user", "list", "--no-legend"], { encoding: "utf8" })
    const owner = busNames
      .split("\n")
      .map(line => line.trim().split(/\s+/)[0])
      .find(name => name === expectedBusName)
    assert.ok(owner, `The ${expectedBusName} single-instance name is not registered: ${busNames}`)
  })
})
