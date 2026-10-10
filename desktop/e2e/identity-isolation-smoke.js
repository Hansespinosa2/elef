import assert from "node:assert/strict"
import { execFileSync, spawn } from "node:child_process"
import { chmod, copyFile, mkdir, readFile, realpath, writeFile } from "node:fs/promises"
import path from "node:path"
import { reserveWebdriverPort } from "./webdriver-port.js"
import { createDesktopAppEnvironment } from "./desktop-app-environment.js"
import { offlineMacAppLauncherScript } from "./offline-macos.js"

const profiles = [
  {
    name: "Stable",
    identifier: "com.elef.desktop",
    features: "webdriver",
    config: "src-tauri/tauri.e2e-stable-identity.conf.json"
  },
  {
    name: "Dev",
    identifier: "com.elef.desktop.dev",
    features: "desktop-dev,webdriver",
    config: "src-tauri/tauri.e2e-dev-identity.conf.json"
  }
]

export async function runIdentityIsolationSmoke({ e2eRoot, repoRoot, env, isolatedDirectories, temporaryRoot }) {
  const appDataRoot = process.platform === "darwin"
    ? path.join(isolatedDirectories.home, "Library", "Application Support")
    : isolatedDirectories.data
  const identityFixtures = []

  for (const profile of profiles) {
    const directory = path.join(temporaryRoot, `identity-${profile.name.toLowerCase()}-library`)
    await mkdir(directory, { recursive: true })
    const libraryRoot = await realpath(directory)
    const appData = path.join(appDataRoot, profile.identifier)
    await mkdir(appData, { recursive: true })
    const statePath = path.join(appData, "library-root.json")
    const state = JSON.stringify({ library_root: libraryRoot })
    await writeFile(statePath, state)
    identityFixtures.push({ ...profile, libraryRoot, statePath, state })
  }

  assert.notEqual(identityFixtures[0].statePath, identityFixtures[1].statePath,
    "Stable and Dev must resolve library-root.json under different app-data identifiers")
  assert.notEqual(identityFixtures[0].libraryRoot, identityFixtures[1].libraryRoot,
    "Stable and Dev identity probes must use separate disposable libraries")

  const binaryPath = path.join(repoRoot, "desktop/target/debug/elef-desktop")
  for (const profile of identityFixtures) {
    const buildEnv = { ...process.env, ELEF_DESKTOP_PROFILE: profile.name.toLowerCase() }
    if (profile.name === "Stable") buildEnv.ELEF_E2E_BUILD = "1"
    else delete buildEnv.ELEF_E2E_BUILD
    execFileSync("npm", ["run", "tauri:build", "--prefix", "desktop/frontend", "--",
      "--debug", "--features", profile.features, "--no-bundle", "--config", profile.config], {
      cwd: repoRoot,
      env: buildEnv,
      stdio: "inherit"
    })
    const probeBinary = path.join(temporaryRoot, `elef-${profile.name.toLowerCase()}-identity-probe`)
    await copyFile(binaryPath, probeBinary)
    await chmod(probeBinary, 0o755)
    profile.binary = probeBinary
  }

  const webdriver = path.join(e2eRoot, "node_modules/.bin/wdio")
  const runProfile = async profile => {
    const appEnv = createDesktopAppEnvironment({
      ...env,
      ELEF_E2E_APP_BINARY: profile.binary,
      ELEF_E2E_IDENTITY_EXPECTED_ROOT: profile.libraryRoot,
      ELEF_E2E_PROFILE: "identity",
      TAURI_WEBDRIVER_PORT: await reserveWebdriverPort()
    }, isolatedDirectories)
    for (const variable of [
      "ELEF_E2E_LIBRARY_ROOT",
      "ELEF_E2E_PACKAGED_UPDATES",
      "ELEF_E2E_VERIFY_UPGRADED",
      "ELEF_E2E_INSTALLED_ARTIFACT",
      "ELEF_E2E_UPDATE_PACKAGE",
      "ELEF_E2E_STABLE_DMG",
      "ELEF_E2E_STABLE_UPDATE_PACKAGE",
      "APPDIR",
      "APPIMAGE"
    ]) delete appEnv[variable]

    if (process.platform === "darwin" && process.env.ELEF_E2E_OFFLINE === "1") {
      const launcher = path.join(temporaryRoot, `launch-${profile.name.toLowerCase()}-offline.sh`)
      await writeFile(launcher, offlineMacAppLauncherScript(profile.binary), { mode: 0o755 })
      await chmod(launcher, 0o755)
      appEnv.ELEF_E2E_APP_BINARY = launcher
    }

    const result = await new Promise((resolve, reject) => {
      const child = spawn(webdriver, ["run", "wdio.conf.js"], {
        cwd: e2eRoot,
        env: appEnv,
        stdio: "inherit"
      })
      child.once("error", reject)
      child.once("exit", (code, signal) => {
        if (code === 0 && !signal) resolve({ code, signal })
        else reject(new Error(`${profile.name} identity probe failed: code=${code}, signal=${signal}`))
      })
    })
    assert.equal(result.code, 0)
  }

  const results = await Promise.allSettled(identityFixtures.map(profile => runProfile(profile)))
  const failures = results.filter(result => result.status === "rejected")
  if (failures.length) throw new AggregateError(failures.map(result => result.reason), "Stable/Dev identity isolation failed")

  for (const profile of identityFixtures) {
    assert.equal(await readFile(profile.statePath, "utf8"), profile.state,
      `${profile.name} must retain its own selected library state after launch`)
  }
}
