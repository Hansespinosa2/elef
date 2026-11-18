import assert from "node:assert/strict"
import { createHash } from "node:crypto"
import { readFile, readdir } from "node:fs/promises"
import path from "node:path"
import { setTimeout as delay } from "node:timers/promises"
import { $, browser } from "@wdio/globals"
import { answerMacNativeDialog, macTestProcessId, requestMacQuit } from "./mac-native-dialog.js"

// Stable packaged N-1 → N update, macOS only. Linux upgrades through its
// package manager and never self-installs. The runner invokes this spec
// twice against the installed Stable DMG fixture: first to install the
// signed stable-package N, then (ELEF_E2E_VERIFY_STABLE_UPGRADED=1) to verify
// the relaunched N. The app boots without ELEF_E2E_LIBRARY_ROOT so it reads
// the seeded pre-release library-root.json selection from its app data; the
// runner asserts those bytes are preserved across both launches.
const verifyUpgraded = process.env.ELEF_E2E_VERIFY_STABLE_UPGRADED === "1"

async function waitForNativeState(predicate, timeout, message) {
  const deadline = Date.now() + timeout
  while (!await predicate()) {
    if (Date.now() >= deadline) throw new Error(message)
    await delay(100)
  }
}

if (!verifyUpgraded) {
  describe("stable packaged signed update", () => {
    it("installs signed version N through Install on quit despite a repeated quit", async function () {
      this.timeout(180_000)
      assert.equal(process.platform, "darwin", "Stable packaged updates run on macOS only")
      await $("#library-view").waitForDisplayed()
      const binaryPath = process.env.ELEF_E2E_APP_BINARY
      const pid = macTestProcessId()
      const original = createHash("sha256").update(await readFile(binaryPath)).digest("hex")
      const response = await fetch("http://127.0.0.1:8888/mode?value=stable-package")
      if (!response.ok) throw new Error("The Stable packaged update fixture is missing")
      try {
        assert.ok((await fetch("http://127.0.0.1:8888/hold-artifact")).ok)
        await browser.execute(async () => {
          window.focus()
          window.__elefCloseRequests = 0
          await window.__TAURI__.event.listen("tauri://close-requested", () => {
            window.__elefCloseRequests += 1
          })
        })
        await $("#check-for-updates").click()
        answerMacNativeDialog("Install on Quit")
        await browser.waitUntil(async () => {
          const status = await fetch("http://127.0.0.1:8888/artifact-status")
          return (await status.json()).held
        }, { timeout: 30_000, timeoutMsg: "Consent did not start preparing the update" })
        assert.equal(createHash("sha256").update(await readFile(binaryPath)).digest("hex"), original)
        requestMacQuit()
        await browser.execute(() => window.__TAURI__.window.getCurrentWindow().close())
        await browser.waitUntil(() => browser.execute(() => window.__elefCloseRequests >= 2), {
          timeoutMsg: "The repeated native close request was not delivered"
        })
        assert.ok(await $("#library-view").isDisplayed(), "repeated quit must keep the installing window alive")
        assert.ok((await fetch("http://127.0.0.1:8888/release-artifact")).ok)
        // No WebDriver commands after release: this is a real normal quit,
        // not an intercepted relaunch. Inspect the installation and old PID.
        await waitForNativeState(async () => {
          return createHash("sha256").update(await readFile(binaryPath)).digest("hex") !== original
        }, 120_000, "The consented update did not replace the app during quit")
        await waitForNativeState(() => {
          try { process.kill(pid, 0); return false }
          catch (error) { if (error.code === "ESRCH") return true; throw error }
        }, 15_000, "Install on Quit must exit normally without relaunching")
        // The process and its embedded driver exited. WDIO retains a separate
        // session id, so avoid sending DELETE to the stopped driver at teardown.
        browser.overwriteCommand("deleteSession", async () => {})
      } finally {
        await fetch("http://127.0.0.1:8888/release-artifact")
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
