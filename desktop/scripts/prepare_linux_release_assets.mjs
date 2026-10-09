import { createHash } from "node:crypto"
import { createReadStream } from "node:fs"
import { mkdir, readFile, writeFile } from "node:fs/promises"
import path from "node:path"
import { fileURLToPath } from "node:url"

const scriptPath = fileURLToPath(import.meta.url)
if (process.argv[1] && path.resolve(process.argv[1]) === scriptPath) await main()

export function buildLinuxArtifactMetadata({ version, sourceSha, pr, archive, checksumFile, provenanceFile, checksum, provenance }) {
  if (!/^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/.test(version)) throw new TypeError("a semantic release version is required")
  if (!/^[a-f0-9]{40}$/i.test(sourceSha)) throw new TypeError("an exact source commit SHA is required")
  if (!Number.isInteger(pr) || pr < 1) throw new TypeError("a merged pull request number is required")
  const filename = `elef-${version}-x86_64.tar.zst`
  if (archive.name !== filename || checksumFile.name !== `${filename}.sha256` || provenanceFile.name !== `${filename}.provenance.json`) {
    throw new TypeError("Linux release files must use the reserved versioned archive and sidecar names")
  }
  if (!/^[a-f0-9]{64}$/i.test(checksum) || checksum.toLowerCase() !== provenance.sha256?.toLowerCase()) {
    throw new TypeError("Linux release checksum does not match its provenance record")
  }
  if (provenance.version !== version || provenance.main_sha !== sourceSha.toLowerCase() || provenance.platform !== "linux" || provenance.architecture !== "x86_64" || provenance.archive !== filename) {
    throw new TypeError("Linux release provenance does not match the reserved source and package identity")
  }
  const baseUrl = `https://github.com/Hansespinosa2/elef/releases/download/desktop-v${version}/`
  return {
    version,
    tag: `desktop-v${version}`,
    source_sha: sourceSha.toLowerCase(),
    pr,
    platform: "linux_asset",
    artifact: {
      version,
      source_sha: sourceSha.toLowerCase(),
      architecture: "x86_64",
      filename,
      asset_url: `${baseUrl}${filename}`,
      sha256: checksum.toLowerCase(),
      format: "arch-native"
    },
    files: [archive, checksumFile, provenanceFile]
  }
}

async function main() {
  const [version, sourceSha, prText, releaseDirectoryValue, outputValue] = process.argv.slice(2)
  if (!version || !sourceSha || !prText || !releaseDirectoryValue || !outputValue) {
    throw new Error("Usage: node prepare_linux_release_assets.mjs <version> <source-sha> <pr> <release-directory> <output-json>")
  }
  const pr = Number(prText)
  const releaseDirectory = path.resolve(releaseDirectoryValue)
  const filename = `elef-${version}-x86_64.tar.zst`
  const archive = { name: filename, path: path.join(releaseDirectory, filename), contentType: "application/zstd" }
  const checksumFile = { name: `${filename}.sha256`, path: `${archive.path}.sha256`, contentType: "text/plain" }
  const provenanceFile = { name: `${filename}.provenance.json`, path: `${archive.path}.provenance.json`, contentType: "application/json" }
  const checksum = parseChecksum(await readFile(checksumFile.path, "utf8"), filename)
  const provenance = JSON.parse(await readFile(provenanceFile.path, "utf8"))
  const archiveHash = await hashFile(archive.path)
  if (archiveHash !== checksum) throw new Error("Arch archive bytes do not match the generated SHA-256 sidecar")
  const metadata = buildLinuxArtifactMetadata({ version, sourceSha, pr, archive, checksumFile, provenanceFile, checksum, provenance })
  metadata.files = await Promise.all(metadata.files.map(async file => ({ ...file, sha256: await hashFile(file.path) })))
  const output = path.resolve(outputValue)
  await mkdir(path.dirname(output), { recursive: true })
  await writeFile(output, `${JSON.stringify(metadata, null, 2)}\n`, { mode: 0o600 })
  process.stdout.write(`Verified Arch archive, SHA-256 sidecar, and source provenance for ${version}.\n`)
}

function parseChecksum(serialized, filename) {
  const match = /^([a-f0-9]{64})\s+\*?([^\r\n]+)\s*$/i.exec(serialized)
  if (!match || match[2] !== filename) throw new Error("Arch checksum sidecar does not identify the expected versioned archive")
  return match[1].toLowerCase()
}

async function hashFile(filename) {
  const hash = createHash("sha256")
  for await (const chunk of createReadStream(filename)) hash.update(chunk)
  return hash.digest("hex")
}
