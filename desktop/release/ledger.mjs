const LEDGER_SCHEMA_VERSION = 1
const PLATFORM_STATUSES = new Set(["pending", "passed", "failed", "superseded"])
const SEMVER_PATTERN = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/
const SHA_PATTERN = /^[a-f0-9]{40}$/i
const SHA256_PATTERN = /^[a-f0-9]{64}$/i

export class ReleaseLedgerError extends Error {
  constructor(message) {
    super(message)
    this.name = "ReleaseLedgerError"
  }
}

export function createLedger({ currentMinor = "0.1", lastReconciledMain = null } = {}) {
  parseMinor(currentMinor)
  assert(lastReconciledMain === null || SHA_PATTERN.test(lastReconciledMain), "initial main watermark must be a commit SHA")
  return {
    schema_version: LEDGER_SCHEMA_VERSION,
    revision: 0,
    last_reconciled_main: lastReconciledMain,
    current_minor: currentMinor,
    minor_changes: [],
    reserved_versions: [],
    processed_merges: [],
    releases: []
  }
}

/**
 * Reconcile an ordered snapshot of first-parent main history. `mainHistory` is
 * oldest to newest, as produced by `git rev-list --first-parent --reverse`.
 * The workflow is responsible for mapping approved merged PRs and exact-SHA
 * Gate A results to each merge commit before calling this pure transition.
 */
export function reconcileMain(ledger, { mainHistory, merges, existingTags = [], expectedRevision, now = () => new Date().toISOString() }) {
  validateLedger(ledger)
  assertRevision(ledger, expectedRevision)
  assert(Array.isArray(mainHistory) && mainHistory.length > 0, "main history must include its current head")
  assert(Array.isArray(merges), "merged PR records must be an array")
  assert(Array.isArray(existingTags), "existing Git tags must be an array")

  const historyIndex = new Map()
  mainHistory.forEach((sha, index) => {
    assert(SHA_PATTERN.test(sha), `invalid main history SHA: ${sha}`)
    assert(!historyIndex.has(sha), `main history contains duplicate SHA ${sha}`)
    historyIndex.set(sha, index)
  })

  const candidates = merges.filter(merge => merge.base === "main" && merge.merged === true && merge.approved === true)
  for (const merge of candidates) {
    assert(Number.isInteger(merge.pr) && merge.pr > 0, "approved merge needs its pull request number")
    assert(SHA_PATTERN.test(merge.sha), `invalid merge SHA: ${merge.sha}`)
    assert(historyIndex.has(merge.sha), `approved merge ${merge.sha} is not in the supplied main history`)
    assert(["passed", "failed_gate"].includes(merge.gate), `merge ${merge.sha} needs a terminal Gate A result`)
  }

  const ordered = [...candidates].sort((a, b) => historyIndex.get(a.sha) - historyIndex.get(b.sha))
  const next = clone(ledger)
  const existingTagSet = new Set(existingTags)
  let changed = false

  for (const merge of ordered) {
    const previous = next.processed_merges.find(item => item.sha === merge.sha)
    if (previous) {
      assert(previous.pr === merge.pr, `merge SHA ${merge.sha} is already assigned to PR #${previous.pr}`)
      continue
    }
    const previousPr = next.processed_merges.find(item => item.pr === merge.pr)
    assert(!previousPr, `PR #${merge.pr} already has a different main merge SHA`)

    let version = null
    let tag = null
    if (merge.gate === "passed") {
      const reservation = reserveVersion(next, merge, existingTagSet, now)
      version = reservation.version
      tag = reservation.tag
      next.releases.push(createRelease({ version, tag, merge, createdAt: reservation.created_at }))
    }
    next.processed_merges.push({
      sha: merge.sha,
      pr: merge.pr,
      main_order: historyIndex.get(merge.sha),
      gate: merge.gate,
      version,
      tag,
      processed_at: now()
    })
    changed = true
  }

  const mainHead = mainHistory.at(-1)
  if (next.last_reconciled_main !== mainHead) {
    next.last_reconciled_main = mainHead
    changed = true
  }
  if (changed) next.revision += 1
  validateLedger(next)
  return next
}

/** Record a manually authorized minor milestone; merge labels never select it. */
export function selectMinorMilestone(ledger, minor, { actor, reason, expectedRevision, at = new Date().toISOString() } = {}) {
  validateLedger(ledger)
  assertRevision(ledger, expectedRevision)
  parseMinor(minor)
  assertNonempty(actor, "minor milestone change needs an authorized actor")
  assertNonempty(reason, "minor milestone change needs an authorization reason")
  if (minor === ledger.current_minor) {
    const previous = ledger.minor_changes.at(-1)
    assert(previous?.to === minor && previous.actor === actor && previous.reason === reason, "minor milestone may only repeat its matching authorized action")
    return clone(ledger)
  }
  assert(compareMinor(minor, ledger.current_minor) > 0, "minor milestones may only advance")

  const next = clone(ledger)
  next.minor_changes.push({ from: ledger.current_minor, to: minor, actor, reason, at })
  next.current_minor = minor
  next.revision += 1
  validateLedger(next)
  return next
}

export function recordPlatformFailure(ledger, version, platformName, { reason, artifact = null, expectedRevision, at = new Date().toISOString() } = {}) {
  validateLedger(ledger)
  assertRevision(ledger, expectedRevision)
  assertNonempty(reason, "platform failure needs a reason")
  const next = clone(ledger)
  const release = requireRelease(next, version)
  assert(!release.blocked, `release ${version} is blocked`)
  const platform = platformState(release, platformName)
  assert(platform.status === "pending" || platform.status === "failed", `${platformName} for ${version} is already terminal`)
  if (artifact) {
    validatePlatformArtifact(release, platformName, artifact)
    assertSameArtifact(platform.artifact, artifact, `${platformName} retry for ${version} changed its artifact`)
    platform.artifact = clone(artifact)
  }
  if (platform.status === "failed" && platform.reason === reason && (!artifact || stableJson(platform.artifact) === stableJson(artifact))) return next
  platform.status = "failed"
  platform.reason = reason
  platform.updated_at = at
  next.revision += 1
  validateLedger(next)
  return next
}

export function publishMacos(ledger, version, artifact, { expectedRevision, at = new Date().toISOString() } = {}) {
  return publishPlatform(ledger, version, "macos", artifact, { expectedRevision, at })
}

export function publishLinuxAsset(ledger, version, artifact, { expectedRevision, at = new Date().toISOString() } = {}) {
  return publishPlatform(ledger, version, "linux_asset", artifact, { expectedRevision, at })
}

export function publishAur(ledger, version, artifact, { expectedRevision, at = new Date().toISOString() } = {}) {
  validateLedger(ledger)
  assertRevision(ledger, expectedRevision)
  const next = clone(ledger)
  const release = requireRelease(next, version)
  assert(!release.blocked, `release ${version} is blocked`)
  assert(release.public && release.linux_asset.status === "passed", `AUR publication needs a public, validated Linux asset for ${version}`)
  assertNoNewerPlatformVersion(next, version, "aur")
  const platform = release.aur
  if (platform.status === "passed") {
    assertSameArtifact(platform.artifact, artifact, `published AUR metadata for ${version} is immutable`)
    return next
  }
  assert(platform.status === "pending" || platform.status === "failed", `AUR publication for ${version} is superseded`)
  validateAurArtifact(release, artifact)
  assertSameArtifact(platform.artifact, artifact, `AUR retry for ${version} changed its verified package metadata`)
  platform.status = "passed"
  platform.artifact = clone(artifact)
  platform.reason = null
  platform.updated_at = at
  platform.published_at = at
  markOlderSuperseded(next, version, "aur", at)
  next.revision += 1
  validateLedger(next)
  return next
}

/** Central emergency block. Artifacts and published history remain immutable. */
export function blockVersions(ledger, versions, { actor, reason, expectedRevision, at = new Date().toISOString() } = {}) {
  validateLedger(ledger)
  assertRevision(ledger, expectedRevision)
  assertNonempty(actor, "an emergency block needs an authorized actor")
  assertNonempty(reason, "an emergency block needs a reason")
  assert(Array.isArray(versions) && versions.length > 0, "at least one version must be blocked")

  const next = clone(ledger)
  const uniqueVersions = [...new Set(versions)]
  let changed = false
  for (const version of uniqueVersions) {
    const release = requireRelease(next, version)
    if (release.blocked) {
      assert(release.reason === reason && release.blocked_by === actor, `release ${version} is already blocked by a different action`)
      continue
    }
    release.blocked = true
    release.reason = reason
    release.blocked_by = actor
    release.blocked_at = at
    release.block_history.push({ action: "blocked", actor, reason, at })
    changed = true
  }
  if (changed) next.revision += 1
  validateLedger(next)
  return next
}

export function unblockVersions(ledger, versions, { actor, reason, expectedRevision, at = new Date().toISOString() } = {}) {
  validateLedger(ledger)
  assertRevision(ledger, expectedRevision)
  assertNonempty(actor, "an emergency unblock needs an authorized actor")
  assertNonempty(reason, "an emergency unblock needs an authorization reason")
  assert(Array.isArray(versions) && versions.length > 0, "at least one version must be unblocked")

  const next = clone(ledger)
  let changed = false
  for (const version of [...new Set(versions)]) {
    const release = requireRelease(next, version)
    if (!release.blocked) {
      const previous = release.block_history.at(-1)
      assert(previous?.action === "unblocked" && previous.actor === actor && previous.reason === reason, `release ${version} is not blocked by this action`)
      continue
    }
    release.blocked = false
    release.reason = null
    release.unblocked_by = actor
    release.unblocked_at = at
    release.block_history.push({ action: "unblocked", actor, reason, at })
    changed = true
  }
  if (changed) next.revision += 1
  validateLedger(next)
  return next
}

/** The Tauri updater feed is a projection of the single ledger, never a source of state. */
export function safeMacosManifest(ledger) {
  validateLedger(ledger)
  const eligible = ledger.releases
    .filter(release => release.public && !release.blocked && release.gate === "passed" && release.macos.status === "passed")
    .sort((a, b) => compareVersions(b.version, a.version))
  const release = eligible[0]
  if (!release) return null

  const artifact = release.macos.artifact
  return {
    version: release.version,
    notes: `Elef Desktop ${release.version} — Personal testing`,
    pub_date: release.macos.published_at,
    platforms: {
      "darwin-aarch64": {
        signature: artifact.signature,
        url: artifact.updater_url
      }
    }
  }
}

/** Select only the newest eligible pending platform release for catch-up. */
export function latestPendingPlatformRelease(ledger, platformName) {
  validateLedger(ledger)
  assert(["macos", "linux_asset", "aur"].includes(platformName), `unknown platform ${platformName}`)
  const candidates = ledger.releases
    .filter(release => {
      if (release.gate !== "passed" || release.blocked) return false
      const platform = release[platformName]
      if (platform.status !== "pending" && platform.status !== "failed") return false
      if (platformName === "aur" && (!release.public || release.linux_asset.status !== "passed")) return false
      return !ledger.releases.some(other => compareVersions(other.version, release.version) > 0 && other[platformName].status === "passed")
    })
    .sort((left, right) => compareVersions(right.version, left.version))
  return candidates[0] ? clone(candidates[0]) : null
}

export function serializeLedger(ledger) {
  validateLedger(ledger)
  return `${JSON.stringify(ledger, null, 2)}\n`
}

export function parseLedger(serialized) {
  let ledger
  try {
    ledger = JSON.parse(serialized)
  } catch {
    throw new ReleaseLedgerError("release ledger is not valid JSON")
  }
  validateLedger(ledger)
  return ledger
}

export function validateLedger(ledger) {
  assert(ledger && typeof ledger === "object" && !Array.isArray(ledger), "release ledger must be an object")
  assert(ledger.schema_version === LEDGER_SCHEMA_VERSION, "unsupported release ledger schema")
  assert(Number.isSafeInteger(ledger.revision) && ledger.revision >= 0, "release ledger revision must be a nonnegative integer")
  assert(ledger.last_reconciled_main === null || SHA_PATTERN.test(ledger.last_reconciled_main), "invalid last_reconciled_main SHA")
  parseMinor(ledger.current_minor)
  for (const key of ["minor_changes", "reserved_versions", "processed_merges", "releases"]) {
    assert(Array.isArray(ledger[key]), `release ledger ${key} must be an array`)
  }

  const versions = new Set()
  const tags = new Set()
  const releaseShas = new Set()
  for (const reservation of ledger.reserved_versions) {
    assert(SEMVER_PATTERN.test(reservation.version), `invalid reserved version ${reservation.version}`)
    assert(reservation.tag === `desktop-v${reservation.version}`, `invalid tag for ${reservation.version}`)
    assert(!versions.has(reservation.version), `duplicate reserved version ${reservation.version}`)
    assert(!tags.has(reservation.tag), `duplicate reserved tag ${reservation.tag}`)
    versions.add(reservation.version)
    tags.add(reservation.tag)
    assert(reservation.main_sha === null || SHA_PATTERN.test(reservation.main_sha), `invalid reserved source SHA for ${reservation.version}`)
  }

  const processedShas = new Set()
  for (const merge of ledger.processed_merges) {
    assert(SHA_PATTERN.test(merge.sha), `invalid processed merge SHA ${merge.sha}`)
    assert(Number.isInteger(merge.pr) && merge.pr > 0, `invalid PR number for merge ${merge.sha}`)
    assert(Number.isInteger(merge.main_order) && merge.main_order >= 0, `invalid main order for merge ${merge.sha}`)
    assert(["passed", "failed_gate"].includes(merge.gate), `invalid gate state for merge ${merge.sha}`)
    assert(!processedShas.has(merge.sha), `duplicate processed merge SHA ${merge.sha}`)
    processedShas.add(merge.sha)
    if (merge.gate === "passed") {
      assert(SEMVER_PATTERN.test(merge.version), `passing merge ${merge.sha} needs a reserved version`)
      assert(merge.tag === `desktop-v${merge.version}`, `passing merge ${merge.sha} has an invalid tag`)
    } else {
      assert(merge.version === null && merge.tag === null, `failed gate ${merge.sha} must not reserve a release version`)
    }
  }

  const releaseVersions = new Set()
  for (const release of ledger.releases) {
    assert(SEMVER_PATTERN.test(release.version), `invalid release version ${release.version}`)
    assert(release.tag === `desktop-v${release.version}`, `invalid release tag ${release.tag}`)
    assert(release.gate === "passed", `release ${release.version} has not passed Gate A`)
    assert(SHA_PATTERN.test(release.main_sha), `release ${release.version} needs its source SHA`)
    assert(Number.isInteger(release.pr) && release.pr > 0, `release ${release.version} needs its merged PR number`)
    assert(!releaseVersions.has(release.version), `duplicate release ${release.version}`)
    assert(!releaseShas.has(release.main_sha), `main SHA ${release.main_sha} has more than one release`)
    releaseVersions.add(release.version)
    releaseShas.add(release.main_sha)
    assert(versions.has(release.version), `release ${release.version} has no immutable reservation`)
    assert(typeof release.public === "boolean", `release ${release.version} needs its visibility state`)
    assert(typeof release.blocked === "boolean", `release ${release.version} needs its block state`)
    assert(release.reason === null || typeof release.reason === "string", `invalid block reason for ${release.version}`)
    for (const platformName of ["macos", "linux_asset", "aur"]) {
      const platform = release[platformName]
      assert(platform && PLATFORM_STATUSES.has(platform.status), `invalid ${platformName} status for ${release.version}`)
      assert(platform.reason === null || typeof platform.reason === "string", `invalid ${platformName} reason for ${release.version}`)
      if (platform.status === "passed") {
        assert(platform.artifact, `passed ${platformName} for ${release.version} needs immutable artifact metadata`)
        validatePlatformArtifact(release, platformName, platform.artifact)
      }
    }
    assert(Array.isArray(release.block_history), `release ${release.version} needs block history`)
    const distributed = release.macos.status === "passed" || release.linux_asset.status === "passed"
    assert(release.public === distributed, `release ${release.version} visibility must reflect a validated public platform asset`)
    assert(release.blocked ? Boolean(release.blocked_by && release.blocked_at && release.reason) : release.reason === null, `release ${release.version} has inconsistent block metadata`)
  }

  for (const merge of ledger.processed_merges.filter(item => item.gate === "passed")) {
    const release = ledger.releases.find(item => item.main_sha === merge.sha)
    assert(release && release.version === merge.version && release.pr === merge.pr, `passing merge ${merge.sha} has no matching release record`)
  }
  assert(releaseVersions.size === ledger.processed_merges.filter(item => item.gate === "passed").length, "release ledger has an unprocessed release record")
  return true
}

function publishPlatform(ledger, version, platformName, artifact, { expectedRevision, at }) {
  validateLedger(ledger)
  assertRevision(ledger, expectedRevision)
  const next = clone(ledger)
  const release = requireRelease(next, version)
  assert(!release.blocked, `release ${version} is blocked`)
  assertNoNewerPlatformVersion(next, version, platformName)
  const platform = platformState(release, platformName)
  if (platform.status === "passed") {
    assertSameArtifact(platform.artifact, artifact, `published ${platformName} for ${version} is immutable`)
    return next
  }
  assert(platform.status === "pending" || platform.status === "failed", `${platformName} for ${version} is superseded`)
  validatePlatformArtifact(release, platformName, artifact)
  assertSameArtifact(platform.artifact, artifact, `${platformName} retry for ${version} changed its verified artifact`)
  platform.status = "passed"
  platform.artifact = clone(artifact)
  platform.reason = null
  platform.updated_at = at
  platform.published_at = at
  release.public = true
  release.public_at ||= at
  markOlderSuperseded(next, version, platformName, at)
  if (platformName === "linux_asset") markOlderSuperseded(next, version, "aur", at)
  next.revision += 1
  validateLedger(next)
  return next
}

function reserveVersion(ledger, merge, existingTags, now) {
  const [major, minor] = parseMinor(ledger.current_minor)
  const prefix = `${major}.${minor}.`
  const reservedPatches = ledger.reserved_versions
    .filter(item => item.version.startsWith(prefix))
    .map(item => Number(item.version.slice(prefix.length)))
  let patch = reservedPatches.length ? Math.max(...reservedPatches) + 1 : 0
  let version
  let tag
  while (true) {
    version = `${prefix}${patch}`
    tag = `desktop-v${version}`
    if (!existingTags.has(tag)) break
    ledger.reserved_versions.push({
      version,
      tag,
      main_sha: null,
      pr: null,
      reason: "preexisting_tag",
      created_at: now()
    })
    patch += 1
  }
  const created_at = now()
  ledger.reserved_versions.push({ version, tag, main_sha: merge.sha, pr: merge.pr, reason: "main_merge", created_at })
  return { version, tag, created_at }
}

function createRelease({ version, tag, merge, createdAt }) {
  return {
    version,
    tag,
    main_sha: merge.sha,
    pr: merge.pr,
    gate: "passed",
    public: false,
    public_at: null,
    macos: emptyPlatform(),
    linux_asset: emptyPlatform(),
    aur: emptyPlatform(),
    blocked: false,
    blocked_by: null,
    blocked_at: null,
    unblocked_by: null,
    unblocked_at: null,
    reason: null,
    block_history: [],
    created_at: createdAt
  }
}

function emptyPlatform() {
  return { status: "pending", artifact: null, reason: null, updated_at: null, published_at: null }
}

function platformState(release, platformName) {
  assert(["macos", "linux_asset", "aur"].includes(platformName), `unknown platform ${platformName}`)
  return release[platformName]
}

function validatePlatformArtifact(release, platformName, artifact) {
  assert(artifact && typeof artifact === "object" && !Array.isArray(artifact), `${platformName} artifact metadata is required`)
  assert(artifact.version === release.version, `${platformName} artifact version does not match its reservation`)
  assert(artifact.source_sha === release.main_sha, `${platformName} artifact source SHA does not match its reservation`)
  if (platformName === "macos") validateMacosArtifact(release, artifact)
  else if (platformName === "linux_asset") validateLinuxArtifact(release, artifact)
  else validateAurArtifact(release, artifact)
}

function validateMacosArtifact(release, artifact) {
  assert(artifact.architecture === "aarch64", "macOS artifact must target Apple Silicon ARM64")
  assertImmutableReleaseUrl(artifact.updater_url, release.tag, "macOS updater archive")
  assertImmutableReleaseUrl(artifact.dmg_url, release.tag, "macOS DMG")
  assert(SHA256_PATTERN.test(artifact.updater_sha256), "macOS updater archive needs a SHA-256")
  assert(SHA256_PATTERN.test(artifact.dmg_sha256), "macOS DMG needs a SHA-256")
  assertNonempty(artifact.signature, "macOS updater archive needs its cryptographic signature")
  assert(artifact.signature_verified === true, "macOS updater signature must be verified before publication")
}

function validateLinuxArtifact(release, artifact) {
  assert(artifact.architecture === "x86_64", "Linux artifact must target x86-64")
  assertImmutableReleaseUrl(artifact.asset_url, release.tag, "Linux native package archive")
  assert(SHA256_PATTERN.test(artifact.sha256), "Linux native package archive needs a SHA-256")
  assertNonempty(artifact.filename, "Linux asset needs its immutable filename")
  assert(artifact.format === "arch-native", "Linux v0.x distribution must be the native Arch-compatible package archive")
}

function validateAurArtifact(release, artifact) {
  const linuxArtifact = release.linux_asset.artifact
  assert(linuxArtifact && release.linux_asset.status === "passed", "AUR metadata needs a validated Linux package archive")
  assert(["elef-bin", "elef-desktop-bin"].includes(artifact.package_name), "AUR package must use an approved binary package name")
  assert(artifact.version === release.version && artifact.pkgver === release.version, "AUR pkgver must match its immutable release version")
  assert(Number.isInteger(artifact.pkgrel) && artifact.pkgrel > 0, "AUR pkgrel must be a positive integer")
  assert(artifact.source_sha === release.main_sha, "AUR source SHA does not match its release")
  assert(artifact.asset_sha256 === linuxArtifact.sha256, "AUR checksum must match the immutable GitHub asset")
  assert(SHA256_PATTERN.test(artifact.pkgbuild_sha256), "AUR PKGBUILD needs a verified SHA-256")
  assert(SHA256_PATTERN.test(artifact.srcinfo_sha256), "AUR .SRCINFO needs a verified SHA-256")
}

function assertImmutableReleaseUrl(value, tag, label) {
  assertNonempty(value, `${label} URL is required`)
  let parsed
  try {
    parsed = new URL(value)
  } catch {
    throw new ReleaseLedgerError(`${label} URL is invalid`)
  }
  assert(parsed.protocol === "https:" && parsed.hostname === "github.com", `${label} must use an HTTPS GitHub release URL`)
  assert(parsed.pathname.includes(`/releases/download/${tag}/`), `${label} URL must name immutable tag ${tag}`)
}

function assertNoNewerPlatformVersion(ledger, version, platformName) {
  const newer = ledger.releases.find(release => compareVersions(release.version, version) > 0 && release[platformName].status === "passed")
  assert(!newer, `${platformName} cannot publish ${version} after newer ${newer?.version} is already published`)
}

function markOlderSuperseded(ledger, version, platformName, at) {
  for (const release of ledger.releases) {
    if (compareVersions(release.version, version) >= 0) continue
    const platform = release[platformName]
    if (platform.status !== "pending" && platform.status !== "failed") continue
    platform.status = "superseded"
    platform.reason = `Superseded by published ${version}.`
    platform.updated_at = at
  }
}

function requireRelease(ledger, version) {
  assert(SEMVER_PATTERN.test(version), `invalid release version ${version}`)
  const release = ledger.releases.find(item => item.version === version)
  assert(release, `release ${version} is not reserved in the ledger`)
  return release
}

function assertRevision(ledger, expectedRevision) {
  assert(Number.isSafeInteger(expectedRevision), "release mutation must include the ledger revision it read")
  assert(expectedRevision === ledger.revision, `stale release state revision ${expectedRevision}; current revision is ${ledger.revision}`)
}

function parseMinor(minor) {
  const match = /^(0|[1-9]\d*)\.(0|[1-9]\d*)$/.exec(minor)
  assert(match, `invalid minor milestone ${minor}`)
  return [Number(match[1]), Number(match[2])]
}

function compareMinor(left, right) {
  const [leftMajor, leftMinor] = parseMinor(left)
  const [rightMajor, rightMinor] = parseMinor(right)
  return leftMajor - rightMajor || leftMinor - rightMinor
}

function compareVersions(left, right) {
  const leftParts = parseVersion(left)
  const rightParts = parseVersion(right)
  for (let index = 0; index < 3; index += 1) {
    if (leftParts[index] !== rightParts[index]) return leftParts[index] - rightParts[index]
  }
  return 0
}

function parseVersion(version) {
  const match = SEMVER_PATTERN.exec(version)
  assert(match, `invalid semantic version ${version}`)
  return match.slice(1).map(Number)
}

function assertSameArtifact(previous, next, message) {
  if (previous === null) return
  assert(stableJson(previous) === stableJson(next), message)
}

function stableJson(value) {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`
  if (value && typeof value === "object") {
    return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${stableJson(value[key])}`).join(",")}}`
  }
  return JSON.stringify(value)
}

function clone(value) {
  return JSON.parse(JSON.stringify(value))
}

function assertNonempty(value, message) {
  assert(typeof value === "string" && value.trim().length > 0, message)
}

function assert(condition, message) {
  if (!condition) throw new ReleaseLedgerError(message)
}
