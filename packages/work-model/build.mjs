// Canonical producer of the committed packages/work-model/dist/ artifacts,
// mirroring the packages/client dist pattern: one self-contained ESM bundle
// per export subpath, which both hosts consume (importmap pins, desktop
// build, node). The barrel entry keeps its bare self-referential specifiers
// external so it re-exports the sibling dist entries at runtime instead of
// inlining them; the module entries bundle standalone (transforms couples to
// the map only through erased type imports).
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
  minify: true,
  logLevel: "warning",
};

esbuild.buildSync({
  ...shared,
  entryPoints: [join(here, "src", "document_map.ts")],
  outfile: join(here, "dist", "document-map.js"),
});
esbuild.buildSync({
  ...shared,
  entryPoints: [join(here, "src", "document_links.ts")],
  outfile: join(here, "dist", "document-links.js"),
});
esbuild.buildSync({
  ...shared,
  entryPoints: [join(here, "src", "document_transforms.ts")],
  outfile: join(here, "dist", "document-transforms.js"),
});
esbuild.buildSync({
  ...shared,
  entryPoints: [join(here, "src", "index.ts")],
  outfile: join(here, "dist", "elef-work-model.js"),
  external: ["@elef/work-model/*"],
});
console.log("packages/work-model: dist/elef-work-model.js + dist/document-map.js + dist/document-links.js + dist/document-transforms.js built");
