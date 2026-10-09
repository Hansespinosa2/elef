import path from "node:path"
import { fileURLToPath } from "node:url"

const e2eRoot = path.dirname(fileURLToPath(import.meta.url))
const repoRoot = path.resolve(e2eRoot, "../../..")
const application = process.env.ELEF_E2E_APP_BINARY
  || path.join(repoRoot, "target", "debug", process.platform === "win32" ? "elef-desktop.exe" : "elef-desktop")
const port = Number(process.env.TAURI_WEBDRIVER_PORT || "4445")

export const config = {
  runner: "local",
  specs: [process.env.ELEF_E2E_VERIFY_UPGRADED === "1" ? "./specs/upgraded.spec.js" : "./specs/desktop.spec.js", "./specs/contract-conformance.spec.js", "./specs/quiet-save.spec.js", "./specs/renderer-worker-corpus.spec.js"],
  maxInstances: 1,
  capabilities: [{
    browserName: "tauri",
    "wdio:tauriServiceOptions": { windowLabel: "main" }
  }],
  services: [[
    "@wdio/tauri-service",
    {
      appBinaryPath: application,
      autoInstallTauriDriver: false,
      driverProvider: "embedded",
      embeddedPort: port,
      startTimeout: 60_000,
      captureBackendLogs: true,
      captureFrontendLogs: true
    }
  ]],
  framework: "mocha",
  mochaOpts: { ui: "bdd", timeout: 60_000 },
  reporters: ["spec"],
  waitforTimeout: 10_000,
  connectionRetryTimeout: 90_000,
  connectionRetryCount: 1,
  logLevel: "warn",
  baseUrl: "http://127.0.0.1:" + port,
  specFileRetries: 0
}
