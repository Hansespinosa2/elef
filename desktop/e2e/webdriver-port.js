import { createServer } from "node:net"

export async function readWebdriverValue(response) {
  const body = await response.text()
  let payload = {}
  if (body.trim()) {
    try {
      payload = JSON.parse(body)
    } catch {
      throw new Error(`WebDriver HTTP ${response.status} returned invalid JSON.`)
    }
  }

  if (!response.ok || payload.value?.error) {
    throw new Error(payload.value?.message || `Driver HTTP ${response.status}`)
  }
  return payload.value
}

export async function reserveWebdriverPort() {
  const server = createServer()
  await new Promise((resolve, reject) => {
    server.once("error", reject)
    server.listen(0, "127.0.0.1", resolve)
  })
  const { port } = server.address()
  await new Promise((resolve, reject) => {
    server.close(error => error ? reject(error) : resolve())
  })
  return String(port)
}
