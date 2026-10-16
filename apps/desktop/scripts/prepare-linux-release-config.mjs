import { writeFile } from "node:fs/promises"
import path from "node:path"
import { fileURLToPath } from "node:url"

const scriptDirectory = path.dirname(fileURLToPath(import.meta.url))
const outputPath = path.resolve(process.argv[2] || path.join(scriptDirectory, "../src-tauri/tauri.linux-release.generated.conf.json"))
const version = process.env.DESKTOP_RELEASE_VERSION || ""
if (!/^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/.test(version)) {
  throw new Error("DESKTOP_RELEASE_VERSION must be a numeric semantic version such as 0.1.0.")
}

await writeFile(outputPath, `${JSON.stringify({ version, bundle: { createUpdaterArtifacts: false } }, null, 2)}\n`, { mode: 0o600 })
