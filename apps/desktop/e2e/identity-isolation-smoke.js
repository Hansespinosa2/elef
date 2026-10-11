import { execFileSync, spawnSync } from "node:child_process"
import { randomUUID } from "node:crypto"
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { createDesktopAppEnvironment } from "./desktop-app-environment.js"
import { makeCanonicalScratch } from "./identity-scratch.js"
import { offlineMacAppLauncherScript } from "./offline-macos.js"
import { reserveWebdriverPort } from "./webdriver-port.js"
import { runWdio } from "./wdio-smoke.js"

const e2eRoot = path.dirname(fileURLToPath(import.meta.url))
const repoRoot = path.resolve(e2eRoot, "../../..")

// App-data and D-Bus identity derive from the Tauri identifier baked into
// each binary at build time (see tauri-plugin-single-instance): the Stable
// identity keeps the production identifier, Dev takes the .dev suffix.
const IDENTITY_BUS_NAMES = Object.freeze({
  stable: "org.com_elef_desktop.SingleInstance",
  dev: "org.com_elef_desktop_dev.SingleInstance"
})

function writeIdentityFixture(libraryRoot, profile) {
  const title = `E2E ${profile} identity`
  const workFolder = path.join(libraryRoot, title)
  mkdirSync(workFolder, { recursive: true })
  writeFileSync(path.join(workFolder, "document.md"), `# ${title}\n`)
  writeFileSync(path.join(workFolder, "elef.json"), JSON.stringify({ id: randomUUID(), schema_version: 1 }))
  return workFolder
}

function executableExists(binaryPath) {
  try {
    return existsSync(binaryPath)
  } catch {
    return false
  }
}

function buildIdentityBinary({ config, features, frontend }) {
  execFileSync("npm", ["run", "build", "--prefix", "apps/desktop/frontend"], {
    cwd: repoRoot,
    stdio: "inherit",
    env: { ...process.env, ELEF_E2E_BUILD: "1", ELEF_DESKTOP_PROFILE: frontend }
  })
  const build = spawnSync("npm", [
    "run",
    "tauri:build",
    "--prefix",
    "apps/desktop/frontend",
    "--",
    "--config",
    `src-tauri/${config}`,
    "--features",
    features
  ], { cwd: repoRoot, stdio: "inherit", env: process.env })
  if (build.error) throw build.error
  const binary = process.platform === "win32" ? "elef-desktop.exe" : "elef-desktop"
  const application = path.join(repoRoot, "target", "debug", binary)
  if (build.status !== 0 || !executableExists(application)) {
    throw new Error(`The identity isolation smoke could not build the ${config} desktop binary.`)
  }
  return application
}

async function runIdentityProbe(profile, application, env) {
  const scratch = makeCanonicalScratch(`elef-identity-${profile}-`)
  const home = path.join(scratch, "home")
  const config = path.join(scratch, "config")
  const data = path.join(scratch, "data")
  const cache = path.join(scratch, "cache")
  for (const directory of [home, config, data, cache]) mkdirSync(directory, { recursive: true })
  const isolated = { home, config, data, cache }
  const libraryRoot = path.join(scratch, "library")
  writeIdentityFixture(libraryRoot, profile)

  const statePath = process.platform === "darwin"
    ? path.join(home, "Library", "Application Support")
    : process.platform === "win32"
      ? path.join(home, "AppData", "Roaming")
      : path.join(data, "elef-desktop")
  const probeEnv = {
    ...createDesktopAppEnvironment(env, isolated),
    ELEF_E2E_APP_BINARY: application,
    ELEF_E2E_LIBRARY_ROOT: libraryRoot,
    ELEF_E2E_IDENTITY_EXPECTED_ROOT: libraryRoot,
    ELEF_E2E_IDENTITY_EXPECTED_BUS_NAME: IDENTITY_BUS_NAMES[profile],
    TAURI_WEBDRIVER_PORT: String(await reserveWebdriverPort()),
    ELEF_E2E_PROFILE: "identity"
  }
  if (process.platform === "darwin" && process.env.ELEF_E2E_OFFLINE === "1") {
    const launcher = path.join(e2eRoot, "offline-macos-app.sh")
    writeFileSync(launcher, offlineMacAppLauncherScript(application), { mode: 0o755 })
    probeEnv.ELEF_E2E_REAL_APP_BINARY = application
    probeEnv.ELEF_E2E_APP_BINARY = launcher
  }
  runWdio(probeEnv)
  return { libraryRoot, statePath }
}

export async function runIdentityIsolationSmoke(env) {
  // Each identity needs its own binary: both Tauri builds emit the same
  // target/debug filename, so the Stable binary is copied aside before the
  // Dev build overwrites it, and the probes launch concurrently.
  const binaries = mkdtempSync(path.join(tmpdir(), "elef-identity-binaries-"))
  const stableApplication = process.env.ELEF_E2E_IDENTITY_STABLE_APP_BINARY || (() => {
    const built = buildIdentityBinary({
      config: "tauri.e2e-stable-identity.conf.json",
      features: "webdriver",
      frontend: "stable"
    })
    const copy = path.join(binaries, process.platform === "win32" ? "elef-desktop-stable.exe" : "elef-desktop-stable")
    copyFileSync(built, copy)
    return copy
  })()
  const devApplication = process.env.ELEF_E2E_IDENTITY_DEV_APP_BINARY || buildIdentityBinary({
    config: "tauri.e2e-dev-identity.conf.json",
    features: "desktop-dev,webdriver",
    frontend: "dev"
  })

  const [stable, dev] = await Promise.allSettled([
    runIdentityProbe("stable", stableApplication, env),
    runIdentityProbe("dev", devApplication, env)
  ])
  if (stable.status === "rejected") throw stable.reason
  if (dev.status === "rejected") throw dev.reason
  if (stable.value.statePath === dev.value.statePath) {
    throw new Error("Stable and Dev unexpectedly share an app-data directory")
  }
  if (stable.value.libraryRoot === dev.value.libraryRoot) {
    throw new Error("Stable and Dev unexpectedly share a test library")
  }
  rmSync(binaries, { recursive: true, force: true })
}
