import { createHash } from "node:crypto"
import { readFile, lstat } from "node:fs/promises"

const API_VERSION = "2026-03-10"
const VERSION_PATTERN = /^desktop-v(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/
const SHA_PATTERN = /^[a-f0-9]{40}$/i
const SHA256_PATTERN = /^[a-f0-9]{64}$/i

export class GitHubPublisher {
  constructor({ owner, repository, token, apiUrl = "https://api.github.com", fetchImpl = fetch, sleep = delay, now = () => new Date().toISOString() }) {
    if (!owner || !repository || !token) throw new TypeError("GitHub publication needs repository identity and a token")
    this.owner = owner
    this.repository = repository
    this.token = token
    this.apiUrl = apiUrl.replace(/\/$/, "")
    this.repoPath = `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repository)}`
    this.fetchImpl = fetchImpl
    this.sleep = sleep
    this.now = now
  }

  async ensureTagAt(tag, sourceSha) {
    validateTag(tag)
    validateSha(sourceSha)
    const refPath = `/git/ref/tags/${encodeURIComponent(tag)}`
    const existing = await this.request(refPath, { allowNotFound: true })
    if (existing) {
      const observed = await this.resolveRefCommit(existing)
      if (observed !== sourceSha) throw new Error(`immutable release tag ${tag} already points to another source commit`)
      return { created: false, commitSha: observed }
    }

    const tagObject = await this.request("/git/tags", {
      method: "POST",
      body: {
        tag,
        message: `Elef Desktop ${tag} — Personal testing`,
        object: { sha: sourceSha, type: "commit" },
        tagger: { name: "Elef Release Coordinator", email: "41898282+github-actions[bot]@users.noreply.github.com", date: this.now() }
      }
    })
    validateSha(tagObject.sha)
    try {
      await this.request("/git/refs", {
        method: "POST",
        body: { ref: `refs/tags/${tag}`, sha: tagObject.sha }
      })
    } catch (error) {
      if (error.status !== 422) throw error
      const raced = await this.request(refPath, { allowNotFound: true })
      if (!raced || await this.resolveRefCommit(raced) !== sourceSha) throw error
      return { created: false, commitSha: sourceSha }
    }
    const created = await this.request(refPath)
    const observed = await this.resolveRefCommit(created)
    if (observed !== sourceSha) throw new Error(`new release tag ${tag} does not resolve to its reserved source commit`)
    return { created: true, commitSha: observed }
  }

  async ensureDraftRelease({ tag, version, sourceSha, pr }) {
    validateTag(tag)
    if (tag !== `desktop-v${version}`) throw new TypeError("release tag and version do not match")
    validateSha(sourceSha)
    if (!Number.isInteger(pr) || pr < 1) throw new TypeError("release metadata needs the merged pull request number")
    const tagCommit = await this.request(`/git/ref/tags/${encodeURIComponent(tag)}`)
    if (await this.resolveRefCommit(tagCommit) !== sourceSha) throw new Error(`release tag ${tag} does not point to its reserved source commit`)
    const existing = await this.request(`/releases/tags/${encodeURIComponent(tag)}`, { allowNotFound: true })
    if (existing) {
      if (existing.tag_name !== tag || !Number.isInteger(existing.id)) throw new Error(`GitHub release metadata for ${tag} is inconsistent`)
      return { created: false, release: existing }
    }
    const release = await this.request("/releases", {
      method: "POST",
      body: {
        tag_name: tag,
        target_commitish: sourceSha,
        name: `Elef Desktop ${version} — Personal testing`,
        body: releaseNotes({ version, sourceSha, pr, macos: "pending", linuxAsset: "pending", aur: "pending" }),
        draft: true,
        prerelease: false
      }
    })
    if (release.tag_name !== tag || !release.draft) throw new Error(`GitHub did not create ${tag} as a draft release`)
    return { created: true, release }
  }

  async ensureReleaseAssets(release, files, { beforeUpload = async () => {} } = {}) {
    if (!release || !Number.isInteger(release.id) || !Array.isArray(files) || files.length === 0) {
      throw new TypeError("asset publication needs a GitHub release and one or more files")
    }
    const seen = new Set()
    const results = []
    for (const file of files) {
      validateAssetFile(file)
      if (seen.has(file.name)) throw new TypeError(`duplicate release asset name ${file.name}`)
      seen.add(file.name)
      const info = await lstat(file.path)
      if (!info.isFile() || info.isSymbolicLink()) throw new Error(`release asset ${file.name} must be a regular file`)
      const bytes = await readFile(file.path)
      const sha256 = createHash("sha256").update(bytes).digest("hex")
      if (sha256 !== file.sha256.toLowerCase()) throw new Error(`local release asset ${file.name} does not match its recorded SHA-256`)
      const current = await this.request(`/releases/${release.id}`)
      if (!Array.isArray(current.assets)) throw new Error(`GitHub release ${release.id} has no readable asset list`)
      const matches = current.assets.filter(asset => asset.name === file.name)
      if (matches.length > 1) throw new Error(`GitHub release ${release.id} contains duplicate asset ${file.name}`)
      if (matches.length === 1) {
        const remoteSha = await this.releaseAssetSha256(matches[0])
        if (remoteSha !== sha256) throw new Error(`immutable release asset ${file.name} already exists with different bytes`)
        results.push({ name: file.name, sha256, uploaded: false })
        continue
      }
      await beforeUpload({ name: file.name, sha256 })
      const immediatelyCurrent = await this.request(`/releases/${release.id}`)
      const justCreated = immediatelyCurrent.assets?.filter(asset => asset.name === file.name) || []
      if (justCreated.length > 1) throw new Error(`GitHub release ${release.id} contains duplicate asset ${file.name}`)
      if (justCreated.length === 1) {
        const remoteSha = await this.releaseAssetSha256(justCreated[0])
        if (remoteSha !== sha256) throw new Error(`immutable release asset ${file.name} already exists with different bytes`)
        results.push({ name: file.name, sha256, uploaded: false })
        continue
      }
      const uploaded = await this.uploadReleaseAsset(current, file.name, bytes, sha256, file.contentType)
      results.push({ name: file.name, sha256, uploaded })
    }
    return results
  }

  async exposeRelease(release, body, verifiedAssets) {
    if (!release || !Number.isInteger(release.id) || typeof body !== "string" || body.length === 0 || !Array.isArray(verifiedAssets) || verifiedAssets.length === 0) {
      throw new TypeError("public release needs metadata, a status body, and verified platform assets")
    }
    const current = await this.request(`/releases/${release.id}`)
    if (!Array.isArray(current.assets)) throw new Error("a release cannot become public without a readable asset list")
    for (const verified of verifiedAssets) {
      validateAssetFile({ ...verified, path: verified.path || "/verified/asset" })
      const remote = current.assets.find(asset => asset.name === verified.name)
      if (!remote || await this.releaseAssetSha256(remote) !== verified.sha256.toLowerCase()) {
        throw new Error(`release asset ${verified.name} is not remotely verified`)
      }
    }
    return this.request(`/releases/${release.id}`, { method: "PATCH", body: { body, draft: false } })
  }

  async updateReleaseNotes(release, body) {
    if (!release || !Number.isInteger(release.id) || typeof body !== "string" || body.length === 0) {
      throw new TypeError("release notes update needs release metadata and a nonempty body")
    }
    return this.request(`/releases/${release.id}`, { method: "PATCH", body: { body } })
  }

  async resolveRefCommit(ref) {
    let object = ref?.object
    for (let depth = 0; object && depth < 8; depth += 1) {
      validateSha(object.sha)
      if (object.type === "commit") return object.sha
      if (object.type !== "tag") throw new Error("release tag ref must ultimately point to a commit")
      const tag = await this.request(`/git/tags/${object.sha}`)
      object = tag.object
    }
    throw new Error("release tag contains an invalid or excessively nested tag object")
  }

  async releaseAssetSha256(asset) {
    if (typeof asset.digest === "string" && /^sha256:[a-f0-9]{64}$/i.test(asset.digest)) return asset.digest.slice("sha256:".length).toLowerCase()
    if (!Number.isInteger(asset.id)) throw new Error("existing GitHub asset lacks a verifiable digest and ID")
    const response = await this.fetchWithRetry(`${this.apiUrl}${this.repoPath}/releases/assets/${asset.id}`, {
      headers: this.headers({ Accept: "application/octet-stream" })
    })
    if (!response.ok) throw new Error(`could not verify existing release asset ${asset.name}`)
    const bytes = Buffer.from(await response.arrayBuffer())
    return createHash("sha256").update(bytes).digest("hex")
  }

  async uploadReleaseAsset(release, name, bytes, sha256, contentType = "application/octet-stream") {
    const baseUploadUrl = String(release.upload_url || "").replace(/\{.*$/, "")
    if (!baseUploadUrl.startsWith("https://uploads.github.com/") && !baseUploadUrl.startsWith(`${this.apiUrl}/`)) {
      throw new Error("GitHub release returned an unexpected asset upload URL")
    }
    const uploadUrl = new URL(baseUploadUrl)
    uploadUrl.searchParams.set("name", name)
    const response = await this.fetchWithRetry(uploadUrl.href, {
      method: "POST",
      headers: this.headers({ "Content-Type": contentType, "Content-Length": String(bytes.length) }),
      body: bytes
    })
    if (!response.ok) throw new Error(`could not upload release asset ${name} (HTTP ${response.status})`)
    const uploaded = await response.json()
    if (uploaded.name !== name || uploaded.state !== "uploaded" || uploaded.size !== bytes.length) {
      throw new Error(`GitHub returned incomplete metadata for uploaded asset ${name}`)
    }
    if (uploaded.digest && uploaded.digest.toLowerCase() !== `sha256:${sha256}`) {
      throw new Error(`GitHub verified a different digest for uploaded asset ${name}`)
    }
    return true
  }

  async request(resourcePath, { method = "GET", body, allowNotFound = false } = {}) {
    const response = await this.fetchWithRetry(`${this.apiUrl}${this.repoPath}${resourcePath}`, {
      method,
      headers: this.headers({ "Content-Type": "application/json" }),
      ...(body === undefined ? {} : { body: JSON.stringify(body) })
    })
    if (allowNotFound && response.status === 404) return null
    if (!response.ok) {
      const error = new Error(`GitHub publication API returned HTTP ${response.status} for ${method} ${resourcePath}`)
      error.status = response.status
      throw error
    }
    return response.status === 204 ? null : response.json()
  }

  async fetchWithRetry(url, options) {
    let lastError
    for (let attempt = 0; attempt < 5; attempt += 1) {
      try {
        const response = await this.fetchImpl(url, {
          ...options,
          headers: { ...options.headers, "X-GitHub-Api-Version": API_VERSION }
        })
        if (response.status !== 429 && response.status < 500) return response
        const retryAfter = Number(response.headers?.get?.("retry-after"))
        await this.sleep(Number.isFinite(retryAfter) && retryAfter > 0 ? retryAfter * 1000 : 250 * (attempt + 1))
        lastError = new Error(`GitHub publication API temporarily returned HTTP ${response.status}`)
      } catch {
        lastError = new Error("GitHub publication API request failed after a transient network error")
        await this.sleep(250 * (attempt + 1))
      }
    }
    throw lastError || new Error("GitHub publication API request failed")
  }

  headers(extra = {}) {
    return {
      Accept: "application/vnd.github+json",
      Authorization: `Bearer ${this.token}`,
      ...extra
    }
  }
}

export function releaseNotes({ version, sourceSha, pr, macos, linuxAsset, aur, aurPackage = null, blockedReason = null }) {
  if (!VERSION_PATTERN.test(`desktop-v${version}`)) throw new TypeError("release notes need a semantic version")
  validateSha(sourceSha)
  if (aurPackage !== null && !["elef-bin", "elef-desktop-bin"].includes(aurPackage)) throw new TypeError("release notes contain an unapproved AUR package name")
  const aurPackageLine = aurPackage ? "**AUR package:** `" + aurPackage + "`" : null
  if (!Number.isInteger(pr) || pr < 1) throw new TypeError("release notes need the merged pull request number")
  if (blockedReason) {
    return [
      `# Elef Desktop ${version} — Personal testing`,
      "",
      "**Status: BLOCKED — do not install or update to this version.**",
      `**Reason:** ${blockedReason}`,
      `**Source SHA:** \`${sourceSha}\``,
      `**Merged PR:** #${pr}`,
      ...(aurPackageLine ? [aurPackageLine] : []),
      "",
      "Stop installing this version. Previously published artifacts remain available for recovery, and automatic macOS updates exclude this version. AUR packages already fetched or installed cannot be recalled centrally; use a higher owner-approved fixed version once it is available."
    ].join("\n")
  }
  const statuses = { macOS: macos, Linux: linuxAsset, AUR: aur }
  for (const status of Object.values(statuses)) {
    if (!["pending", "passed", "failed", "superseded"].includes(status)) throw new TypeError("release notes contain an invalid platform status")
  }
  const complete = Object.values(statuses).every(status => status === "passed")
  const pending = Object.entries(statuses)
    .filter(([, status]) => status !== "passed")
    .map(([name, status]) => `${name} ${status}`)
  const statusLine = complete ? "Complete" : `Partial — ${pending.join("; ")}`
  return [
    `# Elef Desktop ${version} — Personal testing`,
    "",
    `**Status:** ${statusLine}`,
    `**Source SHA:** \`${sourceSha}\``,
    `**Merged PR:** #${pr}`,
    ...(aurPackageLine ? [aurPackageLine] : []),
    "",
    "| Distribution | Status |",
    "| --- | --- |",
    `| macOS Apple Silicon DMG and signed updater archive | ${macos} |`,
    `| Arch-compatible Linux x86-64 archive | ${linuxAsset} |`,
    `| AUR package | ${aur} |`,
    "",
    "This v0.x release is for personal testing. It is not Developer ID signed or notarized."
  ].join("\n")
}

function validateTag(tag) {
  if (typeof tag !== "string" || !VERSION_PATTERN.test(tag)) throw new TypeError("release tag must have the form desktop-v0.1.0")
}

function validateSha(value) {
  if (typeof value !== "string" || !SHA_PATTERN.test(value)) throw new TypeError("release source must be a full 40-character commit SHA")
}

function validateAssetFile(file) {
  if (!file || typeof file.path !== "string" || file.path.length === 0 || typeof file.name !== "string" || !/^[A-Za-z0-9._+-]+$/.test(file.name)) {
    throw new TypeError("release assets need a local path and a safe immutable filename")
  }
  if (typeof file.sha256 !== "string" || !SHA256_PATTERN.test(file.sha256)) throw new TypeError(`release asset ${file.name} needs a SHA-256`)
  if (file.contentType !== undefined && typeof file.contentType !== "string") throw new TypeError(`release asset ${file.name} has an invalid content type`)
}

function delay(milliseconds) {
  return new Promise(resolve => setTimeout(resolve, milliseconds))
}
