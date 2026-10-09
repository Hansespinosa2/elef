import assert from "node:assert/strict"
import { spawn } from "node:child_process"
import { createServer } from "node:net"
import path from "node:path"
import { fileURLToPath } from "node:url"

const directory = path.dirname(fileURLToPath(import.meta.url))
const profile = path.join(directory, "offline-macos.sb")

export function desktopCommand(command, args = []) {
  if (process.env.ELEF_E2E_OFFLINE !== "1") return { command, args }
  assert.equal(process.platform, "darwin", "Seatbelt offline mode requires macOS")
  return { command: "/usr/bin/sandbox-exec", args: ["-f", profile, command, ...args] }
}

export function desktopAppEnvironment(env) {
  if (process.env.ELEF_E2E_OFFLINE !== "1") return env
  assert.equal(process.platform, "darwin", "Seatbelt offline mode requires macOS")
  return {
    ...env,
    ELEF_E2E_REAL_APP_BINARY: env.ELEF_E2E_APP_BINARY,
    ELEF_E2E_APP_BINARY: path.join(directory, "offline-macos-app.sh"),
    ELEF_E2E_OFFLINE_PROFILE: profile
  }
}

export async function verifyOfflineSandbox() {
  if (process.env.ELEF_E2E_OFFLINE !== "1") return
  const listeners = []
  try {
    for (const host of ["127.0.0.1", "::1"]) {
      const server = createServer(socket => socket.end())
      listeners.push(server)
      await new Promise((resolve, reject) => {
        server.once("error", reject)
        server.listen(0, host, resolve)
      })
    }
    const ports = listeners.map(server => String(server.address().port))
    const restricted = desktopCommand(process.execPath, [path.join(directory, "offline-macos-probe.js"), ...ports])
    await new Promise((resolve, reject) => {
      const child = spawn(restricted.command, restricted.args, { stdio: "inherit" })
      const timer = setTimeout(() => {
        child.kill("SIGKILL")
        reject(new Error("The macOS offline network probe timed out"))
      }, 15_000)
      child.once("error", error => { clearTimeout(timer); reject(error) })
      child.once("exit", (code, signal) => {
        clearTimeout(timer)
        if (code === 0 && !signal) resolve()
        else reject(new Error(`The macOS offline network probe failed: code=${code}, signal=${signal}`))
      })
    })
  } finally {
    await Promise.all(listeners.map(server => new Promise(resolve => server.close(resolve))))
  }
}
