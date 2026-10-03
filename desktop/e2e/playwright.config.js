import path from "node:path"

const repoRoot = path.resolve(process.cwd(), "../..")
const baseURL = process.env.ELEF_E2E_WEB_URL || (process.env.CI
  ? "http://127.0.0.1:3000"
  : "https://127.0.0.1:3000")
const webServer = process.env.ELEF_E2E_START_WEB_SERVER === "1"
  ? {
      command: "bin/rails server -e test -b 127.0.0.1 -p 3000",
      cwd: repoRoot,
      url: "http://127.0.0.1:3000/up",
      reuseExistingServer: false,
      timeout: 120_000
    }
  : undefined

export default {
  testDir: "./specs",
  testMatch: "web.spec.js",
  fullyParallel: false,
  workers: 1,
  timeout: 60_000,
  expect: { timeout: 10_000 },
  reporter: "list",
  use: { headless: true, baseURL },
  projects: [{ name: "web", use: { browserName: "chromium" } }],
  webServer
}
