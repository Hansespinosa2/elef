import { mkdir, readFile, writeFile } from "node:fs/promises"
import { fileURLToPath } from "node:url"
import path from "node:path"
import { build } from "esbuild"

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..")
const output = path.join(repoRoot, "vendor/javascript/elef-renderer.bundle.js")
await mkdir(path.dirname(output), { recursive: true })

await build({
  entryPoints: [path.join(repoRoot, "app/javascript/lib/renderer_global.js")],
  bundle: true,
  format: "iife",
  target: "es2022",
  outfile: output,
  minify: true,
  legalComments: "none"
})

// Keep Highlight.js's PHP whitespace template semantically intact without
// emitting a physical tab at end-of-line in the checked-in bundle.
const bundle = await readFile(output, "utf8")
const rawWhitespace = "[ \t\n"
const occurrences = bundle.split(rawWhitespace).length - 1
if (occurrences !== 1) throw new Error(`Expected one Highlight.js whitespace template, found ${occurrences}.`)
await writeFile(output, bundle.replace(rawWhitespace, "[ \\t\n"))
