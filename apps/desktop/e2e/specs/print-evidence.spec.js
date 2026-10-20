// Print-evidence capture (dispatch-only): drives the REAL desktop Export to
// PDF flow end-to-end in the real application binary and captures the exact
// render-time DOM the platform print dialog would render.
//
// Flow per fixture work: open the named work -> open the shared Export menu
// -> click the real `#print-work` option -> the shipped `printCurrentWork`
// runs (sets its print markers, awaits the native `print_work` command,
// records `window.__elefPrintResult`) -> capture `documentElement.outerHTML`
// after the command resolves.
//
// The captured DOM is the flow's own product: marker state is produced by
// the shipped code under test, never hand-applied. A separate renderer
// (`print-evidence-render.mjs`) prints that DOM to PDF with the shipped
// stylesheets. On pre-fix code the `finally` in `printCurrentWork` clears
// the markers before capture (UI-chrome dump); on fixed code they persist
// (Work-only pages).
//
// Runs only under ELEF_E2E_PROFILE=print-evidence via the dispatch-only
// `pdf-export-evidence` workflow. It never runs in the normal suites.
import { $, browser } from "@wdio/globals"
import { mkdir, writeFile } from "node:fs/promises"
import path from "node:path"

const evidenceDir = process.env.ELEF_E2E_PRINT_EVIDENCE_DIR
if (!evidenceDir) throw new Error("ELEF_E2E_PRINT_EVIDENCE_DIR is not set for the print-evidence capture")

const FIXTURES = [
  { title: "E2E seed", slug: "presentation", sourceFile: "presentation.md" },
  { title: "E2E document", slug: "document", sourceFile: "document.md" },
]

async function openWork(title = "E2E seed") {
  if (!(await $("#library-view").isDisplayed())) {
    if ((await $("#desktop-editor-form").getAttribute("data-editor-mode")) === "visual") {
      const source = await $("#source-mode")
      if ((await source.getAttribute("aria-pressed")) !== "true") await source.click()
      await browser.waitUntil(async () => (await $("#desktop-editor-form").getAttribute("data-editor-mode")) === "source", {
        timeout: 5_000,
        timeoutMsg: "The desktop source editor did not activate",
      })
    }
    await $("#back-to-library").click()
    await $("#library-view").waitForDisplayed()
  }
  await $("#show-work-list").click()
  const card = $(`[aria-label="Edit ${title}"]`)
  await card.waitForDisplayed()
  await card.click()
  await browser.waitUntil(async () => browser.execute(expected => {
    const form = document.querySelector("#desktop-editor-form")
    return document.querySelector("#work-title")?.textContent === expected
      && form?.dataset.loadedWorkId === document.querySelector("#work-id")?.textContent
      && form?.dataset.editorMode === "visual"
      && !document.querySelector("#visual-mode")?.disabled
      && !document.querySelector("#work-view")?.hidden
  }, title), {
    timeout: 10_000,
    timeoutMsg: `The ${title} work did not finish opening in visual mode`,
  })
}

async function openExportMenu() {
  const button = $("#export-menu-button")
  await button.waitForDisplayed()
  const isOpen = await browser.execute(() => document.querySelector("#export-menu")?.open === true)
  if (!isOpen) await button.click()
  await browser.waitUntil(async () => browser.execute(() => document.querySelector("#export-menu")?.open === true), {
    timeout: 5_000,
    timeoutMsg: "The desktop Export menu did not open",
  })
}

async function assertExportMenuClosed(context) {
  await browser.waitUntil(async () => browser.execute(() => document.querySelector("#export-menu")?.open !== true), {
    timeout: 5_000,
    timeoutMsg: `The desktop Export menu stayed open after ${context}`,
  })
}

describe("print evidence capture", () => {
  it("captures the real Export-to-PDF render-time DOM for the fixed print fixtures", async () => {
    await mkdir(evidenceDir, { recursive: true })
    for (const fixture of FIXTURES) {
      await openWork(fixture.title)
      await openExportMenu()
      await browser.execute(() => { delete window.__elefPrintResult })
      await $("#print-work").click()
      await browser.waitUntil(async () => browser.execute(() => window.__elefPrintResult?.native === true), {
        timeout: 10_000,
        timeoutMsg: `The PDF option did not reach the native print command for ${fixture.title}`,
      })
      await assertExportMenuClosed(`the print option for ${fixture.title}`)
      const capture = await browser.execute(() => ({
        html: document.documentElement.outerHTML,
        bodyClasses: [...document.body.classList].sort(),
        printingMarkers: [...document.body.classList].filter(marker => marker.startsWith("printing-")).sort(),
        printResult: window.__elefPrintResult ?? null,
      }))
      await writeFile(path.join(evidenceDir, `${fixture.slug}.html`), capture.html, "utf8")
      await writeFile(path.join(evidenceDir, `${fixture.slug}.json`), JSON.stringify({
        fixture: fixture.title,
        sourceFile: fixture.sourceFile,
        flow: "desktop Export menu #print-work -> printCurrentWork -> native print_work (webdriver resolve, no dialog) -> post-resolve DOM",
        bodyClasses: capture.bodyClasses,
        printingMarkers: capture.printingMarkers,
        printResult: capture.printResult,
      }, null, 2) + "\n", "utf8")
    }
  })
})
