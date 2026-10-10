import { readFile, writeFile } from "node:fs/promises"
import { spawnSync } from "node:child_process"
import path from "node:path"

import { ARCH_PACKAGE_NAME, ARCH_PACKAGE_NAMES } from "./arch-package.mjs"
import { latestPendingPlatformRelease } from "./ledger.mjs"

const VERSION_PATTERN = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/

export function assertAurCandidate(ledger, candidate) {
  const selected = latestPendingPlatformRelease(ledger, "aur")
  if (!selected || candidate?.version !== selected.version || candidate?.tag !== selected.tag ||
    candidate?.main_sha !== selected.main_sha || candidate?.pr !== selected.pr) {
    throw new Error("central release state no longer selects this AUR candidate")
  }
  if (!selected.public || selected.blocked || selected.gate !== "passed" || selected.linux_asset.status !== "passed") {
    throw new Error("AUR promotion requires the newest public, unblocked release with a validated Linux asset")
  }
  if (!selected.linux_asset.artifact || selected.linux_asset.artifact.format !== "arch-native") {
    throw new Error("AUR promotion requires the validated native Arch archive")
  }
  return selected
}

export async function selectAurPackageName(ledger, { maintainer, fetchImpl = fetch } = {}) {
  if (typeof maintainer !== "string" || !/^[A-Za-z0-9_-]{1,64}$/.test(maintainer)) {
    throw new TypeError("AUR package selection needs the configured AUR account name")
  }
  const previous = ledger.releases
    .filter(release => release.aur.status === "passed" && ARCH_PACKAGE_NAMES.includes(release.aur.artifact?.package_name))
    .sort((left, right) => compareVersions(right.version, left.version))[0]
  if (previous) {
    const info = await aurPackageInfo(previous.aur.artifact.package_name, fetchImpl)
    if (info?.Maintainer !== maintainer) throw new Error("the previously published AUR package is no longer maintained by the configured Elef account")
    return previous.aur.artifact.package_name
  }
  for (const packageName of ARCH_PACKAGE_NAMES) {
    const info = await aurPackageInfo(packageName, fetchImpl)
    if (!info || info.Maintainer === maintainer) return packageName
  }
  throw new Error("both approved Elef AUR package names are occupied by other maintainers")
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
