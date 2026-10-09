import path from "node:path"

const repoRoot = path.resolve(process.cwd(), "../..")

export function createPlaywrightConfig(env = process.env) {
  const port = env.ELEF_E2E_WEB_PORT || "3000"
  if (!/^\d+$/.test(port) || Number(port) < 1 || Number(port) > 65535) {
    throw new Error("ELEF_E2E_WEB_PORT must be a valid TCP port")
  }
  const webServer = env.ELEF_E2E_START_WEB_SERVER === "1"
    ? {
        command: `bin/rails server -e test -b 127.0.0.1 -p ${port}`,
        cwd: repoRoot,
        url: `http://127.0.0.1:${port}/up`,
        reuseExistingServer: false,
        timeout: 120_000
      }
    : undefined
  const protocol = env.CI || webServer ? "http" : "https"
  const baseURL = env.ELEF_E2E_WEB_URL || `${protocol}://127.0.0.1:${port}`

  return {
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
}

export default createPlaywrightConfig()
