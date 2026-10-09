import { copyFile, mkdir, readFile, writeFile } from "node:fs/promises"
import path from "node:path"
import { fileURLToPath } from "node:url"

import { GitHubPublisher } from "../release/github-publisher.mjs"
import { archReleaseAssetUrl, renderArchPkgbuild } from "../release/arch-package.mjs"
import { assertAurCandidate, selectAurPackageName } from "../release/aur-publisher.mjs"
import { verifyPublishedLinuxArtifact } from "../release/aur-github.mjs"
import { parseLedger } from "../release/ledger.mjs"

const [pagesRootArgument, candidatePathArgument, packageDirectoryArgument] = process.argv.slice(2)
if (!pagesRootArgument || !candidatePathArgument || !packageDirectoryArgument) {
  throw new Error("usage: node prepare_desktop_aur.mjs <gh-pages-checkout> <candidate.json> <package-directory>")
}
const pagesRoot = path.resolve(pagesRootArgument)
const candidatePath = path.resolve(candidatePathArgument)
const packageDirectory = path.resolve(packageDirectoryArgument)
const candidate = parseCandidate(await readFile(candidatePath, "utf8"))
const token = requiredEnv("GITHUB_TOKEN")
const maintainer = requiredEnv("AUR_ACCOUNT_NAME")
const repository = process.env.GITHUB_REPOSITORY || "Hansespinosa2/elef"
if (repository.toLowerCase() !== "hansespinosa2/elef") throw new Error("AUR metadata may be prepared only for the Elef release repository")
const publisher = new GitHubPublisher({ owner: "Hansespinosa2", repository: "elef", token })

await refreshPages(pagesRoot)
let ledger = await currentLedger()
let releaseRecord = assertAurCandidate(ledger, candidate)
const packageName = await selectAurPackageName(ledger, { maintainer })
const verified = await verifyPublishedLinuxArtifact({ publisher, candidate, releaseRecord })
await refreshPages(pagesRoot)
ledger = await currentLedger()
releaseRecord = assertAurCandidate(ledger, candidate)
if (releaseRecord.linux_asset.artifact.sha256 !== verified.artifact.sha256) throw new Error("Linux asset changed while the AUR package was prepared")
if (await selectAurPackageName(ledger, { maintainer }) !== packageName) throw new Error("AUR package name changed while the package was prepared")

const pkgbuild = await renderArchPkgbuild({ version: candidate.version, sha256: verified.artifact.sha256, packageName })
await mkdir(packageDirectory, { recursive: true })
await writeFile(path.join(packageDirectory, "PKGBUILD"), pkgbuild, { mode: 0o644 })
await copyFile(path.join(path.dirname(fileURLToPath(import.meta.url)), "../packaging/arch/elef-bin.install"), path.join(packageDirectory, `${packageName}.install`))
const metadata = {
  schema_version: 1,
  package_name: packageName,
  version: candidate.version,
  pkgver: candidate.version,
  pkgrel: 1,
  tag: candidate.tag,
  source_sha: candidate.main_sha,
  pr: candidate.pr,
  filename: verified.artifact.filename,
  asset_url: verified.artifact.asset_url,
  asset_sha256: verified.artifact.sha256
}
await writeFile(path.join(packageDirectory, "release-metadata.json"), `${JSON.stringify(metadata, null, 2)}\n`, { mode: 0o644 })
process.stdout.write(`Prepared ${packageName} ${metadata.pkgver}-${metadata.pkgrel} from validated ${candidate.tag}; makepkg must generate .SRCINFO in the pinned Arch environment.\n`)

async function currentLedger() {
  return parseLedger(await readFile(path.join(pagesRoot, "desktop/stable/state.json"), "utf8"))
}

async function refreshPages(root) {
  const status = git(root, ["status", "--porcelain", "--untracked-files=all"])
  if (status.trim()) throw new Error("AUR preparation requires a clean Pages checkout")
  git(root, ["fetch", "origin", "refs/heads/gh-pages"])
  const fetched = git(root, ["rev-parse", "FETCH_HEAD"]).trim()
  git(root, ["reset", "--hard", fetched])
  if (git(root, ["rev-parse", "--abbrev-ref", "HEAD"]).trim() !== "gh-pages") throw new Error("AUR preparation may only read the gh-pages ledger")
}

function git(root, args) {
  const result = spawnSync("git", ["-C", root, ...args], { encoding: "utf8", maxBuffer: 1024 * 1024 })
  if (result.error || result.status !== 0) throw new Error(`could not refresh central release state with Git ${args[0]}`)
  return result.stdout || ""
}

function parseCandidate(serialized) {
  let candidate
  try {
    candidate = JSON.parse(serialized)
  } catch {
    throw new TypeError("AUR candidate is not valid JSON")
  }
  if (!candidate || !/^desktop-v(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/.test(candidate.tag) ||
    candidate.tag !== `desktop-v${candidate.version}` || !/^[a-f\d]{40}$/i.test(candidate.main_sha) || !Number.isInteger(candidate.pr)) {
    throw new TypeError("AUR candidate does not contain the reserved version, tag, source SHA and PR")
  }
  return candidate
}

function requiredEnv(name) {
  const value = process.env[name]
  if (!value) throw new Error(`missing required environment variable ${name}`)
  return value
}
