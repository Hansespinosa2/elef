import assert from "node:assert/strict"
import { $, browser } from "@wdio/globals"

describe("installed signed update", () => {
  it("launches version N from the original installation path with the saved deck intact", async () => {
    await $("#library-view").waitForDisplayed()
    const result = await browser.execute(async id => ({
      version: await window.__TAURI__.core.invoke("plugin:app|version"),
      source: (await window.__TAURI__.core.invoke("open_deck", { id })).source
    }), process.env.ELEF_E2E_SEED_DECK_ID)
    assert.equal(result.version, "0.2.0")
    assert.match(result.source, /^# Saved by shared scenario\n/)
    assert.match(result.source, /The visual editor changed this text\./)
  })
})
