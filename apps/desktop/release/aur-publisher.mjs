import { createHash } from "node:crypto"
import { readFile, writeFile } from "node:fs/promises"
import { spawnSync } from "node:child_process"
import path from "node:path"

import { ARCH_PACKAGE_NAME, ARCH_PACKAGE_NAMES } from "./arch-package.mjs"

const VERSION_PATTERN = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/

// Tag-flow AUR publication (no ledger): the version comes from the release
// tag, the source SHA from the Release API at publish time, and the package
// name is rechecked against the AUR registry on every run and recorded in
// the release notes. Git synchronization, never-downgrade, and idempotency
// below are the ledger-free core of the reviewed publisher.
export function parseReleaseTag(tag) {
  const version = /^desktop-v((0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*))$/.exec(tag)?.[1]
  if (!version) throw new TypeError("AUR publication needs a stable release tag such as desktop-v0.1.0.")
  return { tag, version }
}

export async function verifyPublishedLinuxArtifact({ version, release, fetchImpl = fetch }) {
  if (!VERSION_PATTERN.test(version)) throw new TypeError("AUR validation needs a numeric semantic version.")
  if (!release || release.tag_name !== `desktop-v${version}`) {
    throw new TypeError("AUR validation needs the public GitHub Release for its tag.")
  }
  if (release.draft || release.prerelease) throw new Error("AUR publishing requires the immutable GitHub Release to be public.")
  const mainSha = release.target_commitish
  if (typeof mainSha !== "string" || !/^[a-f\d]{40}$/i.test(mainSha)) {
    throw new Error("The public GitHub Release does not identify its source commit.")
  }
  const archiveName = `elef-${version}-x86_64.tar.zst`
  const checksumName = `${archiveName}.sha256`
  const provenanceName = `${archiveName}.provenance.json`
  const archive = uniqueAsset(release, archiveName)
  const checksum = uniqueAsset(release, checksumName)
  const provenance = uniqueAsset(release, provenanceName)

  const archiveBytes = await downloadReleaseBytes(archive, fetchImpl, 512 * 1024 * 1024)
  const sha256 = createHash("sha256").update(archiveBytes).digest("hex")
  const [checksumText, provenanceText] = await Promise.all([
    downloadReleaseText(checksum, fetchImpl),
    downloadReleaseText(provenance, fetchImpl)
  ])
  const checksumMatch = /^([a-f\d]{64})\s+\*?([^\r\n]+)\s*$/i.exec(checksumText)
  if (!checksumMatch || checksumMatch[1].toLowerCase() !== sha256 || checksumMatch[2] !== archiveName) {
    throw new Error("public Linux SHA-256 sidecar does not match the published archive")
  }
  let proof
  try {
    proof = JSON.parse(provenanceText)
  } catch {
    throw new Error("public Linux provenance sidecar is invalid")
  }
  if (proof.version !== version || proof.main_sha !== mainSha.toLowerCase() || proof.sha256 !== sha256 ||
    proof.platform !== "linux" || proof.architecture !== "x86_64" || proof.archive !== archiveName) {
    throw new Error("public Linux provenance does not match the published source and archive")
  }
  return {
    version,
    tag: `desktop-v${version}`,
    mainSha: mainSha.toLowerCase(),
    archiveName,
    checksumName,
    provenanceName,
    assetUrl: archive.browser_download_url,
    sha256
  }
}

export async function selectAurPackageName({ maintainer, fetchImpl = fetch } = {}) {
  if (typeof maintainer !== "string" || !/^[A-Za-z0-9_-]{1,64}$/.test(maintainer)) {
    throw new TypeError("AUR package selection needs the configured AUR account name")
  }
  for (const packageName of ARCH_PACKAGE_NAMES) {
    const info = await aurPackageInfo(packageName, fetchImpl)
    if (!info || info.Maintainer === maintainer) return packageName
  }
  throw new Error("both approved Elef AUR package names are occupied by other maintainers")
}

export const AUR_RELEASE_NOTES_MARKER = "<!-- elef-aur-package -->"

export function renderAurReleaseNotes({ body, packageName, version, pkgrel }) {
  if (!ARCH_PACKAGE_NAMES.includes(packageName)) throw new TypeError("AUR package name is not approved")
  if (!VERSION_PATTERN.test(version) || !Number.isInteger(pkgrel) || pkgrel < 1) {
    throw new TypeError("AUR release notes need the published version and pkgrel")
  }
  const line = `- AUR package: \`${packageName}\` \`${version}-${pkgrel}\` ${AUR_RELEASE_NOTES_MARKER}`
  const existing = `${body || ""}`
  if (existing.includes(AUR_RELEASE_NOTES_MARKER)) {
    return existing.replace(/^.*elef-aur-package -->.*$/m, line)
  }
  return `${existing}${existing.endsWith("\n") || existing === "" ? "" : "\n"}\n${line}\n`
}

export function validateAurSrcInfo(serialized, metadata) {
  const packageName = metadata.package_name || ARCH_PACKAGE_NAME
  if (!ARCH_PACKAGE_NAMES.includes(packageName)) throw new TypeError("AUR .SRCINFO package name is not approved")
  const fields = new Map()
  for (const line of serialized.split(/\r?\n/)) {
    const match = /^\s*([a-z][a-z0-9_-]*)\s*=\s*(.*?)\s*$/.exec(line)
    if (!match) continue
    const values = fields.get(match[1]) || []
    values.push(match[2])
    fields.set(match[1], values)
  }
  const one = key => {
    const values = fields.get(key) || []
    if (values.length !== 1) throw new Error(`generated .SRCINFO must contain exactly one ${key}`)
    return values[0]
  }
  if (one("pkgbase") !== packageName || one("pkgname") !== packageName) throw new Error("generated .SRCINFO package name does not match its selected AUR name")
  if (one("pkgver") !== metadata.version || one("pkgrel") !== String(metadata.pkgrel)) throw new Error("generated .SRCINFO version does not match the reserved release")
  if (one("arch") !== "x86_64") throw new Error("generated .SRCINFO must target only x86_64")
  if (one("source") !== `${metadata.filename}::${metadata.asset_url}`) throw new Error("generated .SRCINFO does not use exactly the immutable Linux release asset")
  if (one("sha256sums") !== metadata.asset_sha256) throw new Error("generated .SRCINFO checksum does not match the validated GitHub asset")
  return true
}

export async function synchronizeAurCheckout({ checkoutPath, files, version, pkgrel, packageName = ARCH_PACKAGE_NAME, beforePush, git = runGit, maxAttempts = 3 }) {
  if (!checkoutPath || !files || !VERSION_PATTERN.test(version) || !Number.isInteger(pkgrel) || pkgrel < 1 || typeof beforePush !== "function") {
    throw new TypeError("AUR synchronization requires a checkout, package files, version, pkgrel, and a pre-push eligibility check")
  }
  if (!ARCH_PACKAGE_NAMES.includes(packageName)) throw new TypeError("AUR package name is not approved")
  for (const name of ["PKGBUILD", ".SRCINFO", `${packageName}.install`]) {
    if (typeof files[name] !== "string") throw new TypeError(`AUR synchronization is missing ${name}`)
  }
  validateAurSrcInfo(files[".SRCINFO"], {
    package_name: packageName,
    version,
    pkgrel,
    filename: `elef-${version}-x86_64.tar.zst`,
    asset_url: `https://github.com/Hansespinosa2/elef/releases/download/desktop-v${version}/elef-${version}-x86_64.tar.zst`,
    asset_sha256: readSrcInfoChecksum(files[".SRCINFO"])
  })

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    const fetched = await git(checkoutPath, ["fetch", "--no-tags", "origin", "master"])
    if (fetched.status !== 0) {
      const remote = await git(checkoutPath, ["ls-remote", "--heads", "origin", "master"])
      if (remote.status !== 0 || remote.stdout.trim()) throw new Error("could not refresh AUR master before publishing")
      const orphan = await git(checkoutPath, ["checkout", "--orphan", "master"])
      if (orphan.status !== 0) throw new Error("could not initialize the first AUR package revision")
      const clean = await git(checkoutPath, ["rm", "-rf", "."])
      if (clean.status !== 0 && clean.status !== 128) throw new Error("could not clear the empty AUR package checkout")
    } else {
      const reset = await git(checkoutPath, ["checkout", "-B", "master", "FETCH_HEAD"])
      if (reset.status !== 0) throw new Error("could not fast-forward the AUR package checkout")
    }

    const currentFiles = await readCurrentFiles(checkoutPath, packageName)
    if (currentFiles.srcinfo) {
      const currentVersion = oneSrcInfoField(currentFiles.srcinfo, "pkgver")
      const currentPkgrel = Number(oneSrcInfoField(currentFiles.srcinfo, "pkgrel"))
      const order = compareVersions(currentVersion, version)
      if (order > 0 || (order === 0 && currentPkgrel > pkgrel)) {
        throw new Error(`refusing to publish ${version}-${pkgrel} over newer AUR version ${currentVersion}-${currentPkgrel}`)
      }
      if (order === 0 && currentPkgrel === pkgrel) {
        if (currentFiles.PKGBUILD !== files.PKGBUILD || currentFiles[".SRCINFO"] !== files[".SRCINFO"] || currentFiles.install !== files[`${packageName}.install`]) {
          throw new Error(`AUR version ${version}-${pkgrel} already exists with different immutable package metadata`)
        }
        return { changed: false, commit: await currentCommit(checkoutPath, git) }
      }
    }

    await Promise.all([
      writeFile(path.join(checkoutPath, "PKGBUILD"), files.PKGBUILD, { mode: 0o644 }),
      writeFile(path.join(checkoutPath, ".SRCINFO"), files[".SRCINFO"], { mode: 0o644 }),
      writeFile(path.join(checkoutPath, `${packageName}.install`), files[`${packageName}.install`], { mode: 0o644 })
    ])
    const add = await git(checkoutPath, ["add", "PKGBUILD", ".SRCINFO", `${packageName}.install`])
    if (add.status !== 0) throw new Error("could not stage the generated AUR package metadata")
    const commit = await git(checkoutPath, ["commit", "-m", `${packageName} ${version}-${pkgrel}`])
    if (commit.status !== 0) throw new Error("could not create the AUR package update commit")

    await beforePush()
    const pushed = await git(checkoutPath, ["push", "origin", "HEAD:master"])
    if (pushed.status === 0) return { changed: true, commit: await currentCommit(checkoutPath, git) }
    if (attempt === maxAttempts) throw new Error("AUR push failed after refreshing and retrying the remote branch")
  }
  throw new Error("AUR publication retry limit was exhausted")
}

export async function readPackageFiles(directory, packageName = ARCH_PACKAGE_NAME) {
  if (!ARCH_PACKAGE_NAMES.includes(packageName)) throw new TypeError("AUR package name is not approved")
  return {
    PKGBUILD: await readFile(path.join(directory, "PKGBUILD"), "utf8"),
    ".SRCINFO": await readFile(path.join(directory, ".SRCINFO"), "utf8"),
    [`${packageName}.install`]: await readFile(path.join(directory, `${packageName}.install`), "utf8")
  }
}

function uniqueAsset(release, name) {
  const matches = (release.assets || []).filter(asset => asset.name === name && asset.state === "uploaded")
  if (matches.length !== 1) throw new Error(`public GitHub Release must contain one uploaded ${name}`)
  const asset = matches[0]
  const expectedUrl = `https://github.com/Hansespinosa2/elef/releases/download/${release.tag_name}/${name}`
  if (asset.browser_download_url !== expectedUrl) throw new Error(`public GitHub Release URL for ${name} is not immutable or canonical`)
  return asset
}

async function downloadReleaseBytes(asset, fetchImpl, maxBytes) {
  const response = await fetchImpl(asset.browser_download_url, { redirect: "follow" })
  if (!response.ok || !response.url.startsWith("https://")) throw new Error(`could not download public release asset ${asset.name}`)
  const bytes = Buffer.from(await response.arrayBuffer())
  if (bytes.length > maxBytes) throw new Error(`public release asset ${asset.name} is unexpectedly large`)
  return bytes
}

async function downloadReleaseText(asset, fetchImpl) {
  const response = await fetchImpl(asset.browser_download_url, { redirect: "follow" })
  if (!response.ok || !response.url.startsWith("https://")) throw new Error(`could not download public release sidecar ${asset.name}`)
  const bytes = Buffer.from(await response.arrayBuffer())
  if (bytes.length > 1024 * 1024) throw new Error(`public release sidecar ${asset.name} is unexpectedly large`)
  return bytes.toString("utf8")
}

async function readCurrentFiles(directory, packageName) {
  const optional = async filename => readFile(path.join(directory, filename), "utf8").catch(() => null)
  const [PKGBUILD, srcinfo, install] = await Promise.all([
    optional("PKGBUILD"), optional(".SRCINFO"), optional(`${packageName}.install`)
  ])
  return { PKGBUILD, ".SRCINFO": srcinfo, srcinfo, install }
}

function readSrcInfoChecksum(serialized) {
  return oneSrcInfoField(serialized, "sha256sums")
}

function oneSrcInfoField(serialized, name) {
  const values = serialized.split(/\r?\n/).flatMap(line => {
    const match = new RegExp("^\\s*" + name + "\\s*=\\s*(.*?)\\s*$").exec(line)
    return match ? [match[1]] : []
  })
  if (values.length !== 1) throw new Error(`generated .SRCINFO must contain exactly one ${name}`)
  return values[0]
}

function compareVersions(left, right) {
  const leftParts = left.split(".").map(Number)
  const rightParts = right.split(".").map(Number)
  if (leftParts.length !== 3 || rightParts.length !== 3 || [...leftParts, ...rightParts].some(part => !Number.isInteger(part))) {
    throw new Error("AUR package history contains a non-semantic Elef release version")
  }
  for (let index = 0; index < 3; index += 1) {
    if (leftParts[index] !== rightParts[index]) return leftParts[index] < rightParts[index] ? -1 : 1
  }
  return 0
}

async function currentCommit(directory, git) {
  const result = await git(directory, ["rev-parse", "HEAD"])
  if (result.status !== 0 || !/^[a-f0-9]{40}$/i.test(result.stdout.trim())) throw new Error("could not read the published AUR commit")
  return result.stdout.trim()
}

async function runGit(directory, args) {
  const result = spawnSync("git", ["-C", directory, ...args], { encoding: "utf8", maxBuffer: 1024 * 1024 })
  if (result.error) return { status: 1, stdout: "" }
  return { status: result.status ?? 1, stdout: result.stdout || "" }
}

async function aurPackageInfo(packageName, fetchImpl) {
  const url = new URL("https://aur.archlinux.org/rpc/v5/info")
  url.searchParams.append("arg[]", packageName)
  const response = await fetchImpl(url, { headers: { Accept: "application/json" } })
  if (!response.ok) throw new Error("AUR package registry returned HTTP " + response.status)
  const payload = await response.json()
  if (payload.version !== 5 || payload.type !== "multiinfo" || !Number.isInteger(payload.resultcount) || !Array.isArray(payload.results)) {
    throw new Error("AUR package registry returned an unexpected response")
  }
  if (payload.resultcount === 0) return null
  if (payload.resultcount !== 1 || payload.results.length !== 1 || payload.results[0].Name !== packageName) {
    throw new Error("AUR package registry returned ambiguous metadata for " + packageName)
  }
  return payload.results[0]
}
