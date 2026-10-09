import assert from "node:assert/strict"
import { execFileSync } from "node:child_process"
import { access, mkdir } from "node:fs/promises"
import path from "node:path"

export async function installMacDmgFixture(dmgPath, installDirectory) {
  if (process.platform !== "darwin") throw new Error("The packaged DMG fixture requires macOS")
  const mountPoint = `${installDirectory}-mount`
  const appOnDisk = path.join(installDirectory, "Elef.app")
  const appOnDmg = path.join(mountPoint, "Elef.app")

  await mkdir(mountPoint, { recursive: true })
  await mkdir(installDirectory, { recursive: true })
  execFileSync("hdiutil", ["verify", dmgPath], { stdio: "inherit" })
  let mounted = false
  try {
    execFileSync("hdiutil", ["attach", "-readonly", "-noautoopen", "-nobrowse", "-mountpoint", mountPoint, dmgPath], {
      stdio: "inherit"
    })
    mounted = true
    await access(appOnDmg)
    execFileSync("ditto", [appOnDmg, appOnDisk], { stdio: "inherit" })
    execFileSync("codesign", ["--verify", "--deep", "--strict", appOnDisk], { stdio: "inherit" })
  } finally {
    if (mounted) {
      try {
        execFileSync("hdiutil", ["detach", mountPoint], { stdio: "ignore" })
      } catch (_error) {
        execFileSync("hdiutil", ["detach", "-force", mountPoint], { stdio: "ignore" })
      }
    }
  }

  const executable = path.join(appOnDisk, "Contents/MacOS/elef-desktop")
  await access(executable)
  const plist = path.join(appOnDisk, "Contents/Info.plist")
  const identifier = execFileSync("/usr/libexec/PlistBuddy", ["-c", "Print :CFBundleIdentifier", plist], {
    encoding: "utf8"
  }).trim()
  const version = execFileSync("/usr/libexec/PlistBuddy", ["-c", "Print :CFBundleShortVersionString", plist], {
    encoding: "utf8"
  }).trim()
  assert.equal(identifier, "com.elef.desktop", "The test DMG must use Stable's production identifier")
  assert.equal(version, "0.1.0", "The test DMG must represent the N-1 Stable version")
  execFileSync("lipo", ["-verify_arch", "arm64", executable], { stdio: "inherit" })
  return executable
}
