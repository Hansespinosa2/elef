import assert from "node:assert/strict"
import { readFile } from "node:fs/promises"
import path from "node:path"
import { fileURLToPath } from "node:url"

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..")
const workflow = await readFile(path.join(repoRoot, ".github/workflows/ci.yml"), "utf8")
const releaseWorkflow = await readFile(path.join(repoRoot, ".github/workflows/desktop-release.yml"), "utf8")
const releaseControls = await readFile(path.join(repoRoot, ".github/workflows/desktop-release-controls.yml"), "utf8")
const productionDockerfile = await readFile(path.join(repoRoot, "Dockerfile"), "utf8")
const developmentDockerfile = await readFile(path.join(repoRoot, "Dockerfile.development"), "utf8")
const personalCompose = await readFile(path.join(repoRoot, "compose.personal.yml"), "utf8")
const developmentCompose = await readFile(path.join(repoRoot, "compose.development.yml"), "utf8")
const mainPushCondition = "github.event_name != 'push' || github.ref_name == 'main'"
const rerunJobs = ["scan_ruby", "scan_js", "test", "sqlite-test", "system-test", "production-smoke", "development-smoke"]
const requiredGateJobs = [
  "desktop-fast",
  "scan_ruby",
  "scan_js",
  "test",
  "sqlite-test",
  "system-test",
  "desktop",
  "arch-package",
  "desktop-macos",
  "renderer-macos",
  "production-smoke",
  "development-smoke"
]
const archBuildImage = "ghcr.io/archlinux/archlinux@sha256:ed261ac99d13e9636940e88df26ccd22b0d8d1c2139699870f0427c765352689"
const postgresCiImage = "mirror.gcr.io/library/postgres@sha256:2d2b8998d31037bf721cfdf764d76ba74171b4fab3431b7f72c27c56ddbdf9e3"
const rubyCiImage = "mirror.gcr.io/library/ruby@sha256:4116b6119a53dfef69f4cd591784a1aff9e1095b2ef4eccd865e46906e90be36"

assert.match(workflow, /push:\n\s+branches: \[ main, dev \]/, "CI must run for main pushes")
for (const jobName of rerunJobs) {
  const block = jobBlock(workflow, jobName)
  const condition = block.match(/^    if: (.+)$/m)?.[1]
  assert.equal(condition, mainPushCondition, `${jobName} must run on main pushes and PRs`)
}

const releaseGate = jobBlock(workflow, "release-gate")
assert.match(releaseGate, /^    if: github\.event_name == 'push' && github\.ref_name == 'main'$/m)
const needs = releaseGate.match(/^    needs: \[([^\]]+)\]$/m)?.[1]
assert.ok(needs, "the exact-SHA release gate must depend on all required checks")
assert.deepEqual(needs.split(",").map(value => value.trim()), requiredGateJobs)
assert.match(releaseGate, /SOURCE_SHA: \$\{\{ github\.sha \}\}/, "release evidence must name the pushed main SHA")
assert.match(jobBlock(workflow, "desktop-fast"), /npm run test:release-ledger/, "publication transition tests must run in the required fast CI tier")
assert.match(jobBlock(workflow, "desktop-fast"), /npm run test:arch-package/, "Arch package metadata tests must run in the required fast CI tier")
assert.match(jobBlock(workflow, "desktop-fast"), /desktop\/release\/signature-verifier\/Cargo\.toml --locked/, "Tauri updater signature verification must be tested in the required fast CI tier")
assert.equal((workflow.match(new RegExp(escapeRegExp(`image: ${postgresCiImage}`), "g")) ?? []).length, 2, "Rails PostgreSQL services must use the digest-pinned official mirror image")
for (const [name, compose] of [["production", personalCompose], ["development", developmentCompose]]) {
  assert.match(compose, /^    image: \$\{POSTGRES_IMAGE:-postgres:17\}$/m, `${name} Compose must allow CI to pin its PostgreSQL image`)
}
for (const jobName of ["production-smoke", "development-smoke"]) {
  const block = jobBlock(workflow, jobName)
  assert.ok(block.includes(rubyCiImage), `${jobName} must build from the digest-pinned official Ruby mirror image`)
  assert.ok(block.includes(`POSTGRES_IMAGE: ${postgresCiImage}`), `${jobName} Compose smoke must use the digest-pinned official PostgreSQL mirror image`)
}
for (const [name, dockerfile] of [["production", productionDockerfile], ["development", developmentDockerfile]]) {
  assert.match(dockerfile, /^ARG RUBY_BASE_IMAGE=ruby:3\.4-trixie$/m, `${name} Dockerfile must keep its normal upstream default`)
  assert.match(dockerfile, /^FROM \$\{RUBY_BASE_IMAGE\}$/m, `${name} Dockerfile must accept the CI-pinned Ruby image`)
}

assert.match(releaseWorkflow, /push:\n\s+branches: \[ main \]/, "release coordination must run after main pushes")
assert.match(releaseWorkflow, /schedule:\n\s+- cron: "\*\/15 \* \* \* \*"/, "periodic reconciliation must repair missed pushes")
assert.match(releaseWorkflow, /workflow_dispatch:/, "owner release controls and on-demand reconciliation must be available")
assert.match(releaseWorkflow, /workflow_dispatch' && github\.ref == 'refs\/heads\/main'/, "manual coordination must run only from trusted main workflow code")
assert.match(releaseWorkflow, /queue: max/, "release reconciliation must use the Actions maximum concurrency queue")
assert.doesNotMatch(releaseWorkflow, /tags:\s*\[\s*["']desktop-v\*/, "release publication must not depend on a bot-created tag event")
assert.doesNotMatch(releaseWorkflow, /^\s+pull_request:/m, "release credentials and writes must not run for untrusted pull requests")
assert.match(releaseWorkflow, /ref: main\n\s+path: source\n\s+fetch-depth: 0/, "the coordinator must inspect full main history")
assert.match(releaseWorkflow, /ref: gh-pages\n\s+path: pages/, "the coordinator must write only through the authoritative Pages branch")
assert.match(releaseWorkflow, /actions: read[\s\S]*contents: write[\s\S]*pull-requests: read/, "the state writer must use narrow GitHub permissions")
assert.match(releaseWorkflow, /publish_desktop_release_state\.mjs pages source/, "the workflow must use the tested CAS publisher")
assert.match(releaseWorkflow, /steps\.publish\.outputs\.failed_gate_count/, "terminal Gate A failures must produce an owner-visible workflow failure")
assert.match(releaseWorkflow, /options: \[ reconcile, minor \]/, "ordinary release workflow must leave emergency controls to the unqueued control path")
assert.match(releaseControls, /options: \[ block, unblock \]/, "emergency block and unblock must have a dedicated dispatch path")
assert.match(releaseControls, /if: github\.ref == 'refs\/heads\/main'/, "emergency controls must run only from trusted main code")
assert.match(releaseControls, /environment: desktop-release-state/, "emergency controls must use the protected release-state environment")
assert.match(releaseControls, /actions: write/, "emergency blocks must be able to cancel a stale publisher after committing block state")
assert.match(releaseControls, /publish_desktop_release_state\.mjs pages source/, "emergency controls must use the CAS ledger writer")
assert.match(releaseControls, /cancel_desktop_release_runs\.mjs/, "emergency blocks must stop any active release coordinator after the ledger update")
assert.match(releaseControls, /finalize_desktop_release_notes\.mjs pages/, "emergency controls must publish the warning to GitHub Releases")
assert.doesNotMatch(releaseControls, /^concurrency:/m, "emergency blocks must not wait behind an ordinary publication run; the shared Pages CAS serializes ledger writes")

for (const jobName of ["desktop", "desktop-macos"]) {
  const block = jobBlock(workflow, jobName)
  assert.match(block, /npm run build --prefix desktop\/frontend -- --profile=dev/, `${jobName} must build repository Dev`)
  assert.match(block, /npm run check:desktop-profiles/, `${jobName} must validate profile build graphs`)
  assert.match(block, /npm run check:release-fixtures/, `${jobName} must validate required release fixtures`)
}
const archPackageJob = jobBlock(workflow, "arch-package")
assert.match(archPackageJob, /docker run --rm --pull=always/, "the native package gate must use an Arch container")
assert.match(archPackageJob, /--platform linux\/amd64/, "the native package gate must target x86-64")
assert.ok(archPackageJob.includes(archBuildImage), "the Arch base container must use the pinned official GHCR image")
assert.match(archPackageJob, /desktop\/scripts\/arch_package_ci\.sh/, "the Arch build/install/upgrade gate must run from its checked-in script")
const archPackageScript = await readFile(path.join(repoRoot, "desktop/scripts/arch_package_ci.sh"), "utf8")
assert.match(archPackageScript, /rust_toolchain_version="1\.98\.0"/, "the Arch native build must pin its Rust toolchain")
const archPackageSmoke = await readFile(path.join(repoRoot, "desktop/scripts/test_arch_package.sh"), "utf8")
assert.match(archPackageSmoke, /hash_package_owned_files/, "Arch smoke must hash package-managed files around app launches")
assert.match(archPackageSmoke, /run_native_smoke upgrade\s+pacman -Qkk elef-bin\s+hash_package_owned_files .*after-upgrade-launch\.sha256/, "Arch smoke must verify managed files after the package-manager upgrade and relaunch")

const prepareReleases = jobBlock(releaseWorkflow, "prepare-releases")
assert.match(prepareReleases, /prepare_desktop_releases\.mjs pages/, "approved reservations must create their source-pinned tag and draft release")
const linuxRelease = jobBlock(releaseWorkflow, "linux-release")
assert.ok(linuxRelease.includes(archBuildImage), "release Linux assets must build in the pinned official Arch image")
assert.match(linuxRelease, /fromJSON\(needs\.reconcile\.outputs\.linux_candidate\)\.main_sha/, "Linux package builds must use the reserved source SHA")
assert.match(linuxRelease, /mkdir -p \"\$GITHUB_WORKSPACE\/build-source\/desktop\/target\"/, "Arch build evidence directory must exist before the container starts")
assert.match(linuxRelease, /prepare_linux_release_assets\.mjs/, "Linux asset publication must validate the archive checksum and source provenance")
assert.match(linuxRelease, /publish_desktop_platform\.mjs/, "Linux GitHub assets must be ledger-gated and immutable")
assert.match(linuxRelease, /record_desktop_platform_failure\.mjs pages \"\$RELEASE_VERSION\" linux_asset/, "Linux publication failures must update the platform ledger")
assert.doesNotMatch(releaseWorkflow, /AppImage|appimage/i, "Ubuntu AppImage must not be published or advertised as a v0.x release asset")
const macosRelease = jobBlock(releaseWorkflow, "macos-release")
assert.match(macosRelease, /runs-on: macos-15/, "macOS publication must run on the hosted ARM64 runner")
assert.match(macosRelease, /environment: desktop-release-signing/, "updater signing must run only in the protected signing environment")
assert.match(macosRelease, /TAURI_SIGNING_PRIVATE_KEY: \$\{\{ secrets\.TAURI_SIGNING_PRIVATE_KEY \}\}/, "private updater signing keys must stay in Actions secrets")
assert.match(macosRelease, /APPLE_SIGNING_IDENTITY: '-'/, "v0.x macOS builds must use ad-hoc signing")
assert.match(macosRelease, /prepare_macos_release_assets\.mjs/, "macOS publication must verify updater signatures and record both package hashes")
assert.match(macosRelease, /publish_desktop_platform\.mjs/, "macOS GitHub assets must be ledger-gated and immutable")
assert.doesNotMatch(macosRelease, /APPLE_CERTIFICATE|APPLE_PASSWORD|APPLE_TEAM_ID/, "v0.x must not require or claim Developer ID signing/notarization")
const aurRelease = jobBlock(releaseWorkflow, "aur-release")
assert.match(aurRelease, /needs: \[ reconcile, prepare-releases, linux-release \]/, "AUR publishing must follow validated Linux publication and draft preparation")
assert.match(aurRelease, /environment: desktop-aur-publishing/, "AUR SSH publication must use its protected environment")
assert.match(aurRelease, /AUR_SSH_PRIVATE_KEY: \$\{\{ secrets\.AUR_SSH_PRIVATE_KEY \}\}/, "AUR SSH keys must be provided only through Actions secrets")
assert.match(aurRelease, /AUR_SSH_KNOWN_HOSTS: \$\{\{ vars\.AUR_SSH_KNOWN_HOSTS \}\}/, "AUR SSH host keys must be pinned in protected Actions configuration")
assert.match(aurRelease, /AUR_ACCOUNT_NAME: \$\{\{ vars\.AUR_ACCOUNT_NAME \}\}/, "AUR package ownership must be checked against the configured release account")
assert.match(aurRelease, /makepkg --printsrcinfo/, "AUR .SRCINFO must be generated in the pinned Arch environment")
assert.match(aurRelease, /prepare_desktop_aur\.mjs/, "AUR promotion must re-verify public GitHub assets before generating PKGBUILD")
assert.match(aurRelease, /publish_desktop_aur\.mjs/, "AUR metadata publication must recheck ledger eligibility before SSH push")
assert.match(aurRelease, /record_desktop_platform_failure\.mjs pages .* aur aur_push_failed/, "AUR publication failures must be recorded without raw error strings")
const finalNotes = jobBlock(releaseWorkflow, "finalize-release-notes")
assert.match(finalNotes, /needs: \[ reconcile, prepare-releases, linux-release, macos-release, aur-release \]/, "final release notes must wait for every platform publisher")
assert.match(finalNotes, /AUR_RELEASE_VERSION: \$\{\{ needs\.aur-release\.outputs\.release_version \}\}/, "AUR publication status must be included in final release notes")
assert.match(finalNotes, /finalize_desktop_release_notes\.mjs/, "partial, complete, and blocked release notes must follow authoritative ledger state")

process.stdout.write(`Release CI/coordinator contract passed: ${rerunJobs.length} skipped jobs now run on main; exact-SHA gate depends on ${requiredGateJobs.length} jobs; main-history Pages reconciliation is serialized.\n`)

function jobBlock(source, jobName) {
  const jobsStart = source.indexOf("jobs:\n")
  assert.notEqual(jobsStart, -1, "CI workflow has no jobs section")
  const headers = [...source.slice(jobsStart).matchAll(/^  ([A-Za-z0-9_-]+):\s*$/gm)]
  const target = headers.find(match => match[1] === jobName)
  assert.ok(target, `CI workflow is missing job ${jobName}`)
  const start = jobsStart + target.index + target[0].length
  const next = headers.find(match => jobsStart + match.index > start)
  return source.slice(start, next ? jobsStart + next.index : source.length)
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
}
