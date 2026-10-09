import path from "node:path"
import { writeArchPkgbuild } from "../release/arch-package.mjs"

const [version, sha256, outputPath, localSourceUrl] = process.argv.slice(2)
if (!version || !sha256 || !outputPath) {
  throw new Error("Usage: node desktop/scripts/render_arch_pkgbuild.mjs <version> <sha256> <output-path> [loopback-source-url]")
}
await writeArchPkgbuild({
  version,
  sha256,
  outputPath: path.resolve(outputPath),
  sourceUrl: localSourceUrl,
  allowLoopback: Boolean(localSourceUrl)
})
process.stdout.write(`Rendered ${path.resolve(outputPath)}\n`)
