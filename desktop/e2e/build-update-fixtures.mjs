import { execFileSync } from "node:child_process"
import { cp, mkdir, readdir, rm } from "node:fs/promises"
import path from "node:path"
import { fileURLToPath } from "node:url"

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..")
const target = path.join(repo, "desktop/target")
const output = path.join(target, "e2e-packages")
const platform = process.platform
if (!["linux", "darwin"].includes(platform)) throw new Error("Unsupported updater test platform")
await rm(output, { recursive: true, force: true })
await mkdir(output, { recursive: true })

// On macOS, build a Stable-profile N-1 DMG and N updater bundle before the Dev
// fixtures. The update test installs the DMG under an isolated HOME while
// retaining Stable's real identifier and updater path. No production signing
// key, release artifact, or public feed is involved.
if (platform === "darwin") {
  for (const [name, version] of [["n", "0.2.0"], ["n-1", "0.1.0"]]) {
    execFileSync("npm", ["run", "tauri:build", "--prefix", "desktop/frontend", "--",
      "--debug", "--features", "webdriver", "--bundles", name === "n" ? "app" : "app,dmg",
      "--config", "src-tauri/tauri.e2e-stable-updater.conf.json", "--config", JSON.stringify({ version })], {
      cwd: repo,
      env: { ...process.env, ELEF_E2E_BUILD: "1", ELEF_DESKTOP_PROFILE: "stable" },
      stdio: "inherit"
    })
    const folder = path.join(output, `stable-${name}`)
    await mkdir(folder)
    const bundle = path.join(target, "debug/bundle/macos/Elef.app")
    await cp(bundle, path.join(folder, "Elef.app"), { recursive: true, verbatimSymlinks: true })
    if (name === "n") {
      execFileSync("tar", ["-czf", path.join(output, "stable-update.tar.gz"), "-C", folder, "Elef.app"])
    } else {
      const dmgFolder = path.join(target, "debug/bundle/dmg")
      const candidates = (await readdir(dmgFolder)).filter(file => file.includes(`_${version}_`) && file.endsWith(".dmg"))
      if (candidates.length !== 1) throw new Error(`Expected one Stable DMG for ${version}, found ${candidates.length}`)
      await cp(path.join(dmgFolder, candidates[0]), path.join(folder, `Elef-${version}.dmg`))
    }
  }
}

// Build N first, then N-1, leaving the normal debug binary at version N-1.
// Keys are generated later, in memory by the fixture server. No production key
// or release publication is involved in these isolated test packages.
for (const [name, version] of [["n", "0.2.0"], ["n-1", "0.1.0"]]) {
  execFileSync("npm", ["run", "tauri:build", "--prefix", "desktop/frontend", "--",
    "--debug", "--features", "desktop-dev,webdriver", "--bundles", platform === "darwin" ? "app" : "appimage",
    "--config", "src-tauri/tauri.e2e.conf.json", "--config", JSON.stringify({ version })], {
    cwd: repo, env: { ...process.env, ELEF_E2E_BUILD: "1" }, stdio: "inherit"
  })
  const folder = path.join(output, name)
  await mkdir(folder)
  if (platform === "darwin") {
    const bundle = path.join(target, "debug/bundle/macos/Elef E2E.app")
    await cp(bundle, path.join(folder, "Elef.app"), { recursive: true, verbatimSymlinks: true })
    if (name === "n") execFileSync("tar", ["-czf", path.join(output, "update.tar.gz"), "-C", folder, "Elef.app"])
  } else {
    const bundleFolder = path.join(target, "debug/bundle/appimage")
    const candidates = (await readdir(bundleFolder)).filter(file => file.includes(`_${version}_`) && file.endsWith(".AppImage"))
    if (candidates.length !== 1) throw new Error(`Expected one AppImage for ${version}, found ${candidates.length}`)
    await cp(path.join(bundleFolder, candidates[0]), path.join(folder, "Elef.AppImage"))
    if (name === "n") await cp(path.join(folder, "Elef.AppImage"), path.join(output, "update.AppImage"))
  }
}
process.stdout.write("Built isolated 0.1.0 and 0.2.0 updater packages.\n")
