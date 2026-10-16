import assert from "node:assert/strict"
import test from "node:test"
import { readFile } from "node:fs/promises"

// Subpath deployment (RAILS_RELATIVE_URL_ROOT, e.g. /apps/elef/dev): the
// client shell must prefix the API base plus every URL it builds, and strip
// the prefix before the shared router parses the mount URL. Root deployment
// (empty prefix) must stay byte-identical.
const controllerPath = new URL("../../app/javascript/controllers/client_shell_controller.js", import.meta.url)
const railsHostPath = new URL("../../app/javascript/host/rails-http-host.js", import.meta.url)

async function loadModule(url, overrides) {
  let source = await readFile(url, "utf8")
  source = source.replace(/^import\s+["'][^"']+["'];?\s*$/gm, "")
  source = source.replace(/^import\s+[\s\S]*?\s+from\s+["']([^"']+)["'];?\s*/gm, (_statement, specifier) => {
    if (Object.hasOwn(overrides, specifier)) return overrides[specifier]
    return specifier === "@hotwired/stimulus" ? "class Controller {}\n" : ""
  })
  const dataUrl = `data:text/javascript;base64,${Buffer.from(source).toString("base64")}`
  return import(dataUrl)
}

async function loadController() {
  const module = await loadModule(controllerPath, {
    "@elef/client":
      "const GraphController = class {};\n" +
      "const renderGraphView = () => {};\n" +
      "const mountElef = (...args) => globalThis.__mountElef(...args)\n",
    "host/rails-http-host": "const createRailsHost = (...args) => globalThis.__createRailsHost(...args)\n",
    "host/rails-authoring-settings-transport":
      "const createRailsAuthoringSettingsTransport = () => ({})\n"
  })
  return module.default
}

function nullElement() {
  return { querySelector: () => null }
}

function stubDocument(submitted) {
  return {
    querySelector: () => null,
    createElement: tag => {
      if (tag !== "form") return {}
      return {
        action: "",
        appendChild: () => {},
        submit() {
          submitted.push(this.action)
        }
      }
    },
    body: { appendChild: () => {} }
  }
}

function replaceGlobal(name, value) {
  const previous = Object.getOwnPropertyDescriptor(globalThis, name)
  Object.defineProperty(globalThis, name, { configurable: true, writable: true, value })
  return () => {
    if (previous) Object.defineProperty(globalThis, name, previous)
    else delete globalThis[name]
  }
}

async function connectWith({ initialUrl, basePath, submitted, pushes, visits }) {
  const seen = {}
  const restoreMount = replaceGlobal("__mountElef", async (element, host, options) => {
    seen.options = options
    return { unmount: () => {} }
  })
  const restoreHost = replaceGlobal("__createRailsHost", async args => {
    seen.hostArgs = args
    return { stub: true }
  })
  const restoreDocument = replaceGlobal("document", stubDocument(submitted))
  const restoreWindow = replaceGlobal("window", {
    history: { pushState: (...args) => pushes.push(args) },
    Turbo: { visit: url => visits.push(url) }
  })
  const restore = () => {
    restoreMount()
    restoreHost()
    restoreDocument()
    restoreWindow()
  }
  // Globals stay installed while the test drives the captured mount options
  // (present/fork submit forms, navigate touches history); the test restores.
  const Controller = await loadController()
  const controller = new Controller()
  controller.element = nullElement()
  controller.initialUrlValue = initialUrl
  controller.basePathValue = basePath
  controller.cardNotesValue = {}
  await controller.connect()
  return { controller, seen, restore }
}

function freshCapture() {
  return { submitted: [], pushes: [], visits: [] }
}

test("subpath mount prefixes the API base and strips the route for parsing", async () => {
  const capture = freshCapture()
  const { seen, restore } = await connectWith({ initialUrl: "/apps/elef/dev/settings", basePath: "/apps/elef/dev", ...capture })

  assert.equal(seen.hostArgs.baseUrl, "/apps/elef/dev")
  assert.equal(seen.options.initialUrl, "/settings")
  restore()
})

test("subpath mount prefixes every navigation and action URL", async () => {
  const capture = freshCapture()
  const { controller, seen, restore } = await connectWith({ initialUrl: "/apps/elef/dev", basePath: "/apps/elef/dev", ...capture })
  const options = seen.options
  const document = { id: "3", kind: "document" }
  const presentation = { id: "7", kind: "presentation" }

  assert.equal(seen.options.initialUrl, "/")
  assert.equal(options.resolveWorkUrl(document), "/apps/elef/dev/documents/3/edit")
  assert.equal(options.resolveLibraryUrl("documents"), "/apps/elef/dev/documents")
  assert.equal(options.resolveLibraryUrl("all"), "/apps/elef/dev/")
  assert.equal(options.resolvePreviewUrl(presentation), "/apps/elef/dev/presentations/7")
  assert.equal(options.resolveMediaBaseUrl(document), "/apps/elef/dev/documents/3/assets")
  assert.equal(controller.resolveWorkUrl(presentation), "/apps/elef/dev/presentations/7/edit")

  options.presentWork(presentation)
  assert.deepEqual(capture.submitted, ["/apps/elef/dev/presentations/7/publish"])
  const [fork] = options.extraCardActions(presentation)
  fork.children[0].run()
  assert.deepEqual(capture.submitted, [
    "/apps/elef/dev/presentations/7/publish",
    "/apps/elef/dev/presentations/7/fork"
  ])

  options.navigate({ url: "/apps/elef/dev/documents" })
  assert.equal(capture.pushes[0][2], "/apps/elef/dev/documents")
  options.navigate({ workId: "7", kind: "presentation" })
  assert.deepEqual(capture.visits, ["/apps/elef/dev/presentations/7/edit"])
  restore()
})

test("prefix stripping is boundary-safe", async () => {
  const capture = freshCapture()
  const { controller, restore } = await connectWith({ initialUrl: "/", basePath: "/apps/elef/dev", ...capture })

  assert.equal(controller.stripBase("/apps/elef/devotion/x"), "/apps/elef/devotion/x")
  assert.equal(controller.stripBase("/settings"), "/settings")
  assert.equal(controller.stripBase("/apps/elef/dev/snippets/1/edit"), "/snippets/1/edit")
  restore()
})

test("root deployment keeps every URL byte-identical", async () => {
  const capture = freshCapture()
  const { controller, seen, restore } = await connectWith({ initialUrl: "/settings", basePath: "", ...capture })
  const options = seen.options

  assert.equal(seen.hostArgs.baseUrl, "")
  assert.equal(seen.options.initialUrl, "/settings")
  assert.equal(controller.stripBase("/settings"), "/settings")
  assert.equal(options.resolveWorkUrl({ id: "1", kind: "document" }), "/documents/1/edit")
  assert.equal(options.resolveLibraryUrl("all"), "/")
  assert.equal(options.resolveLibraryUrl("presentations"), "/presentations")
  assert.equal(options.resolvePreviewUrl({ id: "1", kind: "document" }), "/documents/1")
  assert.equal(options.resolveMediaBaseUrl({ id: "1", kind: "document" }), "/documents/1/assets")
  assert.equal(controller.resolveWorkUrl({ id: "1", kind: "document" }), "/documents/1/edit")

  options.presentWork({ id: "1", kind: "document" })
  assert.deepEqual(capture.submitted, ["/documents/1/publish"])
  restore()
})

test("rails host joins API paths under the deployment prefix", async () => {
  const module = await loadModule(railsHostPath, {
    "@elef/client": "const createPortSession = () => ({})\n"
  })
  const requested = []
  const fetchImpl = async (url, init) => {
    requested.push([url, init?.method ?? "GET"])
    return {
      status: 200,
      ok: true,
      headers: { get: name => (name === "content-type" ? "application/json" : null) },
      json: async () => []
    }
  }

  const host = await module.createRailsHost({ baseUrl: "/apps/elef/dev", fetchImpl, csrfToken: null })
  await host.library.listWorks("default")
  await host.settings.getSettings()

  assert.deepEqual(requested, [
    ["/apps/elef/dev/api/host/works?workspace_id=default", "GET"],
    ["/apps/elef/dev/api/host/settings", "GET"]
  ])
})
