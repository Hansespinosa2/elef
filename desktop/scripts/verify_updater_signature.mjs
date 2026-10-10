import { spawnSync } from "node:child_process"
import path from "node:path"
import { fileURLToPath } from "node:url"

const [archivePath, signaturePath, version] = process.argv.slice(2)
const publicKey = process.env.TAURI_UPDATER_PUBKEY?.trim()
if (!archivePath || !signaturePath || !version || !publicKey) {
  throw new Error("Usage: TAURI_UPDATER_PUBKEY=<public-key> node verify_updater_signature.mjs <archive> <signature> <version>")
}
if (!/^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/.test(version)) throw new TypeError("A numeric release version is required")

const scriptDirectory = path.dirname(fileURLToPath(import.meta.url))
const verifierManifest = path.join(scriptDirectory, "../release/signature-verifier/Cargo.toml")
const repositoryRoot = path.resolve(scriptDirectory, "../..")
const cargoTarget = process.env.CARGO_TARGET_DIR || path.join(repositoryRoot, "desktop/target/signature-verifier")
const verification = spawnSync("cargo", [
  "run",
  "--quiet",
  "--locked",
  "--manifest-path",
  verifierManifest,
  "--",
  path.resolve(archivePath),
  path.resolve(signaturePath),
  publicKey,
  version
], {
  encoding: "utf8",
  env: { ...process.env, CARGO_TARGET_DIR: cargoTarget },
  maxBuffer: 1024 * 1024
})
if (verification.error || verification.status !== 0) {
  process.stderr.write(verification.stderr || "updater signature verification failed\n")
  process.exit(verification.status || 1)
}
process.stdout.write(verification.stdout)
