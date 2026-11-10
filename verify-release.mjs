import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { execFileSync } from "node:child_process"
import { createHash, createPublicKey, verify } from "node:crypto"

const directory = new URL("./", import.meta.url)
const read = name => readFileSync(new URL(name, directory))
const digest = bytes => createHash("sha256").update(bytes).digest("hex")
const manifestBytes = read("latest.json")
assert.deepEqual(read("live-latest.json"), manifestBytes)
const manifest = JSON.parse(manifestBytes)
assert.equal(manifest.version, "0.1.9")
const archive = read("Elef_0.1.9_aarch64.app.tar.gz")
assert.equal(digest(archive), "d4997935f77121837ec61e5b43ed606e4d2ea44d4e977fc5e8e42d1b9be90c99")
assert.deepEqual(read("updater-response"), archive)
const oldArchive = new URL("Elef_0.1.8_aarch64.app.tar.gz", directory)
const binary = execFileSync("tar", ["-xOf", oldArchive.pathname,
  "Elef.app/Contents/MacOS/elef-desktop"], { maxBuffer: 64 * 1024 * 1024 })
// The release's embedded strings contain the base64 minisign public key
// immediately before the next updater configuration field.
const start = binary.indexOf("dW50cnVzdGVkIGNvbW1lbnQ")
assert.ok(start > 0)
const end = binary.indexOf("requireSignedVersion", start)
assert.ok(end > start)
const publicText = Buffer.from(binary.subarray(start, end).toString(), "base64").toString()
const publicBytes = Buffer.from(publicText.trim().split("\n")[1], "base64")
assert.equal(publicBytes.length, 42)
const key = createPublicKey({
  key: Buffer.concat([Buffer.from("302a300506032b6570032100", "hex"), publicBytes.subarray(10)]),
  format: "der", type: "spki"
})
const lines = Buffer.from(manifest.platforms["darwin-aarch64"].signature, "base64").toString().trim().split("\n")
const signature = Buffer.from(lines[1], "base64")
assert.equal(signature.subarray(0, 2).toString(), "ED")
assert.deepEqual(signature.subarray(2, 10), publicBytes.subarray(2, 10))
assert.ok(verify(null, createHash("blake2b512").update(archive).digest(), key, signature.subarray(10)))
const comment = lines[2].replace("trusted comment: ", "")
assert.ok(verify(null, Buffer.concat([signature.subarray(10), Buffer.from(comment)]), key, Buffer.from(lines[3], "base64")))
assert.ok(comment.split("\t").includes("version:0.1.9"))
const sourcePath = "apps/desktop/frontend/src/close-flow.js"
const releasedSource = execFileSync("git", ["show", `5dc808cf2ecf168e6edf9bf54d77d0b57db6047d:${sourcePath}`])
const initialSource = execFileSync("git", ["show", `473fe17db6a842fb9dfa26b5077c34c8a54e8c03:${sourcePath}`])
assert.deepEqual(releasedSource, initialSource)
console.log(JSON.stringify({
  version: manifest.version,
  manifestSha256: digest(manifestBytes),
  archiveSha256: digest(archive),
  embeddedV018KeyId: publicBytes.subarray(2, 10).toString("hex"),
  artifactSignature: "verified against the key embedded in the published v0.1.8 binary",
  trustedVersionComment: comment,
  updaterUrlResponse: "identical to the published archive",
  v018CloseFlowEqualsInitialCheckout: true,
  closeFlowSha256: digest(releasedSource)
}, null, 2))
