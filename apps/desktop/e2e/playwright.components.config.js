export default {
  testDir: "./specs",
  testMatch: "components.spec.js",
  fullyParallel: false,
  workers: 1,
  timeout: 30_000,
  expect: { timeout: 5_000 },
  reporter: "list",
  use: { headless: true },
  projects: [{ name: "components", use: { browserName: "chromium" } }]
}
