// Canonical producer of the committed packages/editor-runtime/dist/ artifacts:
// a per-module transpile of src/ (no bundling) so Rails importmap pins,
// the desktop esbuild bundle, and node --test resolve the same relative
// module graph. Dynamic import() calls are preserved (desktop code-splits
// them; Rails resolves them relative to the served module URL).
import { readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";

const here = dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);
const esbuild = require("esbuild");

function entries(dir) {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) return entries(full);
    if (entry.isFile() && entry.name.endsWith(".ts") && !entry.name.endsWith(".d.ts")) return [full];
    return [];
  });
}

esbuild.buildSync({
  entryPoints: entries(join(here, "src")),
  outdir: join(here, "dist"),
  outbase: join(here, "src"),
  format: "esm",
  platform: "browser",
  target: "es2022",
  logLevel: "warning",
});
console.log("packages/editor-runtime: dist/ transpiled from src/");
