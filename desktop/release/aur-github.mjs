import { archReleaseAssetUrl } from "./arch-package.mjs"

export async function verifyPublishedLinuxArtifact({ publisher, candidate, releaseRecord, fetchImpl = fetch }) {
  if (!publisher || !candidate || !releaseRecord || releaseRecord.tag !== candidate.tag) {
    throw new TypeError("AUR validation needs the reserved release, candidate and GitHub publisher")
  }
  if (releaseRecord.blocked || releaseRecord.gate !== "passed" || !releaseRecord.public || releaseRecord.linux_asset.status !== "passed") {
    throw new Error("AUR publishing requires a public, unblocked release with a validated Linux asset")
  }
  const artifact = releaseRecord.linux_asset.artifact
  if (!artifact || artifact.version !== candidate.version || artifact.source_sha !== candidate.main_sha || artifact.architecture !== "x86_64") {
    throw new Error("AUR source metadata does not match the reserved Linux build")
  }
  const archiveName = `elef-${candidate.version}-x86_64.tar.zst`
  const checksumName = `${archiveName}.sha256`
  const provenanceName = `${archiveName}.provenance.json`
  if (artifact.filename !== archiveName || artifact.asset_url !== archReleaseAssetUrl(candidate.version) || !/^[a-f\d]{64}$/i.test(artifact.sha256)) {
    throw new Error("Linux ledger metadata does not identify the exact immutable Arch archive")
  }

  const release = await publisher.request(`/releases/tags/${encodeURIComponent(candidate.tag)}`)
  if (release.tag_name !== candidate.tag || release.draft || release.prerelease) {
    throw new Error("AUR publishing requires the immutable GitHub Release to be public")
  }
  const archive = uniqueAsset(release, archiveName)
  const checksum = uniqueAsset(release, checksumName)
  const provenance = uniqueAsset(release, provenanceName)
  if (await publisher.releaseAssetSha256(archive) !== artifact.sha256.toLowerCase()) {
    throw new Error("public Linux archive digest differs from the validated release ledger")
  }

  const [checksumText, provenanceText] = await Promise.all([
    downloadAsset(checksum, fetchImpl),
    downloadAsset(provenance, fetchImpl)
  ])
  const checksumMatch = /^([a-f\d]{64})\s+\*?([^\r\n]+)\s*$/i.exec(checksumText)
  if (!checksumMatch || checksumMatch[1].toLowerCase() !== artifact.sha256.toLowerCase() || checksumMatch[2] !== archiveName) {
    throw new Error("public Linux SHA-256 sidecar does not match the validated archive")
  }
  let proof
  try {
    proof = JSON.parse(provenanceText)
  } catch {
    throw new Error("public Linux provenance sidecar is invalid")
  }
  if (proof.version !== candidate.version || proof.main_sha !== candidate.main_sha || proof.sha256 !== artifact.sha256 ||
    proof.platform !== "linux" || proof.architecture !== "x86_64" || proof.archive !== archiveName) {
    throw new Error("public Linux provenance does not match the approved source and archive")
  }
  return { release, artifact, archiveName, checksumName, provenanceName }
}

function uniqueAsset(release, name) {
  const matches = (release.assets || []).filter(asset => asset.name === name && asset.state === "uploaded")
  if (matches.length !== 1) throw new Error(`public GitHub Release must contain one uploaded ${name}`)
  const asset = matches[0]
  const expectedUrl = `https://github.com/Hansespinosa2/elef/releases/download/${release.tag_name}/${name}`
  if (asset.browser_download_url !== expectedUrl) throw new Error(`public GitHub Release URL for ${name} is not immutable or canonical`)
  return asset
}

async function downloadAsset(asset, fetchImpl) {
  const response = await fetchImpl(asset.browser_download_url, { redirect: "follow" })
  if (!response.ok || !response.url.startsWith("https://")) throw new Error(`could not download public release sidecar ${asset.name}`)
  const bytes = Buffer.from(await response.arrayBuffer())
  if (bytes.length > 1024 * 1024) throw new Error(`public release sidecar ${asset.name} is unexpectedly large`)
  return bytes.toString("utf8")
}
