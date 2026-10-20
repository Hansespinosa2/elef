// Deterministic generator for the two frozen 100-page visual-editor fixtures.
//
// Usage:
//   node generate.mjs --out <dir> --seed 7 --mixed-units 100 --math-units 100
//
// Emits elef-visual-100-mixed.md, elef-visual-100-math.md and prints a JSON
// stats object (equation/code/table/image/list counts) to stdout. The outputs
// are calibrated to exactly 100 pages under the reference layout by adjusting
// the unit counts, then frozen; see manifest.json.
//
// Content rules (keep the pipeline deterministic and error-free):
// - LF line endings, no trailing whitespace.
// - `$` appears only as math delimiters; prose never contains `$`, `%`, `#`
//   inside math, or bare `<`/`>`.
// - `&` and `\\` appear only inside aligned/matrix/cases environments.
// - Table cells carry only trivial inline math (no pipes, no `\\`).
// - Images use portable `images/*.svg` references (frozen in assets/).
import { mkdirSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import { createRequire } from "node:module"

const require = createRequire(import.meta.url)
const katex = require("katex")

// Every emitted equation must render with the renderer's exact options;
// a frozen fixture with TeX errors would poison pagination benchmarks.
function validateMath(name, source) {
  const noFence = source.replace(/```[\s\S]*?```/g, "")
  const noCode = noFence.replace(/`[^`\r\n]*`/g, "")
  const spans = noCode.match(/\$\$[\s\S]+?\$\$|\$[^$\r\n]+?\$/g) || []
  let checked = 0
  for (const span of spans) {
    const display = span.startsWith("$$")
    const expression = display ? span.slice(2, -2) : span.slice(1, -1)
    try {
      katex.renderToString(expression, { displayMode: display, throwOnError: true, trust: false, strict: "ignore" })
      checked += 1
    } catch (error) {
      process.stderr.write(`KaTeX error in ${name}: ${span.slice(0, 120)} :: ${error.message}\n`)
      process.exitCode = 1
    }
  }
  return checked
}

function mulberry32(seed) {
  let state = seed >>> 0
  return () => {
    state |= 0
    state = (state + 0x6d2b79f5) | 0
    let mixed = Math.imul(state ^ (state >>> 15), 1 | state)
    mixed = (mixed + Math.imul(mixed ^ (mixed >>> 7), 61 | mixed)) ^ mixed
    return ((mixed ^ (mixed >>> 14)) >>> 0) / 4294967296
  }
}

const args = process.argv.slice(2)
const flag = (name, fallback) => {
  const index = args.indexOf(`--${name}`)
  return index === -1 ? fallback : args[index + 1]
}
const SEED = Number(flag("seed", "7"))
const MIXED_UNITS = Number(flag("mixed-units", "100"))
const MATH_UNITS = Number(flag("math-units", "100"))
const OUT = flag("out", ".")

const random = mulberry32(SEED)
const pick = (bank) => bank[Math.floor(random() * bank.length) % bank.length]
const int = (min, max) => min + Math.floor(random() * (max - min + 1))
// Whitelisted placeholders only: TeX groups such as `{2}` must survive.
const fill = (template, values) =>
  template.replace(/\{(n|p|a|b|c|d|e|f|k|topic)\}/g, (_, key) => String(values[key] ?? ""))

const stats = {
  mixed: { units: MIXED_UNITS, inlineEquations: 0, displayEquations: 0, codeBlocks: 0, tables: 0, images: 0, lists: 0, headings: 0, words: 0 },
  math: { units: MATH_UNITS, inlineEquations: 0, displayEquations: 0, codeBlocks: 0, tables: 0, images: 0, lists: 0, headings: 0, words: 0 },
}

// ---------------------------------------------------------------------------
// Shared banks.
// ---------------------------------------------------------------------------

const TOPICS = [
  "caching strategy", "request routing", "schema evolution", "rate limiting",
  "event pipelines", "search ranking", "data retention", "failure budgets",
  "deploy automation", "feature flags", "audit trails", "capacity planning",
  "index design", "queue backpressure", "cache invalidation", "load shedding",
  "schema migrations", "trace sampling", "secret rotation", "backup drills",
  "connection pooling", "idempotency keys", "pagination contracts", "webhook retries",
]

const PROSE = [
  String.raw`The {topic} working group met on day {n} to review the latest measurements. Throughput improved by {p} percent after the team moved hot keys into a dedicated shard and rewrote the retry policy with bounded jitter.`,
  String.raw`Operators watch three signals during rollout: error ratio, tail latency, and queue depth. When any two cross their thresholds for more than {n} minutes, the deploy pauses automatically and pages the owning team with a snapshot.`,
  String.raw`A short design note captured the {topic} trade-offs in one page. Readers appreciated the worked example, which traced a single request from edge cache to primary store and back, annotating every timeout along the path.`,
  String.raw`The postmortem for incident {n} blamed neither people nor tooling. A config value drifted during a routine push, and the canary window was too short to catch the regression before it reached half the fleet.`,
  String.raw`Capacity planners model growth with a simple recurrence plus seasonal terms. The model predicted the holiday peak within {p} percent two quarters in a row, which earned it a permanent seat in planning reviews.`,
  String.raw`Engineers new to {topic} start with the guided tour. It builds a minimal pipeline, breaks it deliberately, then shows how dashboards, traces, and logs converge on the same root cause.`,
  String.raw`The {topic} checklist fits on an index card: confirm the blast radius, announce the window, snapshot state, execute in small batches, and verify with the same queries customers would run.`,
  String.raw`Documentation treats {topic} as a living contract. Each section names its owner, its review date, and the exact command that reproduces the examples, so drift surfaces quickly.`,
]

const LIST_ITEMS = [
  "Confirm the blast radius with staging traffic",
  "Snapshot state before the first mutation",
  "Roll out in batches of at most {p} percent",
  "Verify with customer-shaped queries",
  "Keep the rollback path rehearsed monthly",
  "Record every manual step in the runbook",
  "Page the owner when two signals fire",
  "Freeze deploys during the holiday peak",
]

const CODE_SAMPLES = [
  { language: "ruby", body: "def route(request)\n  shard = Shard.for(request.key, count: {n})\n  policy = RetryPolicy.new(max_attempts: 4, base_ms: {p})\n  policy.run { shard.fetch(request) }\nend" },
  { language: "javascript", body: "async function drain(queue, limit = {n}) {\n  const batch = await queue.take(limit)\n  const results = await Promise.allSettled(batch.map(handle))\n  return summarize(results, { sample: {p} })\n}" },
  { language: "yaml", body: "rollout:\n  batches: {n}\n  pause_minutes: {p}\n  signals:\n    - error_ratio\n    - tail_latency\n    - queue_depth" },
  { language: "sql", body: "SELECT day, approx_p95(latency_ms, {p}) AS tail\nFROM requests\nWHERE day >= CURRENT_DATE - {n}\nGROUP BY day\nORDER BY day;" },
]

const TABLE_ROWS = [
  ["edge cache", "12 ms", "99.1 percent", "warm"],
  ["primary store", "48 ms", "99.9 percent", "steady"],
  ["search index", "96 ms", "98.4 percent", "watch"],
  ["queue worker", "210 ms", "99.5 percent", "steady"],
  ["trace store", "33 ms", "99.0 percent", "warm"],
  ["backup target", "640 ms", "100 percent", "idle"],
]

const INLINE_MATH = [
  String.raw`$E = mc^{2}$`,
  String.raw`$a_{n+1} = a_{n} + d$`,
  String.raw`$P(A \mid B) = \frac{P(B \mid A) P(A)}{P(B)}$`,
  String.raw`$\sigma = \sqrt{\frac{1}{N} \sum_{i=1}^{N} (x_{i} - \mu)^{2}}$`,
  String.raw`$f(x) = x^{2} + {n}x + {p}$`,
  String.raw`$\lVert v \rVert_{2} = \sqrt{v_{1}^{2} + v_{2}^{2}}$`,
  String.raw`$e^{i\pi} + 1 = 0$`,
  String.raw`$T(n) = 2 T\left(\frac{n}{2}\right) + \Theta(n)$`,
]

const DISPLAY_MATH = [
  String.raw`$$\int_{0}^{1} x^{{n}} \, dx = \frac{1}{{n}+1}$$`,
  String.raw`$$\sum_{k=1}^{{n}} k^{2} = \frac{{n}({n}+1)(2{n}+1)}{6}$$`,
  String.raw`$$\lim_{x \to 0} \frac{\sin({p}x)}{x} = {p}$$`,
  String.raw`$$\begin{pmatrix} {a} & {b} \\ {c} & {d} \end{pmatrix} \begin{pmatrix} x \\ y \end{pmatrix} = \begin{pmatrix} {e} \\ {f} \end{pmatrix}$$`,
  String.raw`$$\nabla \cdot \mathbf{F} = \frac{\partial F_{x}}{\partial x} + \frac{\partial F_{y}}{\partial y}$$`,
  String.raw`$$\oint_{C} \mathbf{F} \cdot d\mathbf{r} = \iint_{S} (\nabla \times \mathbf{F}) \cdot d\mathbf{S}$$`,
]

const DERIVATIONS = [
  {
    topic: "quadratic residues",
    lead: String.raw`We count solutions to a congruence by lifting roots from a prime modulus, keeping every step explicit so the count stays exact.`,
    aligned: String.raw`x^{2} &\equiv {a} \pmod{{p}} \\ x &\equiv \pm r \pmod{{p}} \\ N &= 1 + \left(\frac{{a}}{{p}}\right)`,
    matrix: String.raw`\begin{pmatrix} {a} & 1 \\ 0 & {p} \end{pmatrix}`,
    close: String.raw`The Legendre symbol $\left(\frac{{a}}{{p}}\right)$ decides the count, and Hensel lifting carries each root to higher powers without loss.`,
  },
  {
    topic: "coupled oscillators",
    lead: String.raw`Two masses joined by springs exchange energy at the beat frequency. The normal modes diagonalize the motion cleanly.`,
    aligned: String.raw`m \ddot{x}_{1} &= -k x_{1} + \kappa (x_{2} - x_{1}) \\ m \ddot{x}_{2} &= -k x_{2} - \kappa (x_{2} - x_{1}) \\ \omega_{\pm}^{2} &= \frac{{k} \pm \kappa}{m}`,
    matrix: String.raw`\begin{bmatrix} {k}+\kappa & -\kappa \\ -\kappa & {k}+\kappa \end{bmatrix}`,
    close: String.raw`With $\kappa = {k}$ the splitting equals $\Delta \omega \approx \frac{\kappa}{m \omega_{0}}$, visible after roughly $N = {n}$ cycles.`,
  },
  {
    topic: "least squares",
    lead: String.raw`Fitting a line by least squares reduces to one symmetric positive definite system, solved once by Cholesky factorization.`,
    aligned: String.raw`\min_{\beta} \lVert y - X\beta \rVert_{2}^{2} &\Rightarrow X^{T}X\beta = X^{T}y \\ \hat{\beta} &= (X^{T}X)^{-1}X^{T}y \\ \operatorname{Var}(\hat{\beta}) &= \sigma^{2}(X^{T}X)^{-1}`,
    matrix: String.raw`\begin{vmatrix} {a} & {b} \\ {c} & {d} \end{vmatrix} = {a}{d} - {b}{c}`,
    close: String.raw`The residual norm $\lVert r \rVert_{2}^{2}$ with $N = {n}$ degrees of freedom estimates $\sigma^{2}$ without bias.`,
  },
  {
    topic: "Fourier series",
    lead: String.raw`A sawtooth wave expands into odd harmonics with alternating signs. Partial sums overshoot near the jump by a fixed ratio.`,
    aligned: String.raw`f(t) &= \frac{2}{\pi} \sum_{k=1}^{\infty} \frac{(-1)^{k+1}}{k} \sin(k t) \\ S_{N}(t) &= \sum_{k=1}^{N} c_{k} e^{ikt} \\ \lim_{N \to \infty} S_{N}(t) &= \frac{f(t^{+}) + f(t^{-})}{2}`,
    matrix: String.raw`\begin{matrix} c_{-{n}} & \cdots & c_{0} & \cdots & c_{{n}} \end{matrix}`,
    close: String.raw`Gibbs overshoot approaches {p} percent of the jump and never vanishes, no matter how large $N$ grows.`,
  },
  {
    topic: "queueing delay",
    lead: String.raw`An M/M/1 queue with arrival rate below service rate reaches a geometric steady state. Little's law links the means.`,
    aligned: String.raw`\pi_{n} &= (1-\rho)\rho^{n}, \quad \rho = \frac{\lambda}{\mu} \\ L &= \frac{\rho}{1-\rho} \\ W &= \frac{L}{\lambda} = \frac{1}{\mu - \lambda}`,
    matrix: String.raw`\begin{cases} \lambda_{n} = \lambda & n \geq 0 \\ \mu_{n} = \mu & n \geq 1 \end{cases}`,
    close: String.raw`At $\rho = 0.{p}$ the mean wait is $\frac{1}{1-\rho}$ service times, so small headroom buys large latency wins.`,
  },
  {
    topic: "eigenvalue bounds",
    lead: String.raw`Gershgorin discs localize every eigenvalue using only row sums. The proof fits in a few lines and needs no determinants.`,
    aligned: String.raw`|\lambda - a_{ii}| &\leq \sum_{j \neq i} |a_{ij}| \\ \lambda &\in \bigcup_{i=1}^{{n}} D(a_{ii}, R_{i}) \\ \rho(A) &\leq \max_{i} \sum_{j} |a_{ij}|`,
    matrix: String.raw`\begin{pmatrix} {a} & {b} & 0 \\ {c} & {d} & {e} \\ 0 & {f} & {a} \end{pmatrix}`,
    close: String.raw`Strict diagonal dominance with $N = {n}$ rows forces $\det A \neq 0$, which certifies the solver before it runs.`,
  },
]

const NESTED_DISPLAY = [
  String.raw`$$\frac{d}{dx} \left[ \int_{0}^{x^{2}} e^{-{p}t^{2}} \, dt \right] = 2x e^{-{p}x^{4}}$$`,
  String.raw`$$\sum_{n=1}^{\infty} \frac{(-1)^{n+1}}{n^{{p}}} = \left(1 - 2^{1-{p}}\right) \zeta({p})$$`,
  String.raw`$$\det\left(I_{{n}} + uv^{T}\right) = 1 + v^{T}u$$`,
  String.raw`$$\left\| \sum_{k=1}^{{n}} \frac{A^{k}}{k!} - e^{A} \right\| \leq \frac{\lVert A \rVert^{{n}+1}}{({n}+1)!} e^{\lVert A \rVert}$$`,
  String.raw`$$\binom{{n}+{p}}{{n}} = \frac{({n}+{p})!}{{n}! \, {p}!}$$`,
  String.raw`$$\operatorname{erf}(x) = \frac{2}{\sqrt{\pi}} \int_{0}^{x} e^{-t^{2}} \, dt$$`,
]

const IMAGE_ALTS = ["throughput diagram", "latency chart", "topology sketch", "capacity plot"]

// ---------------------------------------------------------------------------
// Builders.
// ---------------------------------------------------------------------------

function values() {
  return {
    n: int(3, 48), p: int(2, 40), a: int(1, 9), b: int(1, 9), c: int(1, 9),
    d: int(1, 9), e: int(1, 9), f: int(1, 9), k: int(2, 12), topic: pick(TOPICS),
  }
}

function mixedUnit(index, bucket) {
  const v = values()
  const lines = []
  lines.push(`## S${index + 1}: ${pick(TOPICS)} notes`)
  bucket.headings += 1
  lines.push("")
  lines.push(fill(pick(PROSE), v))
  lines.push("")
  lines.push(`${fill(pick(PROSE), v)} The model tracks ${fill(pick(INLINE_MATH), v)} across releases.`)
  bucket.inlineEquations += 1
  lines.push("")
  const items = []
  for (let k = 0; k < 4; k += 1) items.push(`- ${fill(pick(LIST_ITEMS), v)}`)
  lines.push(...items)
  bucket.lists += 1
  lines.push("")
  if (index % 2 === 0) {
    const sample = CODE_SAMPLES[index % CODE_SAMPLES.length]
    lines.push(`\`\`\`${sample.language}`)
    lines.push(fill(sample.body, v))
    lines.push("```")
    bucket.codeBlocks += 1
    lines.push("")
  }
  if (index % 3 === 0) {
    lines.push("| Layer | p50 | Availability | State |")
    lines.push("| --- | --- | --- | --- |")
    for (let r = 0; r < 4; r += 1) {
      const row = TABLE_ROWS[(index + r) % TABLE_ROWS.length]
      lines.push(`| ${row[0]} | ${row[1]} | ${row[2]} | ${row[3]} |`)
    }
    bucket.tables += 1
    lines.push("")
  }
  lines.push(fill(pick(DISPLAY_MATH), v))
  bucket.displayEquations += 1
  lines.push("")
  if (index % 4 === 1) {
    const image = (index % 16 >> 2) + 1
    lines.push(`![${IMAGE_ALTS[(index >> 2) % IMAGE_ALTS.length]}](images/perf-${image}.svg)`)
    bucket.images += 1
    lines.push("")
  }
  if (index % 5 === 2) {
    lines.push(`> ${fill(pick(PROSE), v)}`)
    lines.push("")
  }
  if (index % 3 === 1) {
    lines.push(`Read the [runbook for ${pick(TOPICS)}](https://example.com/runbooks/${pick(TOPICS).replace(/ /g, "-")}) before the next window.`)
    lines.push("")
  }
  return lines.join("\n")
}

function mathUnit(index, bucket) {
  const v = values()
  const derivation = DERIVATIONS[index % DERIVATIONS.length]
  const lines = []
  lines.push(`### D${index + 1}: ${derivation.topic}`)
  bucket.headings += 1
  lines.push("")
  lines.push(fill(derivation.lead, v))
  lines.push("")
  lines.push("$$\\begin{aligned}")
  bucket.displayEquations += 1
  lines.push(fill(derivation.aligned, v))
  lines.push("\\end{aligned}$$")
  lines.push("")
  lines.push(`$$${fill(derivation.matrix, v)}$$`)
  bucket.displayEquations += 1
  lines.push("")
  lines.push(fill(derivation.close, v))
  bucket.inlineEquations += (derivation.close.match(/\$/g) || []).length / 2
  lines.push("")
  lines.push(fill(pick(NESTED_DISPLAY), v))
  bucket.displayEquations += 1
  lines.push("")
  lines.push(`A quick check uses ${fill(pick(INLINE_MATH), v)} and ${fill(pick(INLINE_MATH), v)} with $n = ${v.n}$.`)
  bucket.inlineEquations += 3
  lines.push("")
  return lines.join("\n")
}

function build(fixture, title, intro, units, builder) {
  const bucket = stats[fixture]
  const lines = ["---", "theme: light", "typography: modern", "---", `# ${title}`, "", intro, ""]
  bucket.headings += 1
  for (let index = 0; index < units; index += 1) lines.push(builder(index, bucket))
  const source = `${lines.join("\n").replace(/[ \t]+$/gm, "").replace(/\n{3,}/g, "\n\n")}\n`
  bucket.words = source.split(/\s+/).length
  bucket.bytes = Buffer.byteLength(source, "utf8")
  bucket.lines = source.split("\n").length
  return source
}

const mixed = build(
  "mixed",
  "Fixture: mixed technical report",
  "A long mixed report combining prose, lists, tables, code, media, and mathematics for pagination and editing benchmarks.",
  MIXED_UNITS,
  mixedUnit,
)
const math = build(
  "math",
  "Fixture: mathematical derivations",
  "A dense mathematical notebook with matrices, multiline derivations, and nested expressions for rendering benchmarks.",
  MATH_UNITS,
  mathUnit,
)

mkdirSync(OUT, { recursive: true })
writeFileSync(join(OUT, "elef-visual-100-mixed.md"), mixed)
writeFileSync(join(OUT, "elef-visual-100-math.md"), math)
const validated = {
  mixed: validateMath("mixed", mixed),
  math: validateMath("math", math),
}
if (process.exitCode) process.exit(process.exitCode)
process.stdout.write(`${JSON.stringify({ seed: SEED, mixedUnits: MIXED_UNITS, mathUnits: MATH_UNITS, validated, stats }, null, 2)}\n`)
