// Elef Art source contract: CSS, lifecycle, and API properties that no
// behavioral test covers (single token source, no shrink-to-fit, Peer wrap,
// native Sequence markers, positioned fixed hosts, layout-space geometry,
// shared renderer exports, batched lifecycle, no layout DSL, stable DOM
// enums, forced-colors boundaries). Migrated verbatim from the retired
// apps/web/script/check_art_static.py when docs/smartart was deleted; the
// predicates are unchanged, only the runner moved into the standard suite.
import assert from "node:assert/strict"
import test from "node:test"
import { readFileSync, readdirSync, statSync } from "node:fs"
import { join, dirname } from "node:path"
import { fileURLToPath } from "node:url"

const here = dirname(fileURLToPath(import.meta.url))
const webRoot = join(here, "..", "..")
const repoRoot = join(here, "..", "..", "..", "..")
const stylesheetsRoot = join(webRoot, "app", "assets", "stylesheets")

function readCssFiles(directory) {
  const out = []
  for (const name of readdirSync(directory).sort()) {
    const path = join(directory, name)
    if (statSync(path).isDirectory()) out.push(...readCssFiles(path))
    else if (name.endsWith(".css")) out.push(readFileSync(path, "utf8"))
  }
  return out
}

const artCss = readFileSync(join(stylesheetsRoot, "components", "art.css"), "utf8")
const tokenCss = readFileSync(join(stylesheetsRoot, "tokens.css"), "utf8")
const allCss = readCssFiles(stylesheetsRoot).join("\n")
const layoutJs = readFileSync(join(repoRoot, "packages", "editor-runtime", "src", "lib", "art_layout.ts"), "utf8")
const controllerJs = readFileSync(join(repoRoot, "packages", "editor-runtime", "src", "controllers", "art_layout_controller.ts"), "utf8")
  + "\n" + readFileSync(join(repoRoot, "packages", "editor-runtime", "src", "lib", "art_layout.ts"), "utf8")
const sourceJs = readFileSync(join(repoRoot, "packages", "work-model", "src", "art_source.ts"), "utf8")
const rendererJs = readFileSync(join(repoRoot, "packages", "renderer", "src", "renderer.ts"), "utf8")
const globalRendererJs = readFileSync(join(repoRoot, "packages", "renderer", "src", "renderer_global.ts"), "utf8")
const authoringRegistry = readFileSync(join(webRoot, "app", "javascript", "data", "default_authoring_registry.json"), "utf8")
const authoringEntries = JSON.parse(authoringRegistry)

const requiredTokens = {
  "--art-gap": "16px",
  "--art-presentation-sequence-compact-gap": "20px",
  "--art-presentation-sequence-rich-gap": "4px",
  "--art-peer-basis-compact": "200px",
  "--art-peer-basis-rich": "280px",
  "--art-sequence-min-inline": "200px",
  "--art-card-padding": "2px",
  "--art-radius": "10px",
  "--art-document-lead-size": "18px",
  "--art-document-body-size": "16px",
  "--art-presentation-lead-size": "22px",
  "--art-presentation-body-size": "15px"
}

const escapeRegExp = value => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")

function tokensSingleSource() {
  for (const [name, value] of Object.entries(requiredTokens)) {
    const declarations = [...allCss.matchAll(new RegExp(`${escapeRegExp(name)}\\s*:\\s*([^;]+);`, "g"))].map(match => match[1])
    if (declarations.length !== 1 || declarations[0] !== value) return false
    if (!new RegExp(`${escapeRegExp(name)}\\s*:\\s*${escapeRegExp(value)};`).test(tokenCss)) return false
  }
  return controllerJs.includes('getPropertyValue("--art-gap")')
    && controllerJs.includes('getPropertyValue("--art-sequence-min-inline")')
}

test("TOKENS_SINGLE_SOURCE: Art constants live once in tokens.css and fit math reads computed values", () => {
  assert.ok(tokensSingleSource())
})

test("NO_SHRINK_OR_TRUNCATION: Art CSS never shrinks, clamps, ellipsizes, or hides authored content", () => {
  const forbidden = [
    /\b(?:-webkit-)?line-clamp\s*:/i,
    /\btext-overflow\s*:\s*ellipsis/i,
    /\bvisibility\s*:\s*hidden|\bdisplay\s*:\s*none|\boverflow\s*:\s*hidden/i,
    /font-size\s*:[^;}]*\b(?:vw|cqw|clamp\s*\()/i,
    /\bzoom\s*:/i,
    /\btransform\s*:[^;}]*\bscale\s*\(/i
  ]
  for (const pattern of forbidden) assert.doesNotMatch(artCss, pattern)
})

test("ACTIVE_THEME_TYPOGRAPHY: Art inherits the active font family and work-surface colors", () => {
  assert.doesNotMatch(artCss, /\bfont-family\s*:/i)
  assert.ok(artCss.includes("--work-surface-ink"))
  assert.ok(artCss.includes("--work-surface-background"))
})

test("PEER_WRAP_AND_PREFERRED_BASIS: Peers wrap centered on density-specific preferred widths", () => {
  for (const value of [
    "display: flex;", "flex-wrap: wrap;", "justify-content: center;",
    "flex: 0 1 var(--art-peer-basis-compact)", "flex: 0 1 var(--art-peer-basis-rich)"
  ]) assert.ok(artCss.includes(value))
  assert.doesNotMatch(
    artCss,
    /(?:^|[;{])\s*(?:left|right|inset-left|inset-right|margin-left|margin-right|padding-left|padding-right)\s*:/m
  )
})

test("NATIVE_SEQUENCE_MARKERS_AND_DECORATION: Sequences keep native numbering with decorative connectors", () => {
  const sequenceRule = artCss.match(/\.elef-art\[data-art-mode="sequence"\][^{]*\{[^}]*/)
  assert.ok(artCss.includes("list-style: decimal"))
  assert.ok(artCss.includes(".elef-art-list > li:not(:first-child)::before"))
  assert.ok(!sequenceRule || !sequenceRule[0].includes("list-style: none"))
})

test("FIXED_HOST_POSITIONED: fixed Art hosts establish positioning with a well-defined origin", () => {
  const rule = artCss.match(/\[data-art-host="fixed"\]\s*\{([^}]*)\}/s)
  assert.ok(rule)
  assert.match(rule[1], /position\s*:\s*relative\s*;/)
  assert.match(rule[1], /min-height\s*:\s*0\s*;/)
})

test("FIXED_GEOMETRY_LAYOUT_SPACE_AND_CSS_TOKENS: fit math uses unscaled layout-space properties only", () => {
  assert.ok(!layoutJs.concat(controllerJs).includes("getBoundingClientRect"))
  assert.ok(layoutJs.includes("offsetParent"))
  assert.ok(controllerJs.includes("clientWidth"))
  assert.ok(tokensSingleSource())
})

test("SHARED_RENDERER_EXPORTS_ART_API: one shared renderer exposes the Art binding and render API", () => {
  assert.ok(rendererJs.includes("analyzeArtList"))
  assert.ok(globalRendererJs.includes("renderArtBlock"))
  assert.ok(globalRendererJs.includes("resolveArtBindings"))
})

test("LIFECYCLE_BATCHED_AND_CLEANED_UP: the fixed-host controller batches passes and cleans up observers", () => {
  for (const fragment of [
    "new ResizeObserver", "new MutationObserver", "requestAnimationFrame", "runDecisionPass",
    "runMeasurementPass", "runFallbackMeasurement", "resizeObserver?.disconnect()",
    "mutationObserver?.disconnect()", "fonts?.ready", 'addEventListener?.("loadingdone"'
  ]) assert.ok(controllerJs.includes(fragment), fragment)
})

test("NO_EXPLICIT_LAYOUT_DSL_OR_DEFERRED_DECORATION: :art takes no arguments and v1 has no layout DSL", () => {
  const artCommands = authoringEntries.filter(entry => entry.trigger === "art")
  assert.equal(artCommands.length, 1)
  assert.equal(artCommands[0].namespace, ":")
  assert.equal(artCommands[0].argument_schema.argument_count, 0)
  assert.equal(artCommands[0].behavior.template, ":::art")
  assert.ok(!authoringEntries.some(entry => entry.namespace === "/" && entry.trigger === "art"))
  assert.doesNotMatch(authoringRegistry, /"(?:art-flow|art-sequence|art-peer|art-snake|art-grid)"/)
  assert.doesNotMatch(artCss + sourceJs, /art-(?:snake|chevron|arrow)/i)
  assert.doesNotMatch(artCss, /::after|<svg|icon/i)
  assert.ok(artCss.includes(".elef-art-list > li:not(:first-child)::before"))
})

test("DOM_ENUMS_AND_STABLE_DIAGNOSTICS: Art DOM state and diagnostics use stable enum codes only", () => {
  const contract = rendererJs + controllerJs + sourceJs
  for (const value of [
    '"peers"', '"sequence"', '"compact"', '"rich"', '"ready"', '"pending"',
    '"fallback-unsupported"', '"fallback-no-fit"', '"error"', '"peers-wrap"',
    '"sequence-horizontal"', '"sequence-vertical"', '"plain-list"', '"true"', '"false"',
    "ART_NO_LIST_TARGET", "ART_INVALID_SYNTAX", "ART_UNSUPPORTED_CONTENT", "ART_NO_FIT",
    "ART_REVEAL_BOUNDARY", "ART_ITEM_TOO_TALL", "ART_INTERNAL_ERROR"
  ]) assert.ok(contract.includes(value), value)
  assert.ok(rendererJs.includes('data-art-diagnostic="${diagnostic}"'))
})

test("FORCED_COLORS_KEEP_ART_BOUNDARIES: Art items and connectors stay visible in forced-colors mode", () => {
  for (const fragment of [
    "@media (forced-colors: active)",
    ".elef-art-list > li { border: 1px solid CanvasText; }",
    '.elef-art[data-art-mode="sequence"] > .elef-art-list > li:not(:first-child)::before { background: CanvasText; }'
  ]) assert.ok(artCss.includes(fragment), fragment)
})
