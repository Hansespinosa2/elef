import test from "node:test"
import assert from "node:assert/strict"
import { readFile, stat } from "node:fs/promises"

const documentsCss = await readFile(
  new URL("../../app/assets/stylesheets/components/documents.css", import.meta.url),
  "utf8",
)

const LEGACY_STACK = 'KaTeX_Main, KaTeX_AMS, KaTeX_Caligraphic, KaTeX_Script, KaTeX_Fraktur, KaTeX_SansSerif, KaTeX_Typewriter, KaTeX_Size1, "Times New Roman", serif'

test("display large operators resolve through the dedicated subset family", () => {
  // WebKit paints a displaystyle large operator (<mo> under munderover)
  // with the first listed family and never falls back per-glyph there, so
  // KaTeX_Main (which has no large glyphs) blanked every display ∑ ∏ ∫…
  // while the bounds rendered. The subset family must stay first, and only,
  // for display operators; inline math keeps the shared stack.
  const face = documentsCss.match(/@font-face\s*\{[^}]*font-family:\s*"KaTeX_DisplayOps"[^}]*\}/s)
  assert.ok(face, "documents.css must declare the KaTeX_DisplayOps @font-face")
  for (const [file, format] of [
    ["KaTeX_DisplayOps-Regular.woff2", "woff2"],
    ["KaTeX_DisplayOps-Regular.woff", "woff"],
    ["KaTeX_DisplayOps-Regular.ttf", "truetype"],
  ]) {
    assert.ok(
      face[0].includes(`katex/fonts/${file}`) && face[0].includes(`format("${format}")`),
      `DisplayOps @font-face must reference ${file} as ${format}`,
    )
  }

  const rule = documentsCss.match(/math\[display="block"\]\s+mo\s*\{([^}]*)\}/s)
  assert.ok(rule, 'documents.css must scope display operators via math[display="block"] mo')
  const families = rule[1].split(":")[1]
  assert.ok(
    families.trimStart().startsWith('"KaTeX_DisplayOps", KaTeX_Main,'),
    "KaTeX_DisplayOps must lead the display-operator stack so WebKit never consults KaTeX_Main first",
  )
  assert.ok(
    families.includes(LEGACY_STACK),
    "the display-operator stack must keep the shared stack behind DisplayOps unchanged",
  )
})

test("display-operator subset fonts exist and parse as fonts", async () => {
  // Magic bytes pin the container for each format; the subset holds only
  // the operator codepoints (checked when generated), so any truncation or
  // mis-copy fails here instead of painting blank operators in production.
  const magic = { woff2: "774f4632", woff: "774f4646", ttf: "00010000" }
  for (const [format, expected] of Object.entries(magic)) {
    const url = new URL(
      `../../app/assets/stylesheets/katex/fonts/KaTeX_DisplayOps-Regular.${format}`,
      import.meta.url,
    )
    const bytes = await readFile(url)
    const info = await stat(url)
    assert.ok(info.size > 1024, `${format} subset must not be empty`)
    assert.equal(
      Buffer.from(bytes.subarray(0, 4)).toString("hex"),
      expected,
      `${format} subset must carry valid ${format} magic bytes`,
    )
  }
})
