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

// The preview renderer (KaTeX, highlight.js, markdown-it) stays external to
// the boot entry: card previews import "@elef/client/preview-core" beside
// the work snapshot, and hosts serve the entry below as a deferred file.
const previewCoreSpecifier = "@elef/client/preview-core";
esbuild.buildSync({
  ...shared,
  entryPoints: [join(here, "src", "index.ts")],
  outfile: join(here, "dist", "elef-client.js"),
  external: [previewCoreSpecifier],
});
esbuild.buildSync({
  ...shared,
  entryPoints: [join(here, "src", "features", "library", "preview-core.ts")],
  outfile: join(here, "dist", "preview-core.js"),
});
esbuild.buildSync({
  ...shared,
  entryPoints: [join(here, "src", "ui", "sanitize.ts")],
  outfile: join(here, "dist", "sanitize.js"),
});
console.log("packages/client: dist/elef-client.js + dist/preview-core.js + dist/sanitize.js built");
