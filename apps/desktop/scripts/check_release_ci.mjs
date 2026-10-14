import assert from "node:assert/strict"
import { readFile } from "node:fs/promises"
import path from "node:path"
import { fileURLToPath } from "node:url"

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..")
const ci = await readFile(path.join(repoRoot, ".github/workflows/ci.yml"), "utf8")
const release = await readFile(path.join(repoRoot, ".github/workflows/desktop-release.yml"), "utf8")
const rootPackage = JSON.parse(await readFile(path.join(repoRoot, "package.json"), "utf8"))
const tierRunner = await readFile(path.join(repoRoot, "bin/check"), "utf8")

function jobBlock(workflow, file, name) {
  const headings = [...workflow.matchAll(/^  ([a-z0-9-]+):$/gm)]
  const index = headings.findIndex(match => match[1] === name)
  assert.ok(index >= 0, `${file} is missing the ${name} job`)
  const start = headings[index].index
  const end = index + 1 < headings.length ? headings[index + 1].index : workflow.length
  return workflow.slice(start, end)
}

function needsList(block, file, name) {
  const match = block.match(/\n    needs: \[([^\]]+)\]/)
  assert.ok(match, `${file} ${name} must declare its evidence jobs as an inline needs list`)
  return match[1].split(",").map(entry => entry.trim()).filter(entry => entry.length > 0)
}

// CI keeps its existing triggers: pull requests, pushes to dev/main, manual dispatch.
assert.match(ci, /\n  pull_request:\n/, "CI must keep running for pull requests")
assert.match(ci, /\n  push:\n    branches: \[ main, dev \]\n/, "CI must keep running on dev and main pushes")

// The Arch package gate runs in the pinned official container.
const archPackage = jobBlock(ci, "ci.yml", "arch-package")
assert.ok(archPackage.includes("docker run --rm --pull=always"), "the arch-package job must always pull a fresh image")
assert.ok(archPackage.includes("--platform linux/amd64"), "the arch-package job must pin the x86-64 platform")
assert.ok(archPackage.includes("bash apps/desktop/scripts/arch_package_ci.sh"), "the arch-package job must run the Arch gate script")
assert.ok(archPackage.includes("ELEF_BUILD_SHA: ${{ github.sha }}"), "the arch-package job must build the exact pushed SHA")

// Every workflow Arch image reference stays pinned, and all three agree on one digest.
const pinnedImages = [...(ci + release).matchAll(/ghcr\.io\/archlinux\/archlinux@(sha256:[0-9a-f]{64})/g)]
assert.ok(pinnedImages.length >= 3, "expected pinned Arch image references in the CI and release workflows")
assert.equal(new Set(pinnedImages.map(match => match[1])).size, 1, "every workflow Arch image reference must pin the same digest")

// Both desktop suites build the Dev profile and run the profile and fixture gates.
for (const job of ["desktop", "desktop-macos"]) {
  const block = jobBlock(ci, "ci.yml", job)
  assert.ok(block.includes("--profile=dev"), `the ${job} job must build the Dev frontend profile`)
  assert.ok(block.includes("npm run check:desktop-profiles"), `the ${job} job must run the Stable/Dev profile gate`)
  assert.ok(block.includes("npm run check:release-fixtures"), `the ${job} job must run the release fixture gate`)
}

// The fast tier re-verifies the Gate A wiring on every pull request.
assert.ok(jobBlock(ci, "ci.yml", "desktop-fast").includes("npm run check:release-ci"), "desktop-fast must run this checker")

// The shadow plan and result matrix stay informational: they compute and
// report, but never gate anything.
const plan = jobBlock(ci, "ci.yml", "plan")
assert.ok(plan.includes("tooling/ci_affected.py"), "the plan job must compute the affected-job plan")
assert.ok(plan.includes("shadow"), "the plan job must stay in shadow mode")
assert.ok(plan.includes('ELEF_CI_PLAN_ENFORCE: "0"'), "the plan job must not enforce skips")
const matrix = jobBlock(ci, "ci.yml", "ci-gate")
assert.ok(matrix.includes("always()"), "ci-gate must always publish its matrix")
assert.ok(matrix.includes("plan"), "ci-gate must aggregate the shadow plan")

// Gate A aggregates every evidence job, records the exact SHA, and re-verifies itself.
const gate = jobBlock(ci, "ci.yml", "release-gate")
assert.deepEqual(needsList(gate, "ci.yml", "release-gate").sort(), [
  "desktop-fast",
  "scan_ruby",
  "scan_js",
  "test",
  "sqlite-test",
  "system-test",
  "affected",
  "desktop",
  "arch-package",
  "desktop-macos",
  "renderer-macos",
  "production-smoke",
  "development-smoke"
].sort(), "release-gate must wait for every evidence job exactly once")
assert.ok(!needsList(gate, "ci.yml", "release-gate").some(job => job === "plan" || job === "ci-gate"), "release-gate must never wait for the plan or matrix jobs")
const attestation = jobBlock(ci, "ci.yml", "record-ci-attestation")
assert.ok(!needsList(attestation, "ci.yml", "record-ci-attestation").some(job => job === "plan" || job === "ci-gate"), "record-ci-attestation must never wait for the plan or matrix jobs")
assert.ok(!gate.includes("ref_name =="), "release-gate follows the CI triggers; it must not add a push-only branch condition")
assert.ok(gate.includes("SOURCE_SHA: ${{ github.sha }}"), "release-gate must record the exact gated SHA")
assert.ok(gate.includes("ref: ${{ github.sha }}"), "release-gate must check out the exact gated SHA")
assert.ok(gate.includes("node apps/desktop/scripts/check_release_ci.mjs"), "release-gate must re-verify its own wiring")

// The release workflow is tag-driven: desktop-v* tags only, draft first, then publish.
assert.ok(release.includes('on:\n  push:\n    tags: ["desktop-v*"]\n'), "desktop-release.yml must trigger on desktop-v* tags only")
assert.ok(release.includes("releaseDraft: true"), "the macOS job must open the release as a draft")
assert.ok(release.includes('gh release edit "$RELEASE_TAG" --draft=false'), "the publish job must flip the complete draft to published")
assert.ok(release.includes("--bundles app,dmg"), "the macOS job must ship the app plus DMG bundles")
assert.ok(!release.match(/appimage/i), "the release must not publish AppImage updater artifacts")
assert.equal((release.match(/uploadUpdaterJson: true/g) || []).length, 1, "only the macOS job may write the updater JSON")
for (const token of ["SAFE_UPDATE_ENDPOINT", "ledger", "coordinator", "gh-pages", "pages-publisher"]) {
  assert.ok(!release.toLowerCase().includes(token.toLowerCase()), `the tag-driven release must not reference ${token}`)
}

// The Arch asset job replaces the cut Linux updater job: a plain archive plus sidecars, no updater JSON.
const archAsset = jobBlock(release, "desktop-release.yml", "arch-asset")
assert.ok(archAsset.includes("needs: macos"), "the Arch asset job must follow the macOS draft")
assert.ok(archAsset.includes("elef-${version}-x86_64.tar.zst"), "the Arch asset job must upload the versioned native archive")
assert.ok(archAsset.includes(".sha256"), "the Arch asset job must upload the SHA-256 sidecar")
assert.ok(archAsset.includes(".provenance.json"), "the Arch asset job must upload the provenance sidecar")
assert.ok(!archAsset.includes("uploadUpdaterJson"), "the Arch asset job must not write updater JSON")
assert.ok(!archAsset.includes("latest.json"), "the Arch asset job must not touch the macOS update feed")
assert.deepEqual(needsList(jobBlock(release, "desktop-release.yml", "publish"), "desktop-release.yml", "publish").sort(),
  ["arch-asset", "macos"], "the publish job must wait for the macOS draft and the Arch asset")

// AUR publication runs only after publish, inside its protected environment.
const aurPublish = jobBlock(release, "desktop-release.yml", "aur-publish")
assert.ok(aurPublish.includes("needs: publish"), "AUR publication must wait for the published release")
assert.ok(aurPublish.includes("environment: desktop-aur-publishing"), "AUR publication must use its protected environment")
assert.ok(aurPublish.includes("node apps/desktop/scripts/publish_desktop_aur_minimal.mjs"), "AUR publication must run the minimal tag-flow publisher")

// Secrets discipline: pull-request CI receives none; the release workflow scopes each secret.
assert.ok(!ci.includes("secrets."), "CI jobs must not receive secrets; pull-request runs stay credential-free")
const releaseSecrets = [...release.matchAll(/secrets\.([A-Z_]+)/g)].map(match => match[1])
assert.ok(releaseSecrets.length > 0, "expected scoped release secrets")
assert.deepEqual([...new Set(releaseSecrets)].sort(), [
  "AUR_SSH_PRIVATE_KEY",
  "TAURI_SIGNING_PRIVATE_KEY",
  "TAURI_SIGNING_PRIVATE_KEY_PASSWORD"
].sort(), "the release workflow must scope exactly the signing and AUR secrets")
assert.ok(aurPublish.includes("secrets.AUR_SSH_PRIVATE_KEY"), "the AUR key must live in the protected AUR job")
assert.ok(!archPackage.includes("secrets.") && !gate.includes("secrets."), "evidence and gate jobs must stay credential-free")

// The gate stays wired into the local tiers: fast unit proof in quick, release evidence in affected.
assert.equal(rootPackage.scripts["check:release-ci"], "node apps/desktop/scripts/check_release_ci.mjs", "the root scripts must expose this checker")
assert.ok(tierRunner.includes('"npm run test:arch-package"'), "bin/check quick must run the Arch package unit suite")
assert.ok(tierRunner.includes('"npm run check:release-fixtures"'), "bin/check affected must run the release fixture gate")
assert.ok(tierRunner.includes('"npm run check:release-ci"'), "bin/check affected must run this checker")
