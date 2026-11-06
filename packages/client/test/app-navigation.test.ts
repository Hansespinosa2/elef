import { test } from "node:test"
import assert from "node:assert/strict"
import { parseHTML } from "linkedom"
import { mountAppNavigation } from "../src/application/app_navigation.js"

test("hosts share navigation markup and supply only their own destinations", () => {
  const { document } = parseHTML("<main><div id='web'></div><div id='desktop'></div></main>")
  const web = document.getElementById("web") as unknown as HTMLElement
  const desktop = document.getElementById("desktop") as unknown as HTMLElement
  const webMount = mountAppNavigation(web, { libraryHref: "/prefix/", settingsHref: "/prefix/settings", active: "library" })
  mountAppNavigation(desktop, { libraryHref: "#library", settingsHref: "#settings", active: "library" })
  const shape = (element: HTMLElement) => Array.from(element.querySelectorAll("a"), link => ({
    text: link.textContent, className: link.className, current: link.getAttribute("aria-current"),
  }))
  assert.deepEqual(shape(web), shape(desktop))
  assert.equal(web.querySelector("#open-settings")?.getAttribute("href"), "/prefix/settings")
  assert.equal(desktop.querySelector("#back-to-library")?.getAttribute("href"), "#library")
  assert.equal(web.querySelector("nav")?.getAttribute("aria-label"), "Primary")
  webMount.dispose()
  assert.equal(web.children.length, 0)
})
