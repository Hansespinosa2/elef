import assert from "node:assert/strict"

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
})
