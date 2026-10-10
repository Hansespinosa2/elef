import { writeFile } from "node:fs/promises"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { SAFE_UPDATE_ENDPOINT } from "../release/constants.mjs"

const scriptDirectory = path.dirname(fileURLToPath(import.meta.url))
const outputPath = path.resolve(process.argv[2] || path.join(scriptDirectory, "../src-tauri/tauri.release.generated.conf.json"))
const publicKey = process.env.TAURI_UPDATER_PUBKEY?.trim()
const releaseTag = process.env.DESKTOP_RELEASE_TAG || ""
const version = /^desktop-v(\d+\.\d+\.\d+)$/.exec(releaseTag)?.[1]

if (!version) throw new Error("DESKTOP_RELEASE_TAG must name a stable release, for example desktop-v0.1.0.")

if (!publicKey || publicKey.includes("REPLACE_WITH")) {
  throw new Error("Set the repository variable TAURI_UPDATER_PUBKEY before creating a desktop release.")
}

const keyLines = Buffer.from(publicKey, "base64").toString("utf8").trim().split(/\r?\n/)
const keyBytes = Buffer.from(keyLines[1] || "", "base64")
if (!keyLines[0]?.startsWith("untrusted comment:") || keyBytes.length !== 42 || !["Ed", "ED"].includes(keyBytes.subarray(0, 2).toString())) {
  throw new Error("TAURI_UPDATER_PUBKEY must be a Tauri/minisign public key.")
}

await writeFile(outputPath, `${JSON.stringify({
  version,
  bundle: { createUpdaterArtifacts: true },
  plugins: {
    updater: {
      pubkey: publicKey,
      requireSignedVersion: true,
      endpoints: [SAFE_UPDATE_ENDPOINT]
    }
  }
}, null, 2)}\n`, { mode: 0o600 })
