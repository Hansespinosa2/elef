// Selection highlight guard: native dark-mode selection (inherited from the
// desktop shell's :root { color-scheme: dark; }) turns selected text white on
// a dark highlight box while ::marker bullets/numbers, pseudo-elements, and
// currentColor math rules stay dark on light paper. Work surfaces own their
// own color-scheme and ::selection tokens so selected text keeps the surface's
// ink color against a translucent tint across all document, slide, and
// warning/graph surfaces under both dark and light desktop host themes.
import assert from "node:assert/strict"
import test from "node:test"
import { readFileSync } from "node:fs"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"

const here = dirname(fileURLToPath(import.meta.url))
const stylesheetsRoot = join(here, "..", "..", "app", "assets", "stylesheets")

const readCss = (...parts) => readFileSync(join(stylesheetsRoot, ...parts), "utf8")

const tokensCss = readCss("tokens.css")
const themesCss = readCss("themes.css")
const hostCss = readCss("file_library_host.css")
const editorCss = readCss("components", "editor.css")
const documentsCss = readCss("components", "documents.css")
const slidesCss = readCss("components", "slides.css")
const codeCss = readCss("components", "code.css")
const baseCss = readCss("base.css")
const chromeCss = readCss("components", "chrome.css")
const libraryCss = readCss("components", "library.css")
const settingsCss = readCss("components", "settings.css")
const applicationCss = readCss("application.css")

function blockFor(css, selector) {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
  const matches = [...css.matchAll(new RegExp(`(?:^|\\n)\\s*${escaped}\\s*\\{([^}]*)\\}`, "gs"))]
  assert.ok(matches.length > 0, `expected CSS rule for ${selector}`)
  return matches.map((match) => match[1]).join("\n")
}

function parseRgba(value) {
  const match = /rgba\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*,\s*([0-9.]+)\s*\)/.exec(value)
  assert.ok(match, `expected rgba(...) value, got ${value}`)
  return {
    rgb: [Number(match[1]), Number(match[2]), Number(match[3])],
    alpha: Number(match[4]),
  }
}

function parseHex(hex) {
  const clean = hex.trim().replace(/^#/, "")
  return [
    parseInt(clean.slice(0, 2), 16),
    parseInt(clean.slice(2, 4), 16),
    parseInt(clean.slice(4, 6), 16),
  ]
}

function relativeLuminance([r, g, b]) {
  const channel = (value) => {
    const srgb = value / 255
    return srgb <= 0.04045 ? srgb / 12.92 : ((srgb + 0.055) / 1.055) ** 2.4
  }
  return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b)
}

function contrastRatio(rgbA, rgbB) {
  const lumA = relativeLuminance(rgbA)
  const lumB = relativeLuminance(rgbB)
  const lighter = Math.max(lumA, lumB)
  const darker = Math.min(lumA, lumB)
  return (lighter + 0.05) / (darker + 0.05)
}

function blendOver(fg, alpha, bg) {
  return fg.map((channel, index) => Math.round(alpha * channel + (1 - alpha) * bg[index]))
}

function tokenValue(css, name) {
  const match = new RegExp(`${name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}:\\s*([^;]+);`).exec(css)
  assert.ok(match, `expected token ${name}`)
  return match[1].trim()
}

test("work surfaces declare matching color-scheme polarity and selection rules on content containers", () => {
  assert.match(blockFor(editorCss, ".editor-projection"), /color-scheme:\s*light;/)
  assert.match(blockFor(documentsCss, ".document-surface"), /color-scheme:\s*light;/)
  assert.match(blockFor(documentsCss, ".document-page"), /color-scheme:\s*var\(--document-color-scheme,\s*light\);/)
  assert.match(blockFor(slidesCss, ".slide"), /color-scheme:\s*var\(--work-color-scheme,\s*light\);/)

  // Presentation selection stays scoped to .slide rather than .presentation-surface
  // so dark present/print toolbars outside .slide keep light text on #11161a.
  assert.doesNotMatch(slidesCss, /\.presentation-surface\s*::selection/)
  assert.doesNotMatch(slidesCss, /\.presentation-surface\s*\{[^}]*color-scheme:/)

  for (const [label, css, ruleSelector, bgToken, inkToken] of [
    ["editor projection", editorCss, ".editor-projection ::selection,\n.editor-projection::selection", "--oradia-vim-selection", "--oradia-paper-ink"],
    ["document surface", documentsCss, ".document-surface ::selection,\n.document-surface::selection", "--oradia-vim-selection", "--oradia-paper-ink"],
    ["document page", documentsCss, ".document-page ::selection,\n.document-page::selection", "--document-selection-background", "--document-page-ink"],
    ["slide", slidesCss, ".slide::selection,\n.slide ::selection", "--work-selection-background", "--work-surface-ink"],
  ]) {
    const block = blockFor(css, ruleSelector)
    assert.ok(block.includes(`var(${bgToken})`), `${label} ::selection must bind ${bgToken}`)
    assert.ok(block.includes(`var(${inkToken})`), `${label} ::selection must bind ${inkToken}`)
  }

  assert.ok(
    documentsCss.indexOf(".document-page ::selection") > documentsCss.indexOf(".document-surface ::selection"),
    ".document-page ::selection must follow .document-surface ::selection in documents.css",
  )
})

test("dark code blocks, chrome pills, and present/print toolbars keep dark selection without clobbering slides", () => {
  for (const [css, preSel, selRule] of [
    [
      documentsCss,
      ".document-surface pre:not(.mermaid[data-processed], .mermaid.mermaid-error)",
      ".document-surface pre:not(.mermaid[data-processed], .mermaid.mermaid-error) ::selection,\n.document-surface pre:not(.mermaid[data-processed], .mermaid.mermaid-error)::selection",
    ],
    [
      slidesCss,
      ".presentation-surface pre:not(.mermaid[data-processed], .mermaid.mermaid-error)",
      ".presentation-surface pre:not(.mermaid[data-processed], .mermaid.mermaid-error) ::selection,\n.presentation-surface pre:not(.mermaid[data-processed], .mermaid.mermaid-error)::selection",
    ],
  ]) {
    assert.match(blockFor(css, preSel), /color-scheme:\s*dark;/)
    const block = blockFor(css, selRule)
    assert.match(block, /var\(--work-code-selection-background\)/)
    assert.match(block, /var\(--work-code-selection-ink\)/)
  }
  // Ensure bare `pre { color-scheme: dark }` / `pre ::selection` does not capture
  // transparent rendered or error Mermaid <pre> blocks.
  assert.doesNotMatch(documentsCss, /\.document-surface\s+pre\s*\{[^}]*color-scheme:/)
  assert.doesNotMatch(slidesCss, /\.presentation-surface\s+pre\s*\{[^}]*color-scheme:/)
  assert.doesNotMatch(documentsCss, /\.document-surface\s+pre\s*::selection/)
  assert.doesNotMatch(slidesCss, /\.presentation-surface\s+pre\s*::selection/)

  for (const chrome of [".document-block-position-control", ".presentation-editor-slide-toolbar", ".presentation-editor-block-controls"]) {
    assert.match(blockFor(editorCss, chrome), /color-scheme:\s*dark;/)
  }
  const chromeSel = blockFor(
    editorCss,
    ".editor-projection .document-block-position-control::selection,\n.editor-projection .document-block-position-control ::selection,\n.editor-projection .presentation-editor-slide-toolbar::selection,\n.editor-projection .presentation-editor-slide-toolbar ::selection,\n.editor-projection .presentation-editor-block-controls::selection,\n.editor-projection .presentation-editor-block-controls ::selection",
  )
  assert.match(chromeSel, /var\(--work-code-selection-background\)/)
  assert.match(chromeSel, /color:\s*#e9eee9;/)

  assert.match(blockFor(codeCss, ".presentation-print"), /color-scheme:\s*dark;/)
  assert.match(blockFor(codeCss, ".presentation-print-toolbar"), /color-scheme:\s*dark;/)
  assert.match(blockFor(documentsCss, ".document-print"), /color-scheme:\s*dark;/)
  assert.match(blockFor(codeCss, ".presentation-mode"), /color-scheme:\s*dark;/)
  assert.match(
    blockFor(codeCss, ".presentation-print-toolbar::selection,\n.presentation-print-toolbar ::selection"),
    /var\(--work-code-selection-background\)/,
  )
  assert.match(
    blockFor(codeCss, ".presentation-print > :not(.slides)::selection,\n.presentation-print > :not(.slides) ::selection"),
    /var\(--work-code-selection-background\)/,
  )
  assert.match(
    blockFor(codeCss, ".presentation-mode > :not(.presentation-stage)::selection,\n.presentation-mode > :not(.presentation-stage) ::selection"),
    /var\(--work-code-selection-background\)/,
  )

  for (const [css, selector, selSelector, inkHex] of [
    [codeCss, ".slide-overflow-warnings", ".slide-overflow-warnings::selection,\n.slide-overflow-warnings ::selection", "#f5d982"],
    [baseCss, ".elef-app .error-panel", ".elef-app .error-panel::selection,\n.elef-app .error-panel ::selection", "#f3c7c9"],
    [baseCss, ".elef-app .flash", ".elef-app .flash::selection,\n.elef-app .flash ::selection", "#d7eddb"],
    [chromeCss, ".bug-report-error", ".bug-report-error::selection,\n.bug-report-error ::selection", "#f3c7c9"],
  ]) {
    assert.match(blockFor(css, selector), /color-scheme:\s*dark;/)
    const selBlock = blockFor(css, selSelector)
    assert.match(selBlock, /var\(--work-code-selection-background\)/)
    assert.match(selBlock, new RegExp(`color:\\s*${inkHex};`, "i"))
  }
})

test("light non-work surfaces and shell snippet previews match their host polarity", () => {
  assert.match(blockFor(documentsCss, ".document-graph"), /color-scheme:\s*light;/)
  assert.match(
    blockFor(documentsCss, ".document-graph::selection,\n.document-graph ::selection"),
    /var\(--oradia-vim-selection\)/,
  )

  assert.match(blockFor(libraryCss, ".lineage-graph-canvas"), /color-scheme:\s*light;/)
  assert.match(
    blockFor(libraryCss, ".lineage-graph-canvas::selection,\n.lineage-graph-canvas ::selection"),
    /var\(--oradia-vim-selection\)/,
  )
  assert.match(
    blockFor(libraryCss, ":where(.lineage-graph-canvas) .slide::selection,\n:where(.lineage-graph-canvas) .slide ::selection"),
    /var\(--work-selection-background\)/,
  )
  // Keep slide override at (0, 1, 1) via :where() so .presentation-surface pre:not(...) ::selection (0, 3, 2) still wins.
  assert.doesNotMatch(libraryCss, /\.lineage-graph-canvas\s+\.slide/)

  assert.match(blockFor(libraryCss, ".preview-warnings,\n.presentation-warnings,\np.release-state"), /color-scheme:\s*light;/)
  const warnSel = blockFor(
    libraryCss,
    ".preview-warnings::selection,\n.preview-warnings ::selection,\n.presentation-warnings::selection,\n.presentation-warnings ::selection,\np.release-state::selection,\np.release-state ::selection",
  )
  assert.match(warnSel, /var\(--oradia-vim-selection\)/)
  assert.match(warnSel, /color:\s*#765700;/)
  assert.match(blockFor(libraryCss, ".editor-footer .release-state"), /color-scheme:\s*var\(--oradia-color-scheme,\s*dark\);/)
  const footerReleaseSel = blockFor(
    libraryCss,
    ".editor-footer .release-state::selection,\n.editor-footer .release-state ::selection",
  )
  assert.match(footerReleaseSel, /var\(--oradia-shell-selection-background/)
  assert.match(footerReleaseSel, /var\(--oradia-ink\)/)

  assert.match(blockFor(settingsCss, ".snippet-example-preview"), /color-scheme:\s*var\(--oradia-color-scheme,\s*dark\);/)
  const snippetSel = blockFor(settingsCss, ".snippet-example-preview ::selection,\n.snippet-example-preview::selection")
  assert.match(snippetSel, /var\(--oradia-shell-selection-background/)
  assert.match(snippetSel, /var\(--oradia-ink\)/)
})

test("layer and stylesheet import order keeps themes before components and surface rules after editor defaults", () => {
  assert.match(applicationCss, /@layer\s+elef-tokens,\s*elef-base,\s*elef-themes,\s*elef-typography,\s*elef-components,\s*elef-utilities;/)
  assert.match(applicationCss, /themes\.css"\)\s*layer\(elef-themes\)/)
  for (const component of ["editor.css", "slides.css", "code.css", "documents.css", "settings.css"]) {
    assert.match(applicationCss, new RegExp(`${component.replace(".", "\\.")}"\\)\\s*layer\\(elef-components\\)`))
  }
  const editorIndex = applicationCss.indexOf("./components/editor.css")
  const slidesIndex = applicationCss.indexOf("./components/slides.css")
  const codeIndex = applicationCss.indexOf("./components/code.css")
  const documentsIndex = applicationCss.indexOf("./components/documents.css")
  const settingsIndex = applicationCss.indexOf("./components/settings.css")
  assert.ok(editorIndex >= 0 && slidesIndex > editorIndex && codeIndex > slidesIndex && documentsIndex > editorIndex && settingsIndex > editorIndex)
})

test("every theme adapts to desktop dark and light host shells and passes WCAG AA contrast under selection", () => {
  const lightSel = parseRgba(tokenValue(tokensCss, "--oradia-vim-selection"))
  const darkSel = parseRgba(tokenValue(tokensCss, "--work-dark-selection-background"))
  const codeSel = parseRgba(tokenValue(tokensCss, "--work-code-selection-background"))
  const techLightBlock = blockFor(themesCss, ".presentation-surface.slides-presentation-technical-light")
  const techSel = parseRgba(tokenValue(techLightBlock, "--work-selection-background"))

  const paperInk = parseHex(tokenValue(tokensCss, "--oradia-paper-ink"))
  const darkInk = parseHex(tokenValue(tokensCss, "--oradia-ink"))
  const codeInk = parseHex(tokenValue(tokensCss, "--work-code-selection-ink"))
  const artAccentLight = [0, 1, 2].map((i) =>
    Math.round(0.45 * parseHex(tokenValue(tokensCss, "--oradia-green-deep"))[i] + 0.55 * paperInk[i]),
  )

  // Desktop light host theme overrides --oradia-slate-* and --oradia-ink in both
  // explicit [data-theme="light"] and @media (prefers-color-scheme: light) [data-theme="system"].
  const lightHostBlock = blockFor(hostCss, ':root[data-theme="light"]')
  const systemLightMediaMatch = /@media\s*\(prefers-color-scheme:\s*light\)\s*\{([\s\S]*?\n\})/.exec(hostCss)
  assert.ok(systemLightMediaMatch, "expected @media (prefers-color-scheme: light) block in file_library_host.css")
  const systemLightBlock = blockFor(systemLightMediaMatch[1], ':root[data-theme="system"]')
  for (const hostBlock of [lightHostBlock, systemLightBlock]) {
    assert.match(hostBlock, /--oradia-color-scheme:\s*light;/)
    assert.match(hostBlock, /--oradia-shell-selection-background:\s*var\(--oradia-vim-selection\);/)
    assert.match(hostBlock, /--work-dark-color-scheme:\s*light;/)
    assert.match(hostBlock, /--work-dark-selection-background:\s*var\(--oradia-vim-selection\);/)
    assert.match(hostBlock, /--work-dark-reveal-marker-ink:\s*#4f5852;/)
  }

  const hostLightSlate800 = parseHex(tokenValue(lightHostBlock, "--oradia-slate-800"))
  const hostLightSlate950 = parseHex(tokenValue(lightHostBlock, "--oradia-slate-950"))
  const hostLightInk = parseHex(tokenValue(lightHostBlock, "--oradia-ink"))
  assert.deepEqual(parseHex(tokenValue(systemLightBlock, "--oradia-slate-800")), hostLightSlate800)
  assert.deepEqual(parseHex(tokenValue(systemLightBlock, "--oradia-slate-950")), hostLightSlate950)
  assert.deepEqual(parseHex(tokenValue(systemLightBlock, "--oradia-ink")), hostLightInk)

  const lightRevealInk = parseHex(tokenValue(tokensCss, "--work-reveal-marker-ink"))
  const darkRevealInk = parseHex(tokenValue(tokensCss, "--work-dark-reveal-marker-ink"))
  const lightHostRevealInk = parseHex(tokenValue(lightHostBlock, "--work-dark-reveal-marker-ink"))
  for (const revealSel of [".editor-reveal-marker::before", ".editor-reveal-fence::before", ".editor-reveal-fence[data-editor-reveal-fence-close]::after"]) {
    assert.match(blockFor(editorCss, revealSel), /color:\s*var\(--work-reveal-marker-ink,\s*#4f5852\);/)
  }

  for (const [label, bgHex, sel, fg] of [
    ["light paper bright", tokenValue(tokensCss, "--oradia-paper-bright"), lightSel, paperInk],
    ["light paper base", tokenValue(tokensCss, "--oradia-paper"), lightSel, paperInk],
    ["light paper reveal marker", tokenValue(tokensCss, "--oradia-paper"), lightSel, lightRevealInk],
    ["light theme white", "#fffdf8", lightSel, paperInk],
    ["technical light top", "#a7b0b6", techSel, paperInk],
    ["technical light bottom", "#8f989e", techSel, paperInk],
    ["technical light art sequence marker", "#8f989e", techSel, artAccentLight],
    ["technical light reveal marker", "#8f989e", techSel, paperInk],
    ["dark slate top", tokenValue(tokensCss, "--oradia-slate-800"), darkSel, darkInk],
    ["dark slate reveal marker", tokenValue(tokensCss, "--oradia-slate-800"), darkSel, darkRevealInk],
    ["dark slate mid", tokenValue(tokensCss, "--oradia-slate-900"), darkSel, darkInk],
    ["dark slate base", tokenValue(tokensCss, "--oradia-slate-950"), darkSel, darkInk],
    ["desktop light host over dark theme top", hostLightSlate800, lightSel, hostLightInk],
    ["desktop light host over dark theme reveal marker", hostLightSlate800, lightSel, lightHostRevealInk],
    ["desktop light host over dark theme base", hostLightSlate950, lightSel, hostLightInk],
    ["code block pre", "#191714", codeSel, codeInk],
    ["slide overflow warnings", "#493a18", codeSel, parseHex("#f5d982")],
    ["error panel / bug report error", "#3a2428", codeSel, parseHex("#f3c7c9")],
    ["flash banner", "#263c31", codeSel, parseHex("#d7eddb")],
    ["preview warnings", "#fff8df", lightSel, parseHex("#765700")],
  ]) {
    const bg = Array.isArray(bgHex) ? bgHex : parseHex(bgHex)
    const composited = blendOver(sel.rgb, sel.alpha, bg)
    const ratio = contrastRatio(fg, composited)
    assert.ok(ratio >= 4.5, `${label} selection contrast ${ratio.toFixed(2)}:1 must be >= 4.5:1`)
  }
  for (const [label, bgHex, fg] of [
    ["light paper reveal marker unselected", tokenValue(tokensCss, "--oradia-paper"), lightRevealInk],
    ["technical light reveal marker unselected", "#8f989e", paperInk],
    ["dark slate reveal marker unselected", tokenValue(tokensCss, "--oradia-slate-800"), darkRevealInk],
    ["desktop light host reveal marker unselected", hostLightSlate800, lightHostRevealInk],
  ]) {
    const bg = Array.isArray(bgHex) ? bgHex : parseHex(bgHex)
    const ratio = contrastRatio(fg, bg)
    assert.ok(ratio >= 4.5, `${label} contrast ${ratio.toFixed(2)}:1 must be >= 4.5:1`)
  }

  for (const [selector, schemePattern, selVar] of [
    [".work-theme-dark", /--work-color-scheme:\s*var\(--work-dark-color-scheme\);/, "--work-dark-selection-background"],
    [".work-theme-light", /--work-color-scheme:\s*light;/, "--oradia-vim-selection"],
    [".work-theme-match", /--work-color-scheme:\s*light;/, "--oradia-vim-selection"],
    [".document-theme-dark", /--document-color-scheme:\s*var\(--work-dark-color-scheme\);/, "--work-dark-selection-background"],
    [".document-theme-light", /--document-color-scheme:\s*light;/, "--oradia-vim-selection"],
    [".document-theme-match", /--document-color-scheme:\s*light;/, "--oradia-vim-selection"],
    [".presentation-surface.slides-presentation-book-light", /--work-color-scheme:\s*light;/, "--oradia-vim-selection"],
    [".presentation-surface.slides-presentation-modern-dark", /--work-color-scheme:\s*var\(--work-dark-color-scheme\);/, "--work-dark-selection-background"],
    [".presentation-surface.slides-presentation-technical-light", /--work-color-scheme:\s*light;/, null],
  ]) {
    const block = blockFor(themesCss, selector)
    assert.match(block, schemePattern)
    if (selVar) assert.match(block, new RegExp(`selection-background:\\s*var\\(${selVar}\\);`))
    else assert.match(block, /--work-selection-background:\s*rgba\(/)
  }
})
