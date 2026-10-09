import { createHash } from "node:crypto"
import { createReadStream } from "node:fs"
import { mkdir, readdir, readFile, writeFile } from "node:fs/promises"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { spawnSync } from "node:child_process"

const scriptPath = fileURLToPath(import.meta.url)
if (process.argv[1] && path.resolve(process.argv[1]) === scriptPath) await main()

export function buildMacosArtifactMetadata({ version, sourceSha, pr, updaterBundle, updaterSignature, dmg, signature }) {
  if (!isVersion(version)) throw new TypeError("a semantic release version is required")
  if (!/^[a-f0-9]{40}$/i.test(sourceSha)) throw new TypeError("an exact source commit SHA is required")
  if (!Number.isInteger(pr) || pr < 1) throw new TypeError("a merged pull request number is required")
  for (const file of [updaterBundle, updaterSignature, dmg]) {
    if (!file || !/^[A-Za-z0-9._+-]+$/.test(file.name) || !/^[a-f0-9]{64}$/i.test(file.sha256)) {
      throw new TypeError("macOS artifacts need safe immutable filenames and SHA-256 digests")
    }
  }
  if (updaterSignature.name !== `${updaterBundle.name}.sig` || typeof signature !== "string" || signature.length === 0) {
    throw new TypeError("the signed updater archive and its signature file must be paired")
  }
  const tag = `desktop-v${version}`
  const baseUrl = `https://github.com/Hansespinosa2/elef/releases/download/${tag}/`
  return {
    version,
    tag,
    source_sha: sourceSha.toLowerCase(),
    pr,
    platform: "macos",
    artifact: {
      version,
      source_sha: sourceSha.toLowerCase(),
      architecture: "aarch64",
      updater_url: `${baseUrl}${updaterBundle.name}`,
      updater_sha256: updaterBundle.sha256.toLowerCase(),
      signature: signature.trim(),
      signature_verified: true,
      dmg_url: `${baseUrl}${dmg.name}`,
      dmg_sha256: dmg.sha256.toLowerCase()
    },
    files: [updaterBundle, updaterSignature, dmg]
  }
}

async function main() {
  const [version, sourceSha, prValue, bundleRootValue, outputPathValue] = process.argv.slice(2)
  const publicKey = process.env.TAURI_UPDATER_PUBKEY?.trim()
  if (!version || !sourceSha || !prValue || !bundleRootValue || !outputPathValue || !publicKey) {
    throw new Error("Usage: TAURI_UPDATER_PUBKEY=<public-key> node prepare_macos_release_assets.mjs <version> <source-sha> <pr> <bundle-root> <output-json>")
  }
  const bundleRoot = path.resolve(bundleRootValue)
  const files = await findFiles(bundleRoot)
  const updaterBundles = files.filter(file => file.name.endsWith(".app.tar.gz"))
  const signatures = files.filter(file => file.name.endsWith(".app.tar.gz.sig"))
  const dmgs = files.filter(file => file.name.endsWith(".dmg"))
  const updaterBundle = only(updaterBundles, "Tauri updater archive")
  const updaterSignature = only(signatures, "Tauri updater signature")
  const dmg = only(dmgs, "macOS DMG")
  if (updaterSignature.path !== `${updaterBundle.path}.sig`) throw new Error("updater signature file does not match the archive name")

  const verification = spawnSync(process.execPath, [
    path.join(path.dirname(scriptPath), "verify_updater_signature.mjs"),
    updaterBundle.path,
    updaterSignature.path,
    version
  ], {
    encoding: "utf8",
    env: process.env,
    maxBuffer: 1024 * 1024
  })
  if (verification.error || verification.status !== 0) {
    process.stderr.write(verification.stderr || "updater signature verification failed\n")
    process.exit(verification.status || 1)
  }

  const artifact = buildMacosArtifactMetadata({
    version,
    sourceSha,
    pr: Number(prValue),
    updaterBundle: await describe(updaterBundle),
    updaterSignature: await describe(updaterSignature),
    dmg: await describe(dmg),
    signature: await readFile(updaterSignature.path, "utf8")
  })
  const outputPath = path.resolve(outputPathValue)
  await mkdir(path.dirname(outputPath), { recursive: true })
  await writeFile(outputPath, `${JSON.stringify(artifact, null, 2)}\n`, { mode: 0o600 })
  process.stdout.write(`Verified macOS updater signature and packaged release assets for ${version}.\n`)
}

async function findFiles(root) {
  const output = []
  for (const entry of await readdir(root, { withFileTypes: true })) {
    const fullPath = path.join(root, entry.name)
    if (entry.isDirectory()) output.push(...await findFiles(fullPath))
    else if (entry.isFile()) output.push({ name: entry.name, path: fullPath })
  }
  return output
}

function only(values, description) {
  if (values.length !== 1) throw new Error(`expected one ${description}; found ${values.length}`)
  return values[0]
}

async function describe(file) {
  const hash = createHash("sha256")
  for await (const chunk of createReadStream(file.path)) hash.update(chunk)
  return { ...file, sha256: hash.digest("hex"), contentType: contentType(file.name) }
}

function contentType(name) {
  if (name.endsWith(".dmg")) return "application/x-apple-diskimage"
  if (name.endsWith(".tar.gz")) return "application/gzip"
  return "text/plain"
}

function isVersion(value) {
  return typeof value === "string" && /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/.test(value)
}
