import { expect, test } from "@playwright/test"
import { readFile } from "node:fs/promises"
import { renderPreview } from "../../../app/javascript/lib/renderer.js"

async function readApplicationStylesheet() {
  const index = await readFile(new URL("../../../app/assets/stylesheets/application.css", import.meta.url), "utf8")
  const layerOrder = index.match(/^\s*@layer [^;]+;/m)?.[0]
  const imports = [...index.matchAll(/^\s*@import url\("\.\/([^"\n]+\.css)"\) layer\(([^)]+)\);\s*$/gm)]
  const partials = await Promise.all(imports.map(([, stylesheet]) =>
    readFile(new URL(`../../../app/assets/stylesheets/${stylesheet}`, import.meta.url), "utf8")
  ))

  if (!layerOrder || imports.length === 0) throw new Error("Could not resolve the layered application stylesheet")

  return [
    layerOrder,
    ...imports.map(([, , layer], index) => `@layer ${layer} {\n${partials[index]}\n}`)
  ].join("\n")
}

async function hostStylesheets() {
  const applicationStylesheet = await readApplicationStylesheet()
  const tailwind = await readFile(new URL("../../../app/assets/builds/tailwind.css", import.meta.url), "utf8")
  return {
    web: `${tailwind}\n${applicationStylesheet}`,
    desktop: (await readFile(new URL("../../../app/assets/stylesheets/file_library_host.css", import.meta.url), "utf8")) +
      (await readFile(new URL("../../frontend/dist/assets/tailwind.css", import.meta.url), "utf8")) +
      (await readFile(new URL("../../frontend/dist/assets/app.css", import.meta.url), "utf8"))
  }
}

async function setStaticFixture(page, fixturePath, styles) {
  const fixture = await readFile(new URL(fixturePath, import.meta.url), "utf8")
  await page.setContent(fixture)
  await page.locator("style[data-host-styles]").evaluate((element, css) => { element.textContent = css }, styles)
}

test("shared rendering styles preserve slide layouts and document typography", async ({ page }) => {
  const styles = await hostStylesheets()
  const fixtures = [
    { kind: "presentation", source: "# Roadmap\n\n## First\n\nFirst column.\n\n## Second\n\nSecond column.\n", style: { theme: "light", typography: "book" } },
    { kind: "presentation", source: "# Theme\n\nDark presentation text.\n", style: { theme: "dark", typography: "technical" } },
    { kind: "document", source: "# Document\n\nBody text with **emphasis**.\n", style: { theme: "light", typography: "book" } },
    { kind: "document", source: "# Technical\n\nBody text with `code`.\n", style: { theme: "dark", typography: "technical" } }
  ]

  for (const fixture of fixtures) {
    const previewHtml = renderPreview({ ...fixture, title: "Style fixture", allowRemoteMedia: false }).html
    const html = fixture.kind === "document"
      ? `<div class="document-page-frame"><article class="document-page">${previewHtml}</article></div>`
      : previewHtml
    const measured = {}
    for (const [target, css] of Object.entries(styles)) {
      await page.setContent(`<style>${css}\n*{box-sizing:border-box}body{margin:0}.fixture-root{width:1280px}</style><div class="fixture-root">${html}</div>`)
      measured[target] = await page.evaluate(() => {
        const selectors = [".slide-frame", ".slide", ".slide h1", ".slide p", ".slide-regions", ".document-surface", ".document-surface h1", ".document-surface p"]
        const styles = Object.fromEntries(selectors.flatMap(selector => {
          const node = document.querySelector(selector)
          if (!node) return []
          const style = getComputedStyle(node)
          const rect = node.getBoundingClientRect()
          return [[selector, { font: style.fontFamily, size: style.fontSize, lineHeight: style.lineHeight,
            color: style.color, background: style.backgroundImage, display: style.display,
            columns: style.gridTemplateColumns, width: style.width, height: style.height,
            rectWidth: rect.width, rectHeight: rect.height, overflow: style.overflow }]]
        }))
        const pageFrame = document.querySelector(".document-page-frame")
        const page = pageFrame?.querySelector(".document-page")
        const pageRect = pageFrame?.getBoundingClientRect()
        return {
          styles,
          pageBoundary: pageFrame && pageRect ? {
            width: pageRect.width,
            height: pageRect.height,
            overflow: getComputedStyle(page).overflow
          } : null
        }
      })
    }
    expect(measured.desktop.styles).toEqual(measured.web.styles)
    expect(measured.desktop.pageBoundary).toEqual(measured.web.pageBoundary)
    if (fixture.kind === "presentation") {
      expect(measured.web.styles[".slide"].width).toBe("1280px")
      expect(measured.web.styles[".slide"].height).toBe("720px")
      expect(Math.abs(measured.web.styles[".slide-frame"].rectWidth / measured.web.styles[".slide-frame"].rectHeight - 16 / 9)).toBeLessThan(0.01)
      expect(measured.web.styles[".slide"].overflow).toBe("hidden")
    }
    if (fixture.source.includes("## Second")) {
      expect(measured.desktop.styles[".slide-regions"].display).toBe("grid")
      expect(measured.desktop.styles[".slide-regions"].columns.split(" ")).toHaveLength(2)
      const regionWidths = await page.locator(".slide-region").evaluateAll(regions =>
        regions.map(region => region.getBoundingClientRect().width)
      )
      expect(regionWidths).toHaveLength(2)
      expect(regionWidths[0]).toBeGreaterThan(500)
      expect(Math.abs(regionWidths[0] - regionWidths[1])).toBeLessThan(1)
    }
    if (fixture.kind === "document") {
      expect(measured.web.pageBoundary.width).toBe(794)
      expect(measured.web.pageBoundary.height).toBeCloseTo(794 * 297 / 210, 0)
      expect(measured.web.pageBoundary.overflow).toBe("hidden")
      expect(measured.web.styles[".document-surface h1"].size).toBe("48px")
      expect(measured.web.styles[".document-surface p"].lineHeight).toBe("28.8px")
    }
  }
})

test("workspace graph panels use independently specified dark surface colors", async ({ page }) => {
  const styles = await hostStylesheets()
  for (const [host, css] of Object.entries(styles)) {
    await page.setContent(`<!doctype html><html data-theme="dark"><head><style>${css}</style></head><body class="elef-app">
      <section class="document-graph-panel"><h2>Documents</h2><p>Document graph</p></section>
      <section class="lineage-panel"><h2>Presentations</h2><p>Presentation graph</p></section>
    </body></html>`)
    const panels = await page.locator(".document-graph-panel, .lineage-panel").evaluateAll(elements => elements.map(element => {
      const style = getComputedStyle(element)
      return { background: style.backgroundColor, border: style.borderColor, shadow: style.boxShadow }
    }))
    expect(panels, host).toEqual([
      { background: "rgb(24, 33, 38)", border: "rgba(206, 224, 213, 0.18)", shadow: "rgba(0, 0, 0, 0.16) 0px 18px 45px 0px" },
      { background: "rgb(24, 33, 38)", border: "rgba(206, 224, 213, 0.18)", shadow: "rgba(0, 0, 0, 0.16) 0px 18px 45px 0px" }
    ])
  }
})

test("math shortcut settings use the expected dark surfaces", async ({ page }) => {
  const styles = await hostStylesheets()
  for (const [host, css] of Object.entries(styles)) {
    await setStaticFixture(page, "../fixtures/math-shortcuts-dark.html", css)
    const colors = await page.evaluate(() => [
      getComputedStyle(document.querySelector(".math-shortcut-card")).backgroundColor,
      getComputedStyle(document.querySelector(".authoring-settings-dialog")).backgroundColor,
      getComputedStyle(document.querySelector(".authoring-math-fields input")).backgroundColor
    ])
    expect(colors, host).toEqual(["rgb(24, 33, 38)", "rgb(24, 33, 38)", "rgb(17, 22, 26)"])
  }
})

test("the source editor component has matching web and desktop layout styles", async ({ page }) => {
  const styles = await hostStylesheets()
  const measured = {}
  for (const [host, css] of Object.entries(styles)) {
    await setStaticFixture(page, "../fixtures/editor-styles.html", css)
    measured[host] = await page.evaluate(() => {
      const selectors = [".editor-shell", ".editor-layout", ".source-pane", ".source-field", ".editor-toolbar",
        ".editor-surface", ".cm-editor", ".cm-scroller", ".cm-content", ".editor-projection"]
      const properties = ["display", "position", "width", "height", "minHeight", "maxHeight", "gridTemplateColumns",
        "gap", "fontFamily", "fontSize", "lineHeight", "color", "backgroundColor", "overflow", "padding", "borderRadius"]
      return Object.fromEntries(selectors.map(selector => {
        const element = document.querySelector(selector)
        const style = getComputedStyle(element)
        const rect = element.getBoundingClientRect()
        return [selector, {
          ...Object.fromEntries(properties.map(property => [property, style[property]])),
          rectWidth: rect.width,
          rectHeight: rect.height
        }]
      }))
    })
  }
  expect(measured.desktop).toEqual(measured.web)
  expect(measured.web[".editor-layout"].gridTemplateColumns.split(" ")).toHaveLength(2)
  expect(measured.web[".cm-editor"].rectHeight).toBeGreaterThan(300)
  expect(measured.web[".editor-shell"].backgroundColor).toBe("rgb(24, 33, 38)")
})
