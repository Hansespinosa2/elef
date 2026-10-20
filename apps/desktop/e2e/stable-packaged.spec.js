import assert from "node:assert/strict"
import { createHash } from "node:crypto"
import { readFile, readdir } from "node:fs/promises"
import path from "node:path"
import { $, browser } from "@wdio/globals"
import { answerMacNativeDialog } from "./mac-native-dialog.js"

// Stable packaged N-1 → N update, macOS only. Linux upgrades through its
// package manager and never self-installs. The runner invokes this spec
// twice against the installed Stable DMG fixture: first to install the
// signed stable-package N, then (ELEF_E2E_VERIFY_STABLE_UPGRADED=1) to verify
// the relaunched N. The app boots without ELEF_E2E_LIBRARY_ROOT so it reads
// the seeded pre-release library-root.json selection from its app data; the
// runner asserts those bytes are preserved across both launches.
const verifyUpgraded = process.env.ELEF_E2E_VERIFY_STABLE_UPGRADED === "1"

if (!verifyUpgraded) {
  describe("stable packaged signed update", () => {
    it("installs signed version N into the Stable test installation", async function () {
      this.timeout(180_000)
      assert.equal(process.platform, "darwin", "Stable packaged updates run on macOS only")
      await $("#library-view").waitForDisplayed()
      const binaryPath = process.env.ELEF_E2E_APP_BINARY
      const original = createHash("sha256").update(await readFile(binaryPath)).digest("hex")
      const response = await fetch("http://127.0.0.1:8888/mode?value=stable-package")
      if (!response.ok) throw new Error("The Stable packaged update fixture is missing")
      try {
        await browser.execute(() => {
          window.focus()
          window.__elefStableUpdateInstallation = window.__TAURI__.core.invoke("install_update", {
            version: "0.2.0", onProgress: new window.__TAURI__.core.Channel()
          }).then(installed => ({ installed })).catch(error => ({ rejection: error.message || String(error) }))
        })
        answerMacNativeDialog("OK")
        const installed = await browser.execute(async () => await window.__elefStableUpdateInstallation)
        if (installed.installed !== true) throw new Error(`The signed Stable package did not install: ${JSON.stringify(installed)}`)
        const replaced = createHash("sha256").update(await readFile(binaryPath)).digest("hex")
        if (replaced === original) throw new Error("The signed Stable update did not replace the installed application")
        if (!(await $("#back-to-library").isExisting())) throw new Error("The application stopped responding after Stable installation")
      } finally {
        const reset = await fetch("http://127.0.0.1:8888/mode?value=none")
        if (!reset.ok) throw new Error("The Stable updater fixture did not reset")
      }
    })
  })
} else {
  describe("stable installed signed update", () => {
    it("launches Stable version N with its installation backup cleaned", async () => {
      await $("#library-view").waitForDisplayed()
      let readiness
      try {
        await browser.waitUntil(async () => {
          readiness = await browser.execute(() => ({
            nativeReadyAt: window.__elefPerformanceTestHooks?.nativeReadyAt,
            previousInstallationsRemoved: window.__elefPerformanceTestHooks?.previousInstallationsRemoved
          }))
          return Boolean(readiness.nativeReadyAt)
        }, { timeout: 15_000, timeoutMsg: "The Stable replacement did not acknowledge editor readiness" })
      } catch (error) {
        throw new Error(`${error.message}; readiness: ${JSON.stringify(readiness)}`)
      }
      const version = await browser.execute(() => window.__TAURI__.core.invoke("plugin:app|version"))
      assert.equal(version, "0.2.0")
      const binary = process.env.ELEF_E2E_APP_BINARY
      const installationParent = path.dirname(path.resolve(binary, "../../../"))
      try {
        await browser.waitUntil(async () => {
          const entries = await readdir(installationParent)
          return !entries.some(name => name.startsWith(".elef-update-"))
        }, { timeout: 10_000, timeoutMsg: "The Stable replacement did not clean its previous installation backup" })
      } catch (error) {
        const remaining = (await readdir(installationParent)).filter(name => name.startsWith(".elef-update-"))
        throw new Error(`${error.message}; remaining backups in ${installationParent}: ${remaining.join("; ") || "none"}`)
      }
      assert.equal(readiness.previousInstallationsRemoved, 1,
        `The ready handshake should remove the prior Stable installation: ${JSON.stringify(readiness)}`)
      const exported = await browser.execute(() => window.__TAURI__.core.invoke("export_diagnostics_fixture"))
      assert.equal(exported, true, "packaged Stable should export diagnostics after the update")
    })
  })
}
