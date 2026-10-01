import { spawn } from "node:child_process"

const ELEMENT_ID = "element-6066-11e4-a52e-4f735466cecf"

export class EmbeddedTauriDriver {
  constructor({ binary, libraryRoot, port = 4445 }) {
    this.binary = binary
    this.libraryRoot = libraryRoot
    this.port = port
    this.baseUrl = `http://127.0.0.1:${port}`
    this.process = null
    this.sessionId = null
  }

  async start() {
    if (!this.binary || !this.libraryRoot) throw new Error("Desktop E2E binary and library paths are required")
    this.process = spawn(this.binary, [], {
      cwd: process.cwd(),
      env: { ...process.env, ELEF_E2E_LIBRARY_ROOT: this.libraryRoot, TAURI_WEBDRIVER_PORT: String(this.port) },
      stdio: "inherit"
    })
    this.process.once("error", error => { this.startError = error })
    try {
      await this.waitForServer()
      const session = await this.request("POST", "/session", {
        capabilities: { alwaysMatch: { "wdio:tauriServiceOptions": { windowLabel: "main" } } }
      })
      this.sessionId = session.sessionId
    } catch (error) {
      await this.stop()
      throw error
    }
  }

  async stop() {
    if (this.sessionId) {
      await this.request("DELETE", `/session/${this.sessionId}`).catch(() => {})
      this.sessionId = null
    }
    if (!this.process || this.process.exitCode !== null || this.process.signalCode !== null) return
    const exited = new Promise(resolve => this.process.once("exit", resolve))
    this.process.kill("SIGTERM")
    await Promise.race([exited, new Promise(resolve => setTimeout(resolve, 5_000))])
    if (this.process.exitCode === null && this.process.signalCode === null) this.process.kill("SIGKILL")
  }

  async waitForServer() {
    const deadline = Date.now() + 45_000
    let lastError
    while (Date.now() < deadline) {
      if (this.startError) throw this.startError
      if (this.process && (this.process.exitCode !== null || this.process.signalCode !== null)) {
        throw new Error(`Desktop E2E app exited with code ${this.process.exitCode ?? this.process.signalCode}`)
      }
      try {
        const response = await fetch(`${this.baseUrl}/status`)
        if (response.ok) return
      } catch (error) {
        lastError = error
      }
      await new Promise(resolve => setTimeout(resolve, 100))
    }
    throw new Error(`Timed out waiting for the embedded Tauri driver: ${lastError?.message || "no response"}`)
  }

  async request(method, endpoint, body) {
    const response = await fetch(`${this.baseUrl}${endpoint}`, {
      method,
      headers: body ? { "Content-Type": "application/json" } : undefined,
      body: body ? JSON.stringify(body) : undefined
    })
    const payload = await response.json()
    if (!response.ok || payload.value?.error) {
      const error = payload.value?.message || payload.value?.error || JSON.stringify(payload)
      throw new Error(`Tauri WebDriver ${method} ${endpoint} failed (${response.status}): ${error}`)
    }
    return payload.value
  }

  async element(selector) {
    const result = await this.request("POST", `/session/${this.sessionId}/element`, {
      using: "css selector",
      value: selector
    })
    return result[ELEMENT_ID]
  }

  async click(selector) {
    const element = await this.element(selector)
    await this.request("POST", `/session/${this.sessionId}/element/${element}/click`, {})
  }

  async text(selector) {
    const element = await this.element(selector)
    return this.request("GET", `/session/${this.sessionId}/element/${element}/text`)
  }

  async attribute(selector, name) {
    const element = await this.element(selector)
    return this.request("GET", `/session/${this.sessionId}/element/${element}/attribute/${name}`)
  }

  async enabled(selector) {
    const element = await this.element(selector)
    return this.request("GET", `/session/${this.sessionId}/element/${element}/enabled`)
  }

  async replaceEditorSource(source) {
    const replaced = await this.request("POST", `/session/${this.sessionId}/execute/sync`, {
      script: `const source = arguments[0];
        const container = document.querySelector("#desktop-editor-field");
        const editor = container?.editorController;
        if (!editor?.view) throw new Error("CodeMirror editor is unavailable");
        editor.view.dispatch({ changes: { from: 0, to: editor.view.state.doc.length, insert: source }, userEvent: "input" });
        return editor.value === source;`,
      args: [source]
    })
    if (replaced !== true) throw new Error("The desktop editor did not accept the test source")
  }

  async waitForText(selector, text) {
    await this.waitUntil(async () => (await this.text(selector)).includes(text), `Timed out waiting for ${selector} to contain ${text}`)
  }

  async waitForEnabled(selector) {
    await this.waitUntil(() => this.enabled(selector), `Timed out waiting for ${selector} to be enabled`)
  }

  async waitUntil(predicate, message, timeout = 10_000) {
    const deadline = Date.now() + timeout
    let lastError
    while (Date.now() < deadline) {
      try {
        if (await predicate()) return
      } catch (error) {
        lastError = error
      }
      await new Promise(resolve => setTimeout(resolve, 100))
    }
    throw new Error(`${message}${lastError ? `: ${lastError.message}` : ""}`)
  }
}
