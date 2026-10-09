import { appendFile } from "node:fs/promises"

import { cancelInProgressDesktopReleaseRuns } from "../release/control-api.mjs"

const [owner, repository] = requiredEnv("GITHUB_REPOSITORY").split("/")
if (!owner || !repository) throw new Error("GITHUB_REPOSITORY must use owner/repository form")
const result = await cancelInProgressDesktopReleaseRuns({
  owner,
  repository,
  token: requiredEnv("GITHUB_TOKEN"),
  apiUrl: process.env.GITHUB_API_URL || "https://api.github.com"
})
const message = `Requested cancellation of ${result.cancelled} active desktop release run(s); ${result.alreadyFinished} finished during the request.`
process.stdout.write(`${message}\n`)
if (process.env.GITHUB_STEP_SUMMARY) await appendFile(process.env.GITHUB_STEP_SUMMARY, `${message}\n`)

function requiredEnv(name) {
  const value = process.env[name]
  if (!value) throw new Error(`missing required environment variable ${name}`)
  return value
}
