// Canonical producer of the gitignored packages/client/dist/ artifacts: the
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
import { readFileSync, writeFileSync } from "node:fs";
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
  // Highlight.js's PHP grammar contains a literal tab before a template
  // newline. Preserve the template value without committing trailing tabs
  // when a renderer-dependent client artifact is rebuilt.
  const output = readFileSync(outfile, "utf8").replaceAll("[ \t\n", "[ \\t\n");
  writeFileSync(outfile, output);
  writeFileSync(outfile.replace(/\.js$/, ".metafile.json"), `${JSON.stringify(result.metafile, null, 2)}\n`);
}

// Build layering: client/preview-core and client/pptx-model need
// @elef/renderer dist, and editor-runtime needs @elef/client dist — one
// topological pass (`npm run build:packages`: work-model, renderer,
// client, editor-runtime). The renderer composition entry lives in
// editor-runtime, so no package builds against editor-runtime dist except
// editor-runtime itself, and the former --skip-renderer-deps bootstrap is
// gone.

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
// The keyboard registry is dependency-free, so web adapters, desktop
// adapters, and tests import this slice instead of the boot barrel.
bundle(
  join(here, "src", "features", "shortcuts", "shortcuts.ts"),
  join(here, "dist", "shortcuts.js"),
);
// The port session is dependency-free (contracts types erase), so hosts that
// only need session coordination import this slice instead of the boot
// bundle; in particular the Stable desktop entry stays a single client copy.
bundle(join(here, "src", "session", "port_session.ts"), join(here, "dist", "port-session.js"));
bundle(join(here, "src", "pptx-test-internals.ts"), join(here, "dist", "pptx-test-internals.js"));
// The PPTX model builder (work-model + renderer) ships as a deferred entry
// beside preview-core: server-less hosts import it on demand while the boot
// barrel stays free of the projection.
bundle(join(here, "src", "features", "export", "pptx_model.ts"), join(here, "dist", "pptx-model.js"));
// The CodeMirror editing engine (source and visual presentations of one
// session) ships as its own entry: the editor-runtime Stimulus shell keeps
// the engine external and both hosts resolve this file once. Device
// preferences stay external so the engine shares the canonical
// vim-preferences chunk with the settings surfaces instead of inlining a
// second copy (the desktop profile checker pins the shared input).
// CodeMirror, KaTeX, and the Vim bindings stay external for the same
// identity reason: the editor-runtime shell imports the importmap-pinned
// copies, and a second bundled copy would split StateField identity so
// cross-boundary syntaxTree reads (palette suppression, math shorthand
// code guards) silently see an empty tree.
// The engine imports no renderer dist.
const editorExternals = [
  "@elef/client/vim-preferences",
  "codemirror",
  "codemirror/*",
  "@codemirror/*",
  "@lezer/highlight",
  "@lezer/highlight/*",
  "@replit/codemirror-vim",
  "@replit/codemirror-vim/*",
  "katex",
  "katex/*",
];
bundle(join(here, "src", "features", "editor", "index.ts"), join(here, "dist", "editor.js"), {
  external: editorExternals,
});
bundle(join(here, "src", "features", "editor", "test_internals.ts"), join(here, "dist", "editor-test-internals.js"), {
  external: editorExternals,
});
// The PPTX engine (model-to-blob orchestration) ships beside the builder:
// the desktop import must not couple to the client boot barrel, whose bare
// specifier the Stable profile forbids.
bundle(join(here, "src", "features", "export", "pptx_engine.ts"), join(here, "dist", "pptx-engine.js"));
console.log(
  "packages/client built: dist/elef-client.js + dist/elef-client.stable.js + dist/sanitize.js + dist/presentation-chrome.js + dist/vim-preferences.js + dist/shortcuts.js + dist/port-session.js + dist/pptx-test-internals.js + dist/pptx-engine.js + dist/preview-core.js + dist/pptx-model.js + dist/editor.js + dist/editor-test-internals.js"
);
