import assert from "node:assert/strict"
import { $, browser } from "@wdio/globals"
import { lstat, readFile, readdir } from "node:fs/promises"
import path from "node:path"

describe("installed signed update", () => {
  it("launches version N from the original installation path with the saved deck intact", async () => {
    await $("#library-view").waitForDisplayed()
    let readiness
    try {
      await browser.waitUntil(async () => {
        readiness = await browser.execute(() => ({
          nativeReadyAt: window.__elefPerformanceTestHooks?.nativeReadyAt,
          previousInstallationsRemoved: window.__elefPerformanceTestHooks?.previousInstallationsRemoved,
          bootstrapStages: window.__elefPerformanceTestHooks?.bootstrapStages?.()
        }))
        return Boolean(readiness.nativeReadyAt)
      }, { timeout: 15_000, timeoutMsg: "The replacement did not acknowledge editor readiness" })
    } catch (error) {
      throw new Error(`${error.message}; readiness: ${JSON.stringify(readiness)}`)
    }
    const result = await browser.execute(async id => ({
      version: await window.__TAURI__.core.invoke("plugin:app|version"),
      source: (await window.__TAURI__.core.invoke("open_deck", { id })).source
    }), process.env.ELEF_E2E_SEED_DECK_ID)
    assert.equal(result.version, "0.2.0")
    assert.match(result.source, /^# Saved by shared scenario\n/)
    assert.match(result.source, /The visual editor changed this text\./)
    const binary = process.env.ELEF_E2E_APP_BINARY
    const liveInstallation = process.platform === "darwin"
      ? path.resolve(binary, "../../../") : process.env.ELEF_E2E_INSTALLED_ARTIFACT
    const installationParent = path.dirname(liveInstallation)
    try {
      await browser.waitUntil(async () => {
        const entries = await readdir(installationParent)
        return !entries.some(name => name.startsWith(".elef-update-"))
      }, { timeout: 10_000, timeoutMsg: "The launched replacement did not clean its previous installation backup" })
    } catch (error) {
      const remaining = (await readdir(installationParent)).filter(name => name.startsWith(".elef-update-"))
      const diagnostics = await Promise.all(remaining.map(async name => {
        const directory = path.join(installationParent, name)
        try {
          const backupMetadata = await lstat(directory)
          const receipt = JSON.parse(await readFile(path.join(directory, "activation.json"), "utf8"))
          const locations = [
            ["live", receipt.live],
            ["previous", path.join(directory, path.basename(receipt.live))]
          ]
          const identities = await Promise.all(locations.map(async ([label, location]) => {
            try {
              const metadata = await lstat(location)
              return { label, path: location, device: metadata.dev, inode: metadata.ino, uid: metadata.uid, mode: metadata.mode }
            } catch (failure) {
              return { label, path: location, error: failure.code }
            }
          }))
          return JSON.stringify({ name, backup: { uid: backupMetadata.uid, mode: backupMetadata.mode }, receipt, identities })
        } catch (failure) {
          return `${name}: ${failure.code || failure.message}`
        }
      }))
      throw new Error(`${error.message}; readiness: ${JSON.stringify(readiness)}; remaining backups in ${installationParent}: ${diagnostics.join("; ") || "none"}`)
    }
    assert.equal(readiness.previousInstallationsRemoved, 1,
      `The ready handshake should remove the prior installation: ${JSON.stringify(readiness)}`)
  })
})
