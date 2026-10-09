import test from "node:test"
import assert from "node:assert/strict"
import { createHash } from "node:crypto"
import { mkdtemp, rm, writeFile } from "node:fs/promises"
import os from "node:os"
import path from "node:path"

import { GitHubPublisher, releaseNotes } from "./github-publisher.mjs"

const VERSION = "0.1.0"
const TAG = `desktop-v${VERSION}`
const SOURCE_SHA = "a".repeat(40)
const OTHER_SHA = "b".repeat(40)

test("release tags resolve to one reserved commit and draft releases are idempotent", async () => {
  const fake = fakeGitHub()
  const publisher = createPublisher(fake)
  assert.deepEqual(await publisher.ensureTagAt(TAG, SOURCE_SHA), { created: true, commitSha: SOURCE_SHA })
  assert.deepEqual(await publisher.ensureTagAt(TAG, SOURCE_SHA), { created: false, commitSha: SOURCE_SHA })
  assert.equal(fake.counts.createTag, 1)

  const draftArgs = { tag: TAG, version: VERSION, sourceSha: SOURCE_SHA, pr: 147 }
  const first = await publisher.ensureDraftRelease(draftArgs)
  const second = await publisher.ensureDraftRelease(draftArgs)
  assert.equal(first.created, true)
  assert.equal(first.release.draft, true)
  assert.equal(second.created, false)
  assert.equal(fake.counts.createRelease, 1)
})

test("release publication rejects tags that point at a different source commit", async () => {
  const fake = fakeGitHub()
  const publisher = createPublisher(fake)
  await publisher.ensureTagAt(TAG, SOURCE_SHA)
  await assert.rejects(publisher.ensureTagAt(TAG, OTHER_SHA), /already points to another source commit/)
  await assert.rejects(publisher.ensureDraftRelease({ tag: TAG, version: VERSION, sourceSha: OTHER_SHA, pr: 147 }), /does not point to its reserved source commit/)
})

test("release assets upload once, retries verify immutable bytes, and conflicts never clobber", async () => {
  const fake = fakeGitHub()
  const publisher = createPublisher(fake)
  await publisher.ensureTagAt(TAG, SOURCE_SHA)
  const { release } = await publisher.ensureDraftRelease({ tag: TAG, version: VERSION, sourceSha: SOURCE_SHA, pr: 147 })
  const temporaryRoot = await mkdtemp(path.join(os.tmpdir(), "elef-release-assets-"))
  try {
    const assetPath = path.join(temporaryRoot, "elef-0.1.0-x86_64.tar.zst")
    const bytes = Buffer.from("verified immutable native package")
    await writeFile(assetPath, bytes)
    const file = {
      path: assetPath,
      name: path.basename(assetPath),
      sha256: createHash("sha256").update(bytes).digest("hex"),
      contentType: "application/zstd"
    }
    const firstUpload = await publisher.ensureReleaseAssets(release, [file])
    assert.deepEqual(firstUpload, [{ name: file.name, sha256: file.sha256, uploaded: true }])
    assert.deepEqual(await publisher.ensureReleaseAssets(release, [file]), [{ name: file.name, sha256: file.sha256, uploaded: false }])
    assert.equal(fake.counts.uploadAsset, 1)

    const differentBytes = Buffer.from("different package")
    await writeFile(assetPath, differentBytes)
    await assert.rejects(publisher.ensureReleaseAssets(release, [{
      ...file,
      sha256: createHash("sha256").update(differentBytes).digest("hex")
    }]), /already exists with different bytes/)
    assert.equal(fake.counts.uploadAsset, 1)
  } finally {
    await rm(temporaryRoot, { recursive: true, force: true })
  }
})

test("a release is public only after assets exist and notes show status plus source SHA", async () => {
  const fake = fakeGitHub()
  const publisher = createPublisher(fake)
  await publisher.ensureTagAt(TAG, SOURCE_SHA)
  const { release } = await publisher.ensureDraftRelease({ tag: TAG, version: VERSION, sourceSha: SOURCE_SHA, pr: 147 })
  const body = releaseNotes({ version: VERSION, sourceSha: SOURCE_SHA, pr: 147, macos: "pending", linuxAsset: "passed", aur: "pending" })
  assert.match(body, /Partial — macOS pending; AUR pending/)
  assert.match(body, new RegExp(SOURCE_SHA))
  await assert.rejects(publisher.exposeRelease(release, body, []), /verified platform assets/)

  const assetBytes = Buffer.from("validated Linux archive")
  const assetPath = path.join(os.tmpdir(), `elef-release-${process.pid}.tar.zst`)
  await writeFile(assetPath, assetBytes)
  try {
    const verifiedAssets = await publisher.ensureReleaseAssets(release, [{
      path: assetPath,
      name: "elef-0.1.0-x86_64.tar.zst",
      sha256: createHash("sha256").update(assetBytes).digest("hex")
    }])
    const publicRelease = await publisher.exposeRelease(release, body, verifiedAssets)
    assert.equal(publicRelease.draft, false)
    assert.match(publicRelease.body, /\*\*Source SHA:\*\*/)
  } finally {
    await rm(assetPath, { force: true })
  }
})

test("release notes mark complete distribution and central block limitations", () => {
  const complete = releaseNotes({ version: VERSION, sourceSha: SOURCE_SHA, pr: 147, macos: "passed", linuxAsset: "passed", aur: "passed" })
  assert.match(complete, /\*\*Status:\*\* Complete/)
  const alternatePackage = releaseNotes({
    version: VERSION,
    sourceSha: SOURCE_SHA,
    pr: 147,
    macos: "passed",
    linuxAsset: "passed",
    aur: "passed",
    aurPackage: "elef-desktop-bin"
  })
  assert.match(alternatePackage, /\*\*AUR package:\*\* `elef-desktop-bin`/)
  const blocked = releaseNotes({
    version: VERSION,
    sourceSha: SOURCE_SHA,
    pr: 147,
    macos: "passed",
    linuxAsset: "passed",
    aur: "passed",
    blockedReason: "unsafe fixture"
  })
  assert.match(blocked, /BLOCKED — do not install/)
  assert.match(blocked, /AUR packages already fetched or installed cannot be recalled centrally/)
})

function createPublisher(fake) {
  return new GitHubPublisher({
    owner: "example",
    repository: "elef",
    token: "fixture-token",
    apiUrl: "https://api.github.test",
    fetchImpl: fake.fetch,
    sleep: async () => {},
    now: () => "2026-10-09T12:00:00.000Z"
  })
}

function fakeGitHub() {
  const state = {
    tagRef: null,
    tagObjects: new Map(),
    release: null,
    assets: new Map(),
    nextAssetId: 1,
    counts: { createTag: 0, createRelease: 0, uploadAsset: 0 }
  }
  const apiRoot = "https://api.github.test/repos/example/elef"
  const send = (data, status = 200) => new Response(data === null ? null : JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json" }
  })
  const fetch = async (input, options = {}) => {
    const url = new URL(input)
    const method = options.method || "GET"
    if (url.href.startsWith("https://uploads.github.com/")) {
      const name = url.searchParams.get("name")
      if (state.assets.has(name)) return send({ message: "already exists" }, 422)
      const bytes = Buffer.from(options.body)
      const asset = {
        id: state.nextAssetId++,
        name,
        size: bytes.length,
        state: "uploaded",
        digest: `sha256:${createHash("sha256").update(bytes).digest("hex")}`
      }
      state.assets.set(name, { asset, bytes })
      state.counts.uploadAsset += 1
      return send(asset, 201)
    }
    const body = options.body ? JSON.parse(Buffer.from(options.body).toString("utf8")) : null
    const resource = url.href.slice(apiRoot.length)
    if (resource.startsWith("/git/ref/tags/")) {
      if (!state.tagRef) return send({ message: "not found" }, 404)
      return send(state.tagRef)
    }
    if (resource === "/git/tags" && method === "POST") {
      state.counts.createTag += 1
      state.tagObjects.set("f".repeat(40), { object: body.object })
      return send({ sha: "f".repeat(40) }, 201)
    }
    if (resource.startsWith("/git/tags/")) return send(state.tagObjects.get(resource.split("/").at(-1)))
    if (resource === "/git/refs" && method === "POST") {
      if (state.tagRef) return send({ message: "Reference already exists" }, 422)
      state.tagRef = { ref: body.ref, object: { sha: body.sha, type: "tag" } }
      return send(state.tagRef, 201)
    }
    if (resource.startsWith("/releases/tags/")) return state.release ? send(state.release) : send({ message: "not found" }, 404)
    if (resource === "/releases" && method === "POST") {
      state.counts.createRelease += 1
      state.release = {
        id: 1,
        tag_name: body.tag_name,
        draft: body.draft,
        body: body.body,
        upload_url: "https://uploads.github.com/repos/example/elef/releases/1/assets{?name,label}",
        assets: []
      }
      return send(state.release, 201)
    }
    if (resource === "/releases/1" && method === "GET") {
      if (!state.release) return send({ message: "not found" }, 404)
      state.release.assets = [...state.assets.values()].map(entry => entry.asset)
      return send(state.release)
    }
    if (resource === "/releases/1" && method === "PATCH") {
      state.release = { ...state.release, ...body }
      return send(state.release)
    }
    if (resource.startsWith("/releases/assets/") && options.headers?.Accept === "application/octet-stream") {
      const assetId = Number(resource.split("/").at(-1))
      const entry = [...state.assets.values()].find(value => value.asset.id === assetId)
      return entry ? new Response(entry.bytes) : send({ message: "not found" }, 404)
    }
    throw new Error(`unexpected fake GitHub request ${method} ${url.href}`)
  }
  return { fetch, counts: state.counts }
}
