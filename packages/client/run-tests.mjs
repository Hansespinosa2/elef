// Bundles packages/client tests with the pinned esbuild and runs them under
// plain node:test. Output goes to an OS temp dir, so `npm test` never
// dirties the checkout.
import { mkdtempSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import { createRequire } from "node:module";

const here = dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);
const esbuild = require("esbuild");

const files = readdirSync(join(here, "test")).filter((name) => /\.test\.tsx?$/.test(name));
if (files.length === 0) {
  console.log("packages/client: no tests");
  process.exit(0);
}
const outdir = mkdtempSync(join(tmpdir(), "elef-client-tests-"));
esbuild.buildSync({
  entryPoints: files.map((name) => join(here, "test", name)),
  outdir,
  bundle: true,
  format: "esm",
  platform: "node",
  target: "es2022",
  jsx: "automatic",
  define: { "process.env.NODE_ENV": '"test"' },
  logLevel: "warning",
});
const bundled = files.map((name) => join(outdir, name.replace(/\.tsx?$/, ".js")));
// --test-force-exit: React's scheduler leaves a MessageChannel port open after
// unmount, which would otherwise keep the runner alive forever. Unfinished
// tests still run to their own timeouts; this only releases completed runs.
const run = spawnSync(process.execPath, ["--test-force-exit", "--test", ...bundled], {
  stdio: "inherit",
  env: { ...process.env, IS_REACT_ACT_ENVIRONMENT: "true" },
});
process.exit(run.status ?? 1);
