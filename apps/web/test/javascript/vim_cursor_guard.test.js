// Vim normal-block color guard: CodeMirror's vim default paints the normal
// block #ff9696 red from a runtime-injected, unlayered sheet, which beats
// every layered normal declaration no matter the specificity. Elef answers
// with a root-anchored guard plus !important on the mode-aware fat-cursor
// rules, so the block resolves to the theme token on every surface and host.
// These predicates lock the structural side; the system test in
// test/system/vim_editor_test.rb proves the computed color end to end.
import assert from "node:assert/strict"
import test from "node:test"
import { readFileSync, readdirSync, statSync } from "node:fs"
import { join, dirname } from "node:path"
import { fileURLToPath } from "node:url"

const here = dirname(fileURLToPath(import.meta.url))
const webRoot = join(here, "..", "..")
const stylesheetsRoot = join(webRoot, "app", "assets", "stylesheets")

function readOwnCssFiles(directory) {
  const out = []
  for (const name of readdirSync(directory).sort()) {
    if (name === "katex") continue // third-party vendored fonts and CSS
    const path = join(directory, name)
    if (statSync(path).isDirectory()) out.push(...readOwnCssFiles(path))
    else if (name.endsWith(".css")) out.push({ path, css: readFileSync(path, "utf8") })
  }
  return out
}

const ownCss = readOwnCssFiles(stylesheetsRoot)
const editorCss = readFileSync(join(stylesheetsRoot, "components", "editor.css"), "utf8")
const tokenCss = readFileSync(join(stylesheetsRoot, "tokens.css"), "utf8")

function hexToRgb(hex) {
  const short = /^#([0-9a-f]{3})$/i.exec(hex)
  const full = /^#([0-9a-f]{6})$/i.exec(hex)
  const digits = short ? short[1].split("").map((c) => c + c).join("") : full?.[1]
  assert.ok(digits, `expected a hex color, got ${hex}`)
  const value = parseInt(digits, 16)
  return [(value >> 16) & 0xff, (value >> 8) & 0xff, value & 0xff]
}

test("vim cursor guard: no upstream red in Elef's own stylesheets", () => {
  for (const { path, css } of ownCss) {
    const withoutComments = css.replace(/\/\*[\s\S]*?\*\//g, "")
    assert.ok(!/#ff9696/i.test(withoutComments), `${path} must not paint the upstream vim red`)
  }
})

test("vim cursor guard: root-anchored override binds the theme token", () => {
  for (const state of ["", ":not(.cm-focused)"]) {
    const selector = `.elef-app .cm-editor${state} .cm-fat-cursor`
    assert.ok(editorCss.includes(selector), `editor.css must anchor the guard on ${selector}`)
  }
  assert.ok(
    /\.elef-app \.cm-editor \.cm-fat-cursor \{[^}]*var\(--oradia-vim-normal\)[^}]*!important[^}]*\}/s.test(editorCss),
    "focused guard must bind var(--oradia-vim-normal) with !important",
  )
  assert.ok(
    /\.elef-app \.cm-editor:not\(\.cm-focused\) \.cm-fat-cursor \{[^}]*outline:[^;}]*var\(--oradia-vim-normal\)[^;}]*!important[^}]*\}/s.test(editorCss),
    "unfocused guard must bind the token outline with !important",
  )
})

test("vim cursor guard: mode-aware fat rules stay above the guard", () => {
  for (const mode of ["visual", "normal"]) {
    const base = `.editor-surface[data-mode-aware-cursor="true"][data-editor-mode="${mode}"]`
    assert.ok(
      new RegExp(`${base.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")} \\.cm-fat-cursor \\{[^}]*!important[^}]*\\}`, "s").test(editorCss),
      `${mode} fat-cursor rule must carry !important so the guard cannot demote it`,
    )
  }
})

test("vim cursor guard: normal token is theme green, not red", () => {
  const match = /--oradia-vim-normal:\s*(#[0-9a-f]{3,6})/i.exec(tokenCss)
  assert.ok(match, "tokens.css must define --oradia-vim-normal as a hex color")
  const [red, green, blue] = hexToRgb(match[1])
  assert.ok(green >= red && green >= blue, `token ${match[1]} must be green-dominant`)
  assert.ok(red < 200, `token ${match[1]} must not be a red`)
})
