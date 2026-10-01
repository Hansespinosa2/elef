import { writeFile } from "node:fs/promises"
import path from "node:path"
import { fileURLToPath } from "node:url"

const scriptDirectory = path.dirname(fileURLToPath(import.meta.url))
const outputPath = path.resolve(process.argv[2] || path.join(scriptDirectory, "../src-tauri/tauri.release.generated.conf.json"))
const publicKey = process.env.TAURI_UPDATER_PUBKEY?.trim()

if (!publicKey || publicKey.includes("REPLACE_WITH")) {
  throw new Error("Set the repository variable TAURI_UPDATER_PUBKEY before creating a desktop release.")
}

await writeFile(outputPath, `${JSON.stringify({
  bundle: { createUpdaterArtifacts: true },
  plugins: {
    updater: {
      pubkey: publicKey,
      endpoints: ["https://github.com/Hansespinosa2/elef/releases/latest/download/latest.json"]
    }
  }
}, null, 2)}\n`, { mode: 0o600 })
