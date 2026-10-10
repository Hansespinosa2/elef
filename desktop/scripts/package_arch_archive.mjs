import path from "node:path"
import { packageArchArchive } from "../release/arch-package.mjs"

const [version, binaryPath, outputDirectory] = process.argv.slice(2)
if (!version || !binaryPath || !outputDirectory || !process.env.ELEF_BUILD_SHA) {
  throw new Error("Usage: ELEF_BUILD_SHA=<commit> node desktop/scripts/package_arch_archive.mjs <version> <binary> <output-directory>")
}
const result = await packageArchArchive({
  version,
  binaryPath: path.resolve(binaryPath),
  outputDirectory: path.resolve(outputDirectory),
  buildSha: process.env.ELEF_BUILD_SHA
})
process.stdout.write(`${JSON.stringify(result)}\n`)
