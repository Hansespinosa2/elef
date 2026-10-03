import { createHash, generateKeyPairSync, randomBytes, sign } from "node:crypto"
import { createServer } from "node:http"

// Ephemeral test key lives only in this process. It cannot sign production
// releases and is never written to disk or sent to the test runner.
const { privateKey, publicKey } = generateKeyPairSync("ed25519")
const keyId = randomBytes(8)
const publicBytes = publicKey.export({ type: "spki", format: "der" }).subarray(-32)
const encodedKey = Buffer.concat([Buffer.from("Ed"), keyId, publicBytes]).toString("base64")
const updaterPublicKey = Buffer.from(`untrusted comment: ephemeral Elef test key\n${encodedKey}\n`).toString("base64")
const artifact = Buffer.from("Elef signed-download verification fixture.\n".repeat(512))
const trustedComment = "timestamp:0\tversion:0.2.0\tfile:fixture.bin"
const signature = sign(null, createHash("blake2b512").update(artifact).digest(), privateKey)
const globalSignature = sign(null, Buffer.concat([signature, Buffer.from(trustedComment)]), privateKey)
const encodedSignature = Buffer.from([
  "untrusted comment: signature from ephemeral test key",
  Buffer.concat([Buffer.from("ED"), keyId, signature]).toString("base64"),
  `trusted comment: ${trustedComment}`,
  globalSignature.toString("base64"), ""
].join("\n")).toString("base64")

const modes = new Set(["none", "older", "valid", "bad-signature", "truncated", "version-mismatch"])
let mode = "none"
const server = createServer((request, response) => {
  const url = new URL(request.url, "http://127.0.0.1:8888")
  if (url.pathname === "/mode") {
    const selected = url.searchParams.get("value")
    if (!modes.has(selected)) { response.writeHead(400); response.end(); return }
    mode = selected
    response.writeHead(200); response.end(mode); return
  }
  if (url.pathname === "/manifest") {
    if (mode === "none") { response.writeHead(204); response.end(); return }
    response.writeHead(200, { "Content-Type": "application/json" })
    response.end(JSON.stringify({
      version: mode === "older" ? "0.0.1" : mode === "version-mismatch" ? "0.3.0" : "0.2.0",
      notes: "Ephemeral update verification fixture",
      url: "http://127.0.0.1:8888/artifact",
      signature: encodedSignature
    }))
    return
  }
  if (url.pathname === "/artifact") {
    response.writeHead(200, { "Content-Type": "application/octet-stream", "Content-Length": artifact.length })
    if (mode === "truncated") {
      response.write(artifact.subarray(0, artifact.length / 2))
      response.flushHeaders()
      setTimeout(() => response.destroy(), 20)
    } else if (mode === "bad-signature") {
      const corrupted = Buffer.from(artifact)
      corrupted[0] ^= 0xff
      response.end(corrupted)
    } else {
      response.end(artifact)
    }
    return
  }
  response.writeHead(404); response.end()
})
server.listen(8888, "127.0.0.1", () => process.send({ publicKey: updaterPublicKey }))
process.on("disconnect", () => server.close())
process.on("SIGTERM", () => server.close())
