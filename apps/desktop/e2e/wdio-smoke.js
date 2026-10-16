import { spawnSync } from "node:child_process"
import path from "node:path"
import { fileURLToPath } from "node:url"

// Shared WebDriver entry for the profile smokes: runs the wdio CLI in this
// directory with the smoke's environment. ELEF_E2E_PROFILE in that
// environment selects the spec file through wdio.conf.js.
export function runWdio(env) {
  const e2eRoot = path.dirname(fileURLToPath(import.meta.url))
  const webdriverio = path.join(e2eRoot, "node_modules", ".bin", "wdio")
  const result = spawnSync(webdriverio, ["run", "wdio.conf.js"], {
    cwd: e2eRoot,
    env,
    stdio: "inherit"
  })
  if (result.error) throw result.error
  if (result.status !== 0) {
    throw new Error(`WebDriver ${env.ELEF_E2E_PROFILE} profile run failed with exit code ${result.status}.`)
  }
}
