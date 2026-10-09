import { createHash } from "node:crypto"
import { chmod, copyFile, lstat, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises"
import { createReadStream } from "node:fs"
import os from "node:os"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { spawnSync } from "node:child_process"

const moduleDirectory = path.dirname(fileURLToPath(import.meta.url))
const repositoryRoot = path.resolve(moduleDirectory, "../..")
const archPackagingRoot = path.join(repositoryRoot, "desktop/packaging/arch")

export const ARCH_PACKAGE_NAME = "elef-bin"
export const ARCH_PACKAGE_NAMES = Object.freeze(["elef-bin", "elef-desktop-bin"])
export const ARCH_PACKAGE_DEPENDENCIES = Object.freeze([
  "cairo",
  "desktop-file-utils",
  "gdk-pixbuf2",
  "glib2",
  "gtk3",
  "hicolor-icon-theme",
  "libsoup3",
  "pango",
  "shared-mime-info",
  "webkit2gtk-4.1"
])

export function archReleaseAssetUrl(version) {
  validateVersion(version)
  return `https://github.com/Hansespinosa2/elef/releases/download/desktop-v${version}/elef-${version}-x86_64.tar.zst`
}

export async function renderArchPkgbuild({ version, sha256, sourceUrl = archReleaseAssetUrl(version), packageName = ARCH_PACKAGE_NAME, allowLoopback = false }) {
  validateVersion(version)
  validateSha256(sha256)
  validatePackageName(packageName)
  validateSourceUrl(sourceUrl, version, allowLoopback)
  const template = await readFile(path.join(archPackagingRoot, "PKGBUILD.in"), "utf8")
  const rendered = template
    .replaceAll("@PKGNAME@", packageName)
    .replaceAll("@PKGVER@", version)
    .replaceAll("@SHA256@", sha256.toLowerCase())
    .replaceAll("@SOURCE_URL@", sourceUrl)
  if (/@(?:PKGNAME|PKGVER|SHA256|SOURCE_URL)@/.test(rendered)) throw new Error("The Arch PKGBUILD template has unresolved placeholders.")
  return rendered
}

export async function writeArchPkgbuild({ version, sha256, outputPath, sourceUrl, packageName, allowLoopback = false }) {
  if (typeof outputPath !== "string" || outputPath.length === 0) throw new TypeError("An output path is required.")
  const rendered = await renderArchPkgbuild({ version, sha256, sourceUrl, packageName, allowLoopback })
  await mkdir(path.dirname(path.resolve(outputPath)), { recursive: true })
  await writeFile(outputPath, rendered, { mode: 0o644 })
}

export async function packageArchArchive({ version, binaryPath, outputDirectory, buildSha }) {
  validateVersion(version)
  validateBuildSha(buildSha)
  if (typeof binaryPath !== "string" || typeof outputDirectory !== "string") {
    throw new TypeError("A native executable path and output directory are required.")
  }
  const binary = path.resolve(binaryPath)
  const binaryInfo = await lstat(binary)
  if (!binaryInfo.isFile() || binaryInfo.isSymbolicLink() || (binaryInfo.mode & 0o111) === 0) {
    throw new Error("The Arch package input must be a regular executable file.")
  }

  const output = path.resolve(outputDirectory)
  await mkdir(output, { recursive: true })
  const archiveName = `elef-${version}-x86_64.tar.zst`
  const archivePath = path.join(output, archiveName)
  const temporaryRoot = await mkdtemp(path.join(os.tmpdir(), "elef-arch-package-"))
  const stagingRoot = path.join(temporaryRoot, "root")
  const userBinary = path.join(stagingRoot, "usr/bin/elef")
  const userShare = path.join(stagingRoot, "usr/share")
  try {
    await Promise.all([
      mkdir(path.dirname(userBinary), { recursive: true }),
      mkdir(path.join(userShare, "applications"), { recursive: true }),
      mkdir(path.join(userShare, "icons/hicolor/512x512/apps"), { recursive: true }),
      mkdir(path.join(userShare, "mime/packages"), { recursive: true }),
      mkdir(path.join(userShare, "licenses/elef-bin"), { recursive: true }),
      mkdir(path.join(userShare, "elef"), { recursive: true })
    ])
    await copyFile(binary, userBinary)
    await chmod(userBinary, 0o755)
    await copyFile(path.join(archPackagingRoot, "elef.desktop"), path.join(userShare, "applications/elef.desktop"))
    await copyFile(path.join(archPackagingRoot, "elef.xml"), path.join(userShare, "mime/packages/elef.xml"))
    await copyFile(path.join(repositoryRoot, "desktop/src-tauri/icons/icon.png"), path.join(userShare, "icons/hicolor/512x512/apps/elef.png"))
    await copyFile(path.join(repositoryRoot, "LICENSE"), path.join(userShare, "licenses/elef-bin/LICENSE"))
    await writeFile(path.join(userShare, "elef/version.json"), `${JSON.stringify({
      version,
      build_sha: buildSha.toLowerCase(),
      profile: "stable",
      platform: "linux",
      architecture: "x86_64"
    }, null, 2)}\n`, { mode: 0o644 })

    const tar = spawnSync("tar", [
      "--create",
      `--file=${archivePath}`,
      "--zstd",
      "--sort=name",
      "--mtime=@0",
      "--owner=0",
      "--group=0",
      "--numeric-owner",
      "--format=ustar",
      "--directory",
      stagingRoot,
      "usr"
    ], { encoding: "utf8" })
    if (tar.error) throw tar.error
    if (tar.status !== 0) throw new Error(`Could not create the Arch package archive: ${tar.stderr || tar.stdout}`)

    const sha256 = await hashFile(archivePath)
    await writeFile(`${archivePath}.sha256`, `${sha256}  ${archiveName}\n`, { mode: 0o644 })
    await writeFile(`${archivePath}.provenance.json`, `${JSON.stringify({
      schema_version: 1,
      version,
      main_sha: buildSha.toLowerCase(),
      platform: "linux",
      architecture: "x86_64",
      archive: archiveName,
      sha256
    }, null, 2)}\n`, { mode: 0o644 })
    return { archivePath, archiveName, sha256 }
  } finally {
    await rm(temporaryRoot, { recursive: true, force: true })
  }
}

function validateVersion(version) {
  if (typeof version !== "string" || !/^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/.test(version)) {
    throw new TypeError("Arch package versions must be numeric semantic versions such as 0.1.0.")
  }
}

function validatePackageName(packageName) {
  if (!ARCH_PACKAGE_NAMES.includes(packageName)) throw new TypeError("AUR package name must be elef-bin or elef-desktop-bin.")
}

function validateSha256(sha256) {
  if (typeof sha256 !== "string" || !/^[\da-f]{64}$/i.test(sha256)) throw new TypeError("An exact 64-character SHA-256 is required.")
}

function validateBuildSha(buildSha) {
  if (typeof buildSha !== "string" || !/^[\da-f]{40,64}$/i.test(buildSha)) throw new TypeError("An exact source commit SHA is required.")
}

function validateSourceUrl(sourceUrl, version, allowLoopback) {
  let parsed
  try {
    parsed = new URL(sourceUrl)
  } catch (_error) {
    throw new TypeError("The Arch package source must be a valid URL.")
  }
  if (parsed.username || parsed.password || parsed.search || parsed.hash) throw new TypeError("Arch package URLs cannot contain credentials, query parameters, or fragments.")
  if (sourceUrl === archReleaseAssetUrl(version)) return
  const localName = `elef-${version}-x86_64.tar.zst`
  const port = Number(parsed.port)
  if (allowLoopback && parsed.protocol === "http:" && parsed.hostname === "127.0.0.1" && port >= 1024 && port <= 65535 && parsed.pathname === `/${localName}`) return
  throw new TypeError("Production Arch package sources must use the immutable GitHub asset URL; tests may use a loopback-only URL.")
}

async function hashFile(filename) {
  const hash = createHash("sha256")
  for await (const chunk of createReadStream(filename)) hash.update(chunk)
  return hash.digest("hex")
}
