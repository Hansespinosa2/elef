// Canonical producer of the committed packages/client/dist/ artifacts: the
// single-file ESM bundle both hosts consume, plus the dependency-free
// sanitizer module the editor/settings hosts import until their slices
// migrate. React, react-dom and the Elef runtime deps are bundled in;
// contract types erase at compile time.
//
// The Stable profile ships dist/elef-client.stable.js, built from the stable
// entry that omits the excluded slices (graph, slide overview, document and
// presentation visual editors). The Stable editor-runtime build aliases the
// bare client specifier to that file, so importing an excluded export fails
// the build instead of shipping hidden code. Every bundle writes its
// metafile beside the output (gitignored); the Stable/Dev profile checker
// proves slice absence from the stable metafiles.
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
  jsx: "automatic",
  minify: true,
  metafile: true,
  define: { "process.env.NODE_ENV": '"production"' },
  logLevel: "warning",
};

function bundle(entry, outfile, options = {}) {
  const result = esbuild.buildSync({ ...shared, ...options, entryPoints: [entry], outfile });
  writeFileSync(outfile.replace(/\.js$/, ".metafile.json"), `${JSON.stringify(result.metafile, null, 2)}\n`);
}

// The preview renderer (KaTeX, highlight.js, markdown-it) stays external to
// the boot entry: card previews import "@elef/client/preview-core" beside
// the work snapshot, and hosts serve the entry below as a deferred file.
const previewCoreSpecifier = "@elef/client/preview-core";
bundle(join(here, "src", "index.ts"), join(here, "dist", "elef-client.js"), {
  external: [previewCoreSpecifier],
});
bundle(join(here, "src", "index.stable.ts"), join(here, "dist", "elef-client.stable.js"), {
  external: [previewCoreSpecifier],
});
bundle(join(here, "src", "features", "library", "preview-core.ts"), join(here, "dist", "preview-core.js"));
bundle(join(here, "src", "ui", "sanitize.ts"), join(here, "dist", "sanitize.js"));
bundle(
  join(here, "src", "features", "presentation", "chrome.ts"),
  join(here, "dist", "presentation-chrome.js"),
);
bundle(
  join(here, "src", "features", "settings", "vimPreferences.ts"),
  join(here, "dist", "vim-preferences.js"),
);
// The port session is dependency-free (contracts types erase), so hosts that
// only need session coordination import this slice instead of the boot
// bundle; in particular the Stable desktop entry stays a single client copy.
bundle(join(here, "src", "session", "port_session.ts"), join(here, "dist", "port-session.js"));
bundle(join(here, "src", "pptx-test-internals.ts"), join(here, "dist", "pptx-test-internals.js"));
console.log("packages/client: dist/elef-client.js + dist/elef-client.stable.js + dist/preview-core.js + dist/sanitize.js + dist/presentation-chrome.js + dist/vim-preferences.js + dist/port-session.js + dist/pptx-test-internals.js built");
