import assert from "node:assert/strict"
import { execFileSync, spawnSync } from "node:child_process"
import { mkdir, readFile, writeFile } from "node:fs/promises"
import path from "node:path"
import { randomUUID } from "node:crypto"
import { createDesktopAppEnvironment } from "./desktop-app-environment.js"
import { desktopAppEnvironment } from "./offline-macos.js"
import { reserveWebdriverPort } from "./webdriver-port.js"
import { STABLE_PROFILE_DECK_TITLE, STABLE_PROFILE_KEYBOARD_SOURCE, STABLE_PROFILE_SOURCE } from "./stable-profile-fixture.js"

export async function runStableProfileSmoke({ e2eRoot, repoRoot, libraryRoot, env, isolatedDirectories }) {
  const deckRoot = path.join(libraryRoot, STABLE_PROFILE_DECK_TITLE)
  await mkdir(deckRoot, { recursive: true })
  await writeFile(path.join(deckRoot, "document.md"), STABLE_PROFILE_SOURCE)
  await writeFile(path.join(deckRoot, "elef.json"), JSON.stringify({ id: randomUUID(), schema_version: 1 }))

  execFileSync("npm", ["run", "tauri:build", "--prefix", "desktop/frontend", "--",
    "--debug", "--features", "webdriver", "--no-bundle", "--config", "src-tauri/tauri.e2e-stable.conf.json"], {
    cwd: repoRoot,
    env: { ...process.env, ELEF_E2E_BUILD: "1", ELEF_DESKTOP_PROFILE: "stable" },
    stdio: "inherit"
  })

  const applicationBinary = path.join(repoRoot, "desktop/target/debug/elef-desktop")
  const stableEnv = createDesktopAppEnvironment({
    ...env,
    ELEF_E2E_APP_BINARY: applicationBinary,
    ELEF_E2E_PROFILE: "stable"
  }, isolatedDirectories)
  delete stableEnv.ELEF_E2E_PACKAGED_UPDATES
  delete stableEnv.ELEF_E2E_VERIFY_UPGRADED
  delete stableEnv.ELEF_E2E_INSTALLED_ARTIFACT
  delete stableEnv.ELEF_E2E_UPDATE_PACKAGE
  delete stableEnv.APPDIR
  delete stableEnv.APPIMAGE

  const result = spawnSync(path.join(e2eRoot, "node_modules/.bin/wdio"), ["run", "wdio.conf.js"], {
    cwd: e2eRoot,
    env: {
      ...desktopAppEnvironment(stableEnv),
      TAURI_WEBDRIVER_PORT: await reserveWebdriverPort()
    },
    stdio: "inherit"
  })
  if (result.error) throw result.error
  if (result.status !== 0) throw new Error(`Stable profile exclusion scenarios failed with status ${result.status}`)

  assert.equal(await readFile(path.join(deckRoot, "document.md"), "utf8"), STABLE_PROFILE_KEYBOARD_SOURCE,
    "Stable must round-trip unsupported directives through an edit, save, close and reopen")
}
