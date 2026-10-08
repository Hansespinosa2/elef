// Canonical producer of the committed packages/client/dist/ artifacts: the
// single-file ESM bundle both hosts consume, plus the dependency-free
// sanitizer module the editor/settings hosts import until their slices
// migrate. React, react-dom and the Elef runtime deps are bundled in;
// contract types erase at compile time.
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";

const here = dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);
const esbuild = require("esbuild");

const shared = {
  bundle: true,
  format: "esm",
  platform: "browser",
  target: "es2022",
  jsx: "automatic",
  minify: true,
  define: { "process.env.NODE_ENV": '"production"' },
  logLevel: "warning",
};

esbuild.buildSync({
  ...shared,
  entryPoints: [join(here, "src", "index.ts")],
  outfile: join(here, "dist", "elef-client.js"),
});
esbuild.buildSync({
  ...shared,
  entryPoints: [join(here, "src", "ui", "sanitize.ts")],
  outfile: join(here, "dist", "sanitize.js"),
});
console.log("packages/client: dist/elef-client.js + dist/sanitize.js built");
