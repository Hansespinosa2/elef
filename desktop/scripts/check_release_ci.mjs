import assert from "node:assert/strict"
import { readFile } from "node:fs/promises"
import path from "node:path"
import { fileURLToPath } from "node:url"

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..")
const workflow = await readFile(path.join(repoRoot, ".github/workflows/ci.yml"), "utf8")
const releaseWorkflow = await readFile(path.join(repoRoot, ".github/workflows/desktop-release.yml"), "utf8")
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
  "desktop-macos",
  "renderer-macos",
  "production-smoke",
  "development-smoke"
]

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

for (const jobName of ["desktop", "desktop-macos"]) {
  const block = jobBlock(workflow, jobName)
  assert.match(block, /npm run build --prefix desktop\/frontend -- --profile=dev/, `${jobName} must build repository Dev`)
  assert.match(block, /npm run check:desktop-profiles/, `${jobName} must validate profile build graphs`)
  assert.match(block, /npm run check:release-fixtures/, `${jobName} must validate required release fixtures`)
}

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
