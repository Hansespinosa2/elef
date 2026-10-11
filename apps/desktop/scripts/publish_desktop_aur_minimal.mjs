import { appendFile, copyFile, mkdir, mkdtemp, rm, writeFile } from "node:fs/promises"
import { spawnSync } from "node:child_process"
import os from "node:os"
import path from "node:path"
import { fileURLToPath } from "node:url"

import { ARCH_PACKAGE_NAMES, renderArchPkgbuild } from "../release/arch-package.mjs"
import {
  parseReleaseTag,
  readPackageFiles,
  renderAurReleaseNotes,
  selectAurPackageName,
  synchronizeAurCheckout,
  validateAurSrcInfo,
  verifyPublishedLinuxArtifact
} from "../release/aur-publisher.mjs"

// Minimal tag-flow AUR publication (no ledger, no coordinator, no Pages).
// The version comes from DESKTOP_RELEASE_TAG, the source SHA from the
// Release API at publish time, and the package name is rechecked against
// the AUR registry on every run and recorded in the release notes.
// PKGBUILD plus a makepkg-regenerated .SRCINFO are pushed only after the
// immutable published archive, its SHA-256 sidecar, and its provenance
// revalidate, with a newest-release recheck and never-downgrade guards.
// Runs in the pinned Arch container (for makepkg) under the protected
// desktop-aur-publishing environment; PR jobs never receive its secrets.
const [packageDirectoryArgument] = process.argv.slice(2)
if (!packageDirectoryArgument) {
  throw new Error("usage: node publish_desktop_aur_minimal.mjs <package-directory>")
}
const packageDirectory = path.resolve(packageDirectoryArgument)
const { tag, version } = parseReleaseTag(process.env.DESKTOP_RELEASE_TAG || "")
const repository = process.env.GITHUB_REPOSITORY || "Hansespinosa2/elef"
if (repository.toLowerCase() !== "hansespinosa2/elef") throw new Error("AUR publishing is allowed only for the Elef release repository")
if (!process.env.AUR_ACCOUNT_NAME && !process.env.AUR_SSH_PRIVATE_KEY) {
  process.stdout.write("Skipping AUR publication: no AUR account is configured yet (set AUR_ACCOUNT_NAME and AUR_SSH_PRIVATE_KEY to enable pushes). The Arch release asset is unaffected.\n")
  process.exit(0)
}
const githubToken = requiredEnv("GITHUB_TOKEN")
const maintainer = requiredEnv("AUR_ACCOUNT_NAME")
const privateKey = requiredEnv("AUR_SSH_PRIVATE_KEY")
const knownHosts = requiredEnv("AUR_SSH_KNOWN_HOSTS")
const pkgrel = 1
const workRoot = await mkdtemp(path.join(os.tmpdir(), "elef-aur-publisher-"))

try {
  const release = await githubApi(`/releases/tags/${encodeURIComponent(tag)}`)
  const verified = await verifyPublishedLinuxArtifact({ version, release })
  const packageName = await selectAurPackageName({ maintainer })
  if (!ARCH_PACKAGE_NAMES.includes(packageName)) throw new Error("AUR package selection uses an unapproved package name")
  const aurUrl = `ssh://aur@aur.archlinux.org/${packageName}.git`

  await mkdir(packageDirectory, { recursive: true })
  await writeFile(path.join(packageDirectory, "PKGBUILD"),
    await renderArchPkgbuild({ version, sha256: verified.sha256, packageName }), { mode: 0o644 })
  await copyFile(
    path.join(path.dirname(fileURLToPath(import.meta.url)), "../packaging/arch/elef-bin.install"),
    path.join(packageDirectory, `${packageName}.install`)
  )
  await regenerateSrcInfo(packageDirectory)
  const files = await readPackageFiles(packageDirectory, packageName)
  validateAurSrcInfo(files[".SRCINFO"], {
    package_name: packageName,
    version,
    pkgrel,
    filename: verified.archiveName,
    asset_url: verified.assetUrl,
    asset_sha256: verified.sha256
  })

  const ssh = await configureSsh(workRoot, privateKey, knownHosts)
  const checkoutPath = path.join(workRoot, "aur")
  await cloneOrInitializeAur(checkoutPath, aurUrl, ssh)
  const gitEnv = { ...process.env, GIT_SSH_COMMAND: ssh.command }
  await git(checkoutPath, ["config", "user.name", "Elef Release"], gitEnv)
  await git(checkoutPath, ["config", "user.email", "41898282+github-actions[bot]@users.noreply.github.com"], gitEnv)

  const synchronized = await synchronizeAurCheckout({
    checkoutPath,
    files,
    version,
    pkgrel,
    packageName,
    git: (root, args) => git(root, args, gitEnv),
    beforePush: async () => {
      const current = await githubApi(`/releases/tags/${encodeURIComponent(tag)}`)
      const rechecked = await verifyPublishedLinuxArtifact({ version, release: current })
      if (rechecked.sha256 !== verified.sha256) throw new Error("AUR upstream asset changed immediately before publication")
      if (await selectAurPackageName({ maintainer }) !== packageName) throw new Error("AUR package name is no longer available to the configured Elef account")
    }
  })

  const updatedBody = renderAurReleaseNotes({ body: release.body || "", packageName, version, pkgrel })
  if (updatedBody !== (release.body || "")) {
    await githubApi(`/releases/${release.id}`, { method: "PATCH", body: { body: updatedBody } })
  }

  const result = { version, packageName, commit: synchronized.commit, changed: synchronized.changed }
  await writeOutput(result)
  await writeSummary(result)
  process.stdout.write(`Published ${packageName} ${version}-${pkgrel} from ${tag}; AUR commit ${result.commit}.\n`)
} finally {
  await rm(workRoot, { recursive: true, force: true })
}

async function githubApi(apiPath, { method = "GET", body } = {}) {
  const base = process.env.GITHUB_API_URL || "https://api.github.com"
  const response = await fetch(`${base}/repos/${repository}${apiPath}`, {
    method,
    headers: {
      Accept: "application/vnd.github+json",
      Authorization: `Bearer ${githubToken}`,
      "X-GitHub-Api-Version": "2022-11-28"
    },
    body: body === undefined ? undefined : JSON.stringify(body)
  })
  if (!response.ok) throw new Error(`GitHub API ${method} ${apiPath} failed with HTTP ${response.status}`)
  return response.json()
}

async function regenerateSrcInfo(packageDirectory) {
  // makepkg refuses to run as root, even for --printsrcinfo, so a root
  // release container regenerates through the same unprivileged builder the
  // package gate uses.
  const root = typeof process.geteuid === "function" && process.geteuid() === 0
  if (root) {
    const existing = spawnSync("id", ["builder"], { encoding: "utf8" })
    if (existing.status !== 0) {
      const created = spawnSync("useradd", ["--create-home", "--shell", "/bin/bash", "builder"], { encoding: "utf8" })
      if (created.status !== 0) throw new Error("could not create the unprivileged makepkg user")
    }
    const owned = spawnSync("chown", ["-R", "builder:builder", packageDirectory], { encoding: "utf8" })
    if (owned.status !== 0) throw new Error("could not hand the AUR package directory to the makepkg user")
  }
  const command = root ? "runuser" : "makepkg"
  const args = root ? ["-u", "builder", "--", "makepkg", "--printsrcinfo"] : ["--printsrcinfo"]
  const printed = spawnSync(command, args, { cwd: packageDirectory, encoding: "utf8", maxBuffer: 1024 * 1024 })
  if (printed.error || printed.status !== 0) throw new Error("could not regenerate .SRCINFO with makepkg")
  if (!printed.stdout.includes("pkgbase =")) throw new Error("makepkg did not emit .SRCINFO package metadata")
  await writeFile(path.join(packageDirectory, ".SRCINFO"), printed.stdout, { mode: 0o644 })
}

async function configureSsh(root, key, hosts) {
  const hasPinnedAurHost = hosts.split(/\r?\n/).some(line => /^(?:aur\.archlinux\.org|\[aur\.archlinux\.org\]:22)\s/.test(line))
  if (!hasPinnedAurHost) throw new Error("protected AUR known-hosts configuration must pin aur.archlinux.org")
  const sshDirectory = path.join(root, ".ssh")
  await mkdir(sshDirectory, { mode: 0o700 })
  const keyPath = path.join(sshDirectory, "aur_ed25519")
  const knownHostsPath = path.join(sshDirectory, "known_hosts")
  await writeFile(keyPath, `${key.trim()}\n`, { mode: 0o600 })
  await writeFile(knownHostsPath, `${hosts.trim()}\n`, { mode: 0o600 })
  const command = `ssh -i '${keyPath}' -o IdentitiesOnly=yes -o UserKnownHostsFile='${knownHostsPath}' -o StrictHostKeyChecking=yes`
  return { keyPath, knownHostsPath, command }
}

async function cloneOrInitializeAur(checkoutPath, remote, ssh) {
  const cloned = await git(workRoot, ["clone", remote, checkoutPath], { ...process.env, GIT_SSH_COMMAND: ssh.command })
  if (cloned.status === 0) return
  const probe = await git(workRoot, ["ls-remote", "--heads", remote, "master"], { ...process.env, GIT_SSH_COMMAND: ssh.command })
  if (probe.status !== 0 || probe.stdout.trim()) throw new Error("could not clone the registered AUR package using the protected SSH identity")
  await mkdir(checkoutPath, { recursive: true })
  const initialized = await git(checkoutPath, ["init", "--initial-branch=master"])
  if (initialized.status !== 0) throw new Error("could not initialize the first AUR package checkout")
  const added = await git(checkoutPath, ["remote", "add", "origin", remote])
  if (added.status !== 0) throw new Error("could not configure the AUR package remote")
}

async function git(directory, args, env = process.env) {
  const result = spawnSync("git", ["-C", directory, ...args], { encoding: "utf8", maxBuffer: 2 * 1024 * 1024, env })
  if (result.error) return { status: 1, stdout: "" }
  return { status: result.status ?? 1, stdout: result.stdout || "" }
}

async function writeOutput(result) {
  const output = process.env.GITHUB_OUTPUT
  if (!output) return
  await appendFile(output, [
    `release_version=${result.version}`,
    `aur_package=${result.packageName}`,
    `aur_commit=${result.commit}`,
    `changed=${result.changed}`
  ].join("\n") + "\n")
}

async function writeSummary(result) {
  const summary = process.env.GITHUB_STEP_SUMMARY
  if (!summary) return
  await appendFile(summary, [
    "## AUR package publication",
    "",
    `- Package: \`${result.packageName}\` version \`${result.version}-1\``,
    `- AUR commit: \`${result.commit}\``,
    `- Package metadata changed: \`${result.changed}\``,
    "- The package was published only after public GitHub archive, checksum and provenance verification."
  ].join("\n") + "\n")
}

function requiredEnv(name) {
  const value = process.env[name]
  if (!value) throw new Error(`missing required environment variable ${name}`)
  return value
}
