import assert from "node:assert/strict"
import { readFile } from "node:fs/promises"
import path from "node:path"
import { fileURLToPath } from "node:url"

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..")
const workflow = await readFile(path.join(repoRoot, ".github/workflows/ci.yml"), "utf8")
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

for (const jobName of ["desktop", "desktop-macos"]) {
  const block = jobBlock(workflow, jobName)
  assert.match(block, /npm run build --prefix desktop\/frontend -- --profile=dev/, `${jobName} must build repository Dev`)
  assert.match(block, /npm run check:desktop-profiles/, `${jobName} must validate profile build graphs`)
  assert.match(block, /npm run check:release-fixtures/, `${jobName} must validate required release fixtures`)
}

process.stdout.write(`Main release CI contract passed: ${rerunJobs.length} skipped jobs now run on main; exact-SHA gate depends on ${requiredGateJobs.length} jobs.\n`)

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
