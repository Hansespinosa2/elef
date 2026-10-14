import assert from "node:assert/strict"
import { createConnection } from "node:net"

function connect(host, port) {
  return new Promise((resolve, reject) => {
    const socket = createConnection({ host, port })
    socket.setTimeout(3_000, () => socket.destroy(new Error(`Connection to ${host} timed out`)))
    socket.once("connect", () => { socket.end(); resolve() })
    socket.once("error", reject)
  })
}

assert.equal(process.platform, "darwin")
await connect("127.0.0.1", Number(process.argv[2]))
await connect("::1", Number(process.argv[3]))
for (const host of ["1.1.1.1", "2606:4700:4700::1111"]) {
  await assert.rejects(connect(host, 443), error => ["EPERM", "EACCES"].includes(error.code),
    `Seatbelt must deny external ${host.includes(":") ? "IPv6" : "IPv4"} connections, independently of DNS or reachability`)
}
console.log("macOS offline sandbox: IPv4/IPv6 loopback works and external connections are denied.")
