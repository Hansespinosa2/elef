// Canonical producer of the committed packages/work-model/dist/ artifacts,
// mirroring the packages/client dist pattern: one self-contained ESM bundle
// per export subpath, which both hosts consume (importmap pins, desktop
// build, node). The barrel entry keeps its bare self-referential specifiers
// external so it re-exports the sibling dist entries at runtime instead of
// inlining them; the module entries bundle standalone (transforms couples to
// the map only through erased type imports).
import { writeFileSync } from "node:fs";
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
  metafile: true,
  logLevel: "warning",
};

// Every bundle writes its metafile beside the output (gitignored build
// artifacts): the Stable/Dev profile checker proves slice absence from the
// stable metafiles, so run this build before that checker.
function bundle(entry, outfile, options = {}) {
  const result = esbuild.buildSync({ ...shared, ...options, entryPoints: [entry], outfile });
  writeFileSync(outfile.replace(/\.js$/, ".metafile.json"), `${JSON.stringify(result.metafile, null, 2)}\n`);
}

bundle(join(here, "src", "document_map.ts"), join(here, "dist", "document-map.js"));
bundle(join(here, "src", "document_links.ts"), join(here, "dist", "document-links.js"));
bundle(join(here, "src", "document_transforms.ts"), join(here, "dist", "document-transforms.js"));
bundle(join(here, "src", "art_source.ts"), join(here, "dist", "art-source.js"));
bundle(join(here, "src", "slide_position_layout.ts"), join(here, "dist", "slide-position-layout.js"));
bundle(join(here, "src", "index.ts"), join(here, "dist", "elef-work-model.js"), {
  external: ["@elef/work-model/*"],
});
// The Stable barrel omits the document-links slice; the desktop Stable build
// resolves the bare work-model specifier here while subpath imports keep
// resolving to the shared entries above.
bundle(join(here, "src", "index.stable.ts"), join(here, "dist", "elef-work-model.stable.js"), {
  external: ["@elef/work-model/*"],
});
console.log("packages/work-model: dist/elef-work-model.js + dist/document-map.js + dist/document-links.js + dist/document-transforms.js + dist/art-source.js + dist/slide-position-layout.js + dist/elef-work-model.stable.js built");
