// Canonical producer of packages/client/dist/elef-client.mjs: one ESM file
// both hosts consume. React, react-dom and the Elef runtime deps are
// bundled in; contract types erase at compile time.
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";

const here = dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);
const esbuild = require("esbuild");

esbuild.buildSync({
  entryPoints: [join(here, "src", "index.ts")],
  outfile: join(here, "dist", "elef-client.mjs"),
  bundle: true,
  format: "esm",
  platform: "browser",
  target: "es2022",
  jsx: "automatic",
  minify: true,
  define: { "process.env.NODE_ENV": '"production"' },
  logLevel: "warning",
});
console.log("packages/client: dist/elef-client.mjs built");
