export interface WorkerThemeConfig {
  darkMode: boolean
  background: string
  surface: string
  surfaceAlt: string
  ink: string
  muted: string
  accent: string
  line: string
  fontFamily: string
}

export interface WorkerSliderSpec {
  label: string
  min: number
  max: number
  step: number
  defaultValue: number
  values: number[]
}

export interface WorkerRenderFrame {
  value: number | null
  stdout: string
  figuresSvg: string[]
  dataframeHtml: string | null
}

export interface WorkerExecutionResult {
  ok: boolean
  frames: WorkerRenderFrame[]
  slider: WorkerSliderSpec | null
  error: string | null
}

interface WorkerRunRequest {
  id: number
  type: "run"
  code: string
  theme: WorkerThemeConfig
  runtimeBaseUrl?: string
}

interface PyodideInstance {
  runPythonAsync?: (code: string) => Promise<unknown>
  loadPackagesFromImports?: (code: string) => Promise<unknown>
  globals?: {
    get: (name: string) => unknown
  }
  executeElefPythonBlock?: (code: string, theme: WorkerThemeConfig) => Promise<WorkerExecutionResult> | WorkerExecutionResult
}

const PYODIDE_PREAMBLE = `
import ast
import io
import json
import math
import sys
import traceback
import types

class _ElefSliderLimitError(ValueError):
    pass

def _elef_build_slider_values(min_val, max_val, step_val, default_val):
    min_f = float(min_val)
    max_f = float(max_val)
    step_f = float(step_val)
    if not (math.isfinite(min_f) and math.isfinite(max_f) and math.isfinite(step_f)):
        raise ValueError("elef.slider arguments must be finite numbers")
    if default_val is not None and not math.isfinite(float(default_val)):
        raise ValueError("elef.slider arguments must be finite numbers")
    if step_f <= 0:
        raise ValueError("elef.slider step must be positive")
    if max_f < min_f:
        raise ValueError("elef.slider max must be >= min")
    count = int(math.floor((max_f - min_f) / step_f + 1e-9)) + 1
    if count < 1 or count > 25:
        raise _ElefSliderLimitError("elef.slider supports at most 25 steps in v0")
    is_int = (
        isinstance(min_val, int) and not isinstance(min_val, bool)
        and isinstance(max_val, int) and not isinstance(max_val, bool)
        and isinstance(step_val, int) and not isinstance(step_val, bool)
    )
    values = []
    for i in range(count):
        v = min_f + i * step_f
        values.append(int(round(v)) if is_int else round(v, 8))
    if default_val is None:
        default_out = values[0]
    else:
        default_out = min(values, key=lambda x: abs(x - float(default_val)))
    return values, default_out

def _elef_run_single_frame(code_str, theme, slider_override, record_slider):
    stdout_buf = io.StringIO()
    figures_svg = []
    dataframe_html = [None]
    slider_spec = [None]
    slider_calls = [0]

    elef_mod = types.ModuleType("elef")
    def slider(label="Value", min_val=None, max_val=None, step=1, value=None, **kwargs):
        slider_calls[0] += 1
        if slider_calls[0] > 1:
            raise _ElefSliderLimitError("Only one elef.slider is supported per block in v0")
        if min_val is None:
            min_val = kwargs.pop("min", 0)
        else:
            kwargs.pop("min", None)
        if max_val is None:
            max_val = kwargs.pop("max", 10)
        else:
            kwargs.pop("max", None)
        if kwargs:
            unexpected = next(iter(kwargs.keys()))
            raise TypeError(f"slider() got an unexpected keyword argument '{unexpected}'")
        values, default_val = _elef_build_slider_values(min_val, max_val, step, value)
        if record_slider:
            slider_spec[0] = {
                "label": str(label),
                "min": values[0],
                "max": values[-1],
                "step": step if isinstance(step, (int, float)) else float(step),
                "defaultValue": default_val,
                "values": values,
            }
        return default_val if slider_override is None else slider_override

    elef_mod.slider = slider
    sys.modules["elef"] = elef_mod

    plt = None
    try:
        import matplotlib
        matplotlib.use("Agg")
        import matplotlib.pyplot as _plt
        plt = _plt
        plt.close("all")
        plt.rcParams.update({
            "figure.facecolor": theme.get("surface", "#fcfaf5"),
            "axes.facecolor": theme.get("surface", "#fcfaf5"),
            "axes.edgecolor": theme.get("line", "#d8d0c2"),
            "axes.labelcolor": theme.get("ink", "#252a27"),
            "xtick.color": theme.get("muted", "#68716b"),
            "ytick.color": theme.get("muted", "#68716b"),
            "text.color": theme.get("ink", "#252a27"),
            "grid.color": theme.get("line", "#d8d0c2"),
            "svg.fonttype": "none",
        })
        def _capture_open_figures():
            for num in list(plt.get_fignums()):
                fig = plt.figure(num)
                buf = io.StringIO()
                fig.savefig(buf, format="svg", bbox_inches="tight", facecolor=fig.get_facecolor())
                figures_svg.append(buf.getvalue())
            plt.close("all")
        plt.show = lambda *a, **kw: _capture_open_figures()
    except Exception:
        plt = None

    old_stdout, old_stderr = sys.stdout, sys.stderr
    sys.stdout = stdout_buf
    sys.stderr = stdout_buf
    try:
        tree = ast.parse(code_str, filename="<elef-python>", mode="exec")
         isolated_globals = {"__name__": "__main__"}
        if tree.body and isinstance(tree.body[-1], ast.Expr):
            last_expr = ast.Expression(tree.body[-1].value)
            body_mod = ast.Module(body=tree.body[:-1], type_ignores=[])
            ast.fix_missing_locations(body_mod)
            ast.fix_missing_locations(last_expr)
            exec(compile(body_mod, "<elef-python>", "exec"), isolated_globals)
            last_val = eval(compile(last_expr, "<elef-python>", "eval"), isolated_globals)
            if last_val is not None and hasattr(last_val, "to_html"):
                try:
                    dataframe_html[0] = last_val.to_html(index=True, border=0, classes="dataframe elef-python-dataframe")
                except TypeError:
                    dataframe_html[0] = last_val.to_html()
        else:
            exec(compile(tree, "<elef-python>", "exec"), isolated_globals)
        if plt is not None and len(plt.get_fignums()) > 0:
            for num in list(plt.get_fignums()):
                fig = plt.figure(num)
                buf = io.StringIO()
                fig.savefig(buf, format="svg", bbox_inches="tight", facecolor=fig.get_facecolor())
                figures_svg.append(buf.getvalue())
            plt.close("all")
    finally:
        sys.stdout = old_stdout
        sys.stderr = old_stderr

    return {
        "value": slider_override,
        "stdout": stdout_buf.getvalue(),
        "figuresSvg": figures_svg,
        "dataframeHtml": dataframe_html[0],
    }, slider_spec[0]

def _elef_execute_block(code_str, theme_json):
    theme = json.loads(theme_json)
    try:
        first_frame, slider = _elef_run_single_frame(code_str, theme, None, True)
        if slider is None:
            return json.dumps({
                "ok": True,
                "frames": [first_frame],
                "slider": None,
                "error": None,
            })
        frames = []
        for val in slider["values"]:
            if val == slider["defaultValue"]:
                first_frame["value"] = val
                frames.append(first_frame)
            else:
                frame, _ = _elef_run_single_frame(code_str, theme, val, False)
                frames.append(frame)
        return json.dumps({
            "ok": True,
            "frames": frames,
            "slider": slider,
            "error": None,
        })
    except Exception:
        tb = traceback.format_exc()
        return json.dumps({
            "ok": False,
            "frames": [],
            "slider": None,
            "error": tb,
        })
`.replace("\n isolated_globals =", "\n        isolated_globals =")

class NdArray {
  readonly values: number[]

  constructor(values: number[]) {
    this.values = values
  }

  get length(): number {
    return this.values.length
  }

  get shape(): [number] {
    return [this.values.length]
  }

  toArray(): number[] {
    return [...this.values]
  }

  map(fn: (v: number, i: number) => number): NdArray {
    return new NdArray(this.values.map(fn))
  }

  reshape(): NdArray {
    return this
  }
}

class DataFrameValue {
  readonly columns: string[]
  readonly rows: unknown[][]

  constructor(data: unknown, columns?: string[]) {
    if (Array.isArray(data)) {
      if (data.length > 0 && typeof data[0] === "object" && data[0] !== null && !Array.isArray(data[0])) {
        const keys = columns ?? Object.keys(data[0] as Record<string, unknown>)
        this.columns = keys
        this.rows = data.map((item) => keys.map((key) => (item as Record<string, unknown>)[key] ?? ""))
      } else {
        const width = Array.isArray(data[0]) ? data[0].length : 1
        this.columns = columns ?? Array.from({ length: width }, (_, index) => String(index))
        this.rows = data.map((row) => (Array.isArray(row) ? row : [row]))
      }
    } else if (data && typeof data === "object") {
      const record = data as Record<string, unknown>
      const keys = columns ?? Object.keys(record)
      this.columns = keys
      const columnsData = keys.map((key) => {
        const col = record[key]
        if (col instanceof NdArray) return col.values
        if (Array.isArray(col)) return col
        return [col]
      })
      const rowCount = columnsData.reduce((max, col) => Math.max(max, col.length), 0)
      this.rows = Array.from({ length: rowCount }, (_, rowIndex) =>
        columnsData.map((col) => col[rowIndex] ?? "")
      )
    } else {
      this.columns = columns ?? []
      this.rows = []
    }
  }

  head(count: number = 5): DataFrameValue {
    const sliced = new DataFrameValue([], this.columns)
    ;(sliced as { rows: unknown[][] }).rows = this.rows.slice(0, count)
    return sliced
  }

  tail(count: number = 5): DataFrameValue {
    const sliced = new DataFrameValue([], this.columns)
    ;(sliced as { rows: unknown[][] }).rows = this.rows.slice(-count)
    return sliced
  }

  to_html(): string {
    const escapeHtml = (value: unknown): string =>
      String(value ?? "")
        .replaceAll("&", "&amp;")
        .replaceAll("<", "&lt;")
        .replaceAll(">", "&gt;")
        .replaceAll('"', "&quot;")
    const headerCells = ["<th></th>", ...this.columns.map((col) => `<th>${escapeHtml(col)}</th>`)].join("")
    const bodyRows = this.rows
      .map((row, rowIndex) => {
        const cells = row.map((cell) => `<td>${escapeHtml(typeof cell === "number" && !Number.isInteger(cell) ? Number(cell.toFixed(4)) : cell)}</td>`).join("")
        return `<tr><th>${rowIndex}</th>${cells}</tr>`
      })
      .join("")
    return `<table class="dataframe elef-python-dataframe"><thead><tr style="text-align: right;">${headerCells}</tr></thead><tbody>${bodyRows}</tbody></table>`
  }
}

interface PlotSeries {
  kind: "line" | "bar" | "scatter"
  x: number[]
  y: number[]
  label: string
  color?: string
}

interface FigureState {
  title: string
  xlabel: string
  ylabel: string
  grid: boolean
  series: PlotSeries[]
}

function escapeXml(text: string): string {
  return text
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
}

function renderFigureToSvg(figure: FigureState, theme: WorkerThemeConfig): string {
  const width = 560
  const height = 320
  const padLeft = 58
  const padRight = 26
  const padTop = figure.title ? 42 : 24
  const padBottom = figure.xlabel ? 48 : 34
  const plotW = width - padLeft - padRight
  const plotH = height - padTop - padBottom

  const allX: number[] = []
  const allY: number[] = []
  for (const s of figure.series) {
    allX.push(...s.x)
    allY.push(...s.y)
  }
  let minX = allX.length ? Math.min(...allX) : 0
  let maxX = allX.length ? Math.max(...allX) : 1
  let minY = allY.length ? Math.min(...allY) : 0
  let maxY = allY.length ? Math.max(...allY) : 1
  if (figure.series.some((s) => s.kind === "bar")) {
    minY = Math.min(0, minY)
  }
  if (minX === maxX) {
    minX -= 1
    maxX += 1
  }
  if (minY === maxY) {
    minY -= 1
    maxY += 1
  }

  const mapX = (x: number): number => padLeft + ((x - minX) / (maxX - minX)) * plotW
  const mapY = (y: number): number => padTop + plotH - ((y - minY) / (maxY - minY)) * plotH

  const palette = [
    theme.accent || "#4f8b68",
    "#c97a4b",
    "#5b82a6",
    "#a66886",
    "#829651"
  ]

  const elements: string[] = []
  elements.push(
    `<rect class="elef-python-plot-bg" x="0" y="0" width="${width}" height="${height}" rx="8" fill="${escapeXml(theme.surface)}" stroke="${escapeXml(theme.line)}" stroke-width="1"/>`
  )

  const yTicks = 5
  for (let i = 0; i < yTicks; i += 1) {
    const ratio = i / (yTicks - 1)
    const yVal = minY + ratio * (maxY - minY)
    const py = mapY(yVal)
    if (figure.grid || i === 0 || i === yTicks - 1) {
      elements.push(
        `<line x1="${padLeft}" y1="${py.toFixed(1)}" x2="${padLeft + plotW}" y2="${py.toFixed(1)}" stroke="${escapeXml(theme.line)}" stroke-width="1" stroke-dasharray="${i === 0 ? "none" : "3,3"}" opacity="0.65"/>`
      )
    }
    elements.push(
      `<text x="${padLeft - 8}" y="${(py + 4).toFixed(1)}" text-anchor="end" fill="${escapeXml(theme.muted)}" font-family="${escapeXml(theme.fontFamily)}" font-size="11">${escapeXml(Number(yVal.toFixed(2)).toString())}</text>`
    )
  }

  const xTicks = 5
  for (let i = 0; i < xTicks; i += 1) {
    const ratio = i / (xTicks - 1)
    const xVal = minX + ratio * (maxX - minX)
    const px = mapX(xVal)
    elements.push(
      `<text x="${px.toFixed(1)}" y="${padTop + plotH + 18}" text-anchor="middle" fill="${escapeXml(theme.muted)}" font-family="${escapeXml(theme.fontFamily)}" font-size="11">${escapeXml(Number(xVal.toFixed(2)).toString())}</text>`
    )
  }

  elements.push(
    `<line x1="${padLeft}" y1="${padTop}" x2="${padLeft}" y2="${padTop + plotH}" stroke="${escapeXml(theme.line)}" stroke-width="1.25"/>`,
    `<line x1="${padLeft}" y1="${padTop + plotH}" x2="${padLeft + plotW}" y2="${padTop + plotH}" stroke="${escapeXml(theme.line)}" stroke-width="1.25"/>`
  )

  figure.series.forEach((series, idx) => {
    const color = series.color || palette[idx % palette.length] || "#4f8b68"
    if (series.kind === "line" && series.x.length > 0) {
      const pathData = series.x
        .map((x, i) => {
          const px = mapX(x).toFixed(2)
          const py = mapY(series.y[i] ?? 0).toFixed(2)
          return `${i === 0 ? "M" : "L"} ${px} ${py}`
        })
        .join(" ")
      elements.push(
        `<path class="elef-python-series-line" d="${pathData}" fill="none" stroke="${escapeXml(color)}" stroke-width="2.25" stroke-linecap="round" stroke-linejoin="round"/>`
      )
    } else if (series.kind === "scatter") {
      series.x.forEach((x, i) => {
        const px = mapX(x).toFixed(2)
        const py = mapY(series.y[i] ?? 0).toFixed(2)
        elements.push(
          `<circle class="elef-python-series-point" cx="${px}" cy="${py}" r="4" fill="${escapeXml(color)}" opacity="0.85"/>`
        )
      })
    } else if (series.kind === "bar") {
      const barW = Math.max(6, (plotW / Math.max(series.x.length * 1.6, 2)))
      const zeroY = mapY(Math.max(0, minY))
      series.x.forEach((x, i) => {
        const px = mapX(x) - barW / 2
        const py = mapY(series.y[i] ?? 0)
        const top = Math.min(py, zeroY)
        const barH = Math.max(1, Math.abs(zeroY - py))
        elements.push(
          `<rect class="elef-python-series-bar" x="${px.toFixed(2)}" y="${top.toFixed(2)}" width="${barW.toFixed(2)}" height="${barH.toFixed(2)}" fill="${escapeXml(color)}" rx="2"/>`
        )
      })
    }
  })

  if (figure.title) {
    elements.push(
      `<text class="elef-python-plot-title" x="${width / 2}" y="25" text-anchor="middle" fill="${escapeXml(theme.ink)}" font-family="${escapeXml(theme.fontFamily)}" font-size="14" font-weight="600">${escapeXml(figure.title)}</text>`
    )
  }
  if (figure.xlabel) {
    elements.push(
      `<text class="elef-python-plot-xlabel" x="${padLeft + plotW / 2}" y="${height - 10}" text-anchor="middle" fill="${escapeXml(theme.ink)}" font-family="${escapeXml(theme.fontFamily)}" font-size="12">${escapeXml(figure.xlabel)}</text>`
    )
  }
  if (figure.ylabel) {
    elements.push(
      `<text class="elef-python-plot-ylabel" transform="translate(16 ${(padTop + plotH / 2).toFixed(1)}) rotate(-90)" text-anchor="middle" fill="${escapeXml(theme.ink)}" font-family="${escapeXml(theme.fontFamily)}" font-size="12">${escapeXml(figure.ylabel)}</text>`
    )
  }

  return `<svg xmlns="http://www.w3.org/2000/svg" class="elef-python-svg" viewBox="0 0 ${width} ${height}" width="${width}" height="${height}" role="img" aria-label="${escapeXml(figure.title || "Python figure")}">${elements.join("")}</svg>`
}

function buildSliderSpec(
  label: string,
  minVal: number,
  maxVal: number,
  stepVal: number = 1,
  defaultVal: number | null = null
): WorkerSliderSpec {
  const minF = Number(minVal)
  const maxF = Number(maxVal)
  const stepF = Number(stepVal)
  if (!Number.isFinite(minF) || !Number.isFinite(maxF) || !Number.isFinite(stepF) || stepF <= 0) {
    throw new Error("ValueError: elef.slider step must be positive")
  }
  if (maxF < minF) {
    throw new Error("ValueError: elef.slider max must be >= min")
  }
  const count = Math.floor((maxF - minF) / stepF + 1e-9) + 1
  if (count < 1 || count > 25) {
    throw new Error("ValueError: elef.slider supports at most 25 steps in v0")
  }
  const isInt = Number.isInteger(minF) && Number.isInteger(maxF) && Number.isInteger(stepF)
  const values: number[] = []
  for (let i = 0; i < count; i += 1) {
    const raw = minF + i * stepF
    values.push(isInt ? Math.round(raw) : Number(raw.toFixed(8)))
  }
  let chosenDefault = values[0] ?? minF
  if (defaultVal !== null && defaultVal !== undefined && Number.isFinite(Number(defaultVal))) {
    const target = Number(defaultVal)
    chosenDefault = values.reduce((best, candidate) =>
      Math.abs(candidate - target) < Math.abs(best - target) ? candidate : best
    , chosenDefault)
  }
  return {
    label: String(label),
    min: values[0] ?? minF,
    max: values[values.length - 1] ?? maxF,
    step: stepF,
    defaultValue: chosenDefault,
    values
  }
}

function toNumbers(input: unknown): number[] {
  if (input instanceof NdArray) return input.values
  if (Array.isArray(input)) return input.map((v) => Number(v))
  if (typeof input === "number") return [input]
  return []
}

function applyBinaryOp(op: string, left: unknown, right: unknown): unknown {
  if (left instanceof NdArray || right instanceof NdArray) {
    const lVals = left instanceof NdArray ? left.values : Array.isArray(left) ? left.map(Number) : null
    const rVals = right instanceof NdArray ? right.values : Array.isArray(right) ? right.map(Number) : null
    const len = lVals ? lVals.length : rVals ? rVals.length : 0
    const out: number[] = []
    for (let i = 0; i < len; i += 1) {
      const a = lVals ? (lVals[i] ?? 0) : Number(left)
      const b = rVals ? (rVals[i] ?? 0) : Number(right)
      if (op === "+") out.push(a + b)
      else if (op === "-") out.push(a - b)
      else if (op === "*") out.push(a * b)
      else if (op === "/") out.push(a / b)
      else if (op === "**") out.push(Math.pow(a, b))
    }
    return new NdArray(out)
  }
  if (op === "+") {
    if (typeof left === "string" || typeof right === "string") return String(left) + String(right)
    if (Array.isArray(left) && Array.isArray(right)) return [...left, ...right]
    return Number(left) + Number(right)
  }
  if (op === "-") return Number(left) - Number(right)
  if (op === "*") {
    if (typeof left === "string" && typeof right === "number") return left.repeat(right)
    return Number(left) * Number(right)
  }
  if (op === "/") {
    if (Number(right) === 0) throw new Error("ZeroDivisionError: division by zero")
    return Number(left) / Number(right)
  }
  if (op === "//") {
    if (Number(right) === 0) throw new Error("ZeroDivisionError: integer division or modulo by zero")
    return Math.floor(Number(left) / Number(right))
  }
  if (op === "%") return Number(left) % Number(right)
  if (op === "**") return Math.pow(Number(left), Number(right))
  return 0
}

function splitTopLevel(expr: string, delimiter: string): string[] {
  const parts: string[] = []
  let depth = 0
  let quote: string | null = null
  let current = ""
  for (let i = 0; i < expr.length; i += 1) {
    const ch = expr[i] ?? ""
    if (quote) {
      current += ch
      if (ch === quote && expr[i - 1] !== "\\") quote = null
      continue
    }
    if (ch === "'" || ch === '"') {
      quote = ch
      current += ch
      continue
    }
    if (ch === "(" || ch === "[" || ch === "{") depth += 1
    else if (ch === ")" || ch === "]" || ch === "}") depth = Math.max(0, depth - 1)
    if (depth === 0 && expr.slice(i, i + delimiter.length) === delimiter) {
      parts.push(current)
      current = ""
      i += delimiter.length - 1
      continue
    }
    current += ch
  }
  parts.push(current)
  return parts
}

function findMainBinaryOperator(expr: string, operators: string[]): { index: number; op: string } | null {
  let depth = 0
  let quote: string | null = null
  for (let i = expr.length - 1; i >= 0; i -= 1) {
    const ch = expr[i] ?? ""
    if (quote) {
      if (ch === quote && expr[i - 1] !== "\\") quote = null
      continue
    }
    if (ch === "'" || ch === '"') {
      quote = ch
      continue
    }
    if (ch === ")" || ch === "]" || ch === "}") depth += 1
    else if (ch === "(" || ch === "[" || ch === "{") depth = Math.max(0, depth - 1)
    if (depth !== 0) continue
    for (const op of operators) {
      if (i - op.length + 1 >= 0 && expr.slice(i - op.length + 1, i + 1) === op) {
        const start = i - op.length + 1
        if (op === "*" && (expr[start - 1] === "*" || expr[i + 1] === "*")) continue
        if (op === "/" && (expr[start - 1] === "/" || expr[i + 1] === "/")) continue
        if ((op === "+" || op === "-") && start > 0) {
          const prev = expr.slice(0, start).trimEnd()
          if (!prev || /[+\-*/%(,[=:<>]$/.test(prev)) continue
        } else if ((op === "+" || op === "-") && start === 0) {
          continue
        }
        return { index: start, op }
      }
    }
  }
  return null
}

function createNumpyModule() {
  const unary = (fn: (x: number) => number) => (input: unknown): NdArray | number => {
    if (input instanceof NdArray) return input.map((v) => fn(v))
    if (Array.isArray(input)) return new NdArray(input.map((v) => fn(Number(v))))
    return fn(Number(input))
  }
  return {
    pi: Math.PI,
    e: Math.E,
    array: (items: unknown) => new NdArray(toNumbers(items)),
    linspace: (start: number, stop: number, num: number = 50) => {
      const count = Math.max(1, Math.floor(Number(num)))
      if (count === 1) return new NdArray([Number(start)])
      const step = (Number(stop) - Number(start)) / (count - 1)
      return new NdArray(Array.from({ length: count }, (_, idx) => Number(start) + idx * step))
    },
    arange: (startOrStop: number, stop?: number, step: number = 1) => {
      const start = stop === undefined ? 0 : Number(startOrStop)
      const end = stop === undefined ? Number(startOrStop) : Number(stop)
      const stepVal = Number(step) || 1
      const values: number[] = []
      for (let v = start; stepVal > 0 ? v < end : v > end; v += stepVal) {
        values.push(Number(v.toFixed(8)))
      }
      return new NdArray(values)
    },
    sin: unary(Math.sin),
    cos: unary(Math.cos),
    tan: unary(Math.tan),
    exp: unary(Math.exp),
    log: unary(Math.log),
    sqrt: unary(Math.sqrt),
    abs: unary(Math.abs),
    mean: (input: unknown) => {
      const vals = toNumbers(input)
      return vals.length ? vals.reduce((a, b) => a + b, 0) / vals.length : 0
    },
    sum: (input: unknown) => toNumbers(input).reduce((a, b) => a + b, 0),
    min: (input: unknown) => Math.min(...toNumbers(input)),
    max: (input: unknown) => Math.max(...toNumbers(input))
  }
}

function createSklearnLinearRegression() {
  return class LinearRegression {
    coef_: number[] = [0]
    intercept_: number = 0

    fit(xInput: unknown, yInput: unknown): this {
      const xs = xInput instanceof NdArray
        ? xInput.values
        : Array.isArray(xInput)
          ? xInput.map((item) => (Array.isArray(item) ? Number(item[0]) : Number(item)))
          : [Number(xInput)]
      const ys = toNumbers(yInput)
      const n = Math.min(xs.length, ys.length)
      if (n === 0) return this
      const meanX = xs.slice(0, n).reduce((a, b) => a + b, 0) / n
      const meanY = ys.slice(0, n).reduce((a, b) => a + b, 0) / n
      let num = 0
      let den = 0
      for (let i = 0; i < n; i += 1) {
        const dx = (xs[i] ?? 0) - meanX
        num += dx * ((ys[i] ?? 0) - meanY)
        den += dx * dx
      }
      const slope = den === 0 ? 0 : num / den
      this.coef_ = [slope]
      this.intercept_ = meanY - slope * meanX
      return this
    }

    predict(xInput: unknown): NdArray {
      const xs = xInput instanceof NdArray
        ? xInput.values
        : Array.isArray(xInput)
          ? xInput.map((item) => (Array.isArray(item) ? Number(item[0]) : Number(item)))
          : [Number(xInput)]
      const slope = this.coef_[0] ?? 0
      return new NdArray(xs.map((x) => slope * x + this.intercept_))
    }
  }
}

function executeFallbackSingleFrame(
  code: string,
  theme: WorkerThemeConfig,
  sliderOverride: number | null,
  recordSlider: boolean
): { frame: WorkerRenderFrame; slider: WorkerSliderSpec | null } {
  const stdoutLines: string[] = []
  const figuresSvg: string[] = []
  let dataframeHtml: string | null = null
  let sliderSpec: WorkerSliderSpec | null = null
  let sliderCalls = 0
  let currentFigure: FigureState | null = null

  const ensureFigure = (): FigureState => {
    if (!currentFigure) {
      currentFigure = { title: "", xlabel: "", ylabel: "", grid: false, series: [] }
    }
    return currentFigure
  }

  const flushFigure = (): void => {
    if (currentFigure && (currentFigure.series.length > 0 || currentFigure.title)) {
      figuresSvg.push(renderFigureToSvg(currentFigure, theme))
    }
    currentFigure = null
  }

  const pltModule = {
    figure: () => {
      flushFigure()
      return ensureFigure()
    },
    plot: (xArg: unknown, yArg?: unknown, ...rest: unknown[]) => {
      const fig = ensureFigure()
      const hasY = yArg !== undefined && !(typeof yArg === "string")
      const yVals = hasY ? toNumbers(yArg) : toNumbers(xArg)
      const xVals = hasY ? toNumbers(xArg) : yVals.map((_, idx) => idx)
      const kw = rest.find((item) => item && typeof item === "object" && "__kw__" in (item as Record<string, unknown>)) as { __kw__: Record<string, unknown> } | undefined
      fig.series.push({
        kind: "line",
        x: xVals,
        y: yVals,
        label: String(kw?.__kw__?.label ?? ""),
        ...(typeof kw?.__kw__?.color === "string" ? { color: kw.__kw__.color } : {})
      })
    },
    scatter: (xArg: unknown, yArg: unknown, ...rest: unknown[]) => {
      const fig = ensureFigure()
      const kw = rest.find((item) => item && typeof item === "object" && "__kw__" in (item as Record<string, unknown>)) as { __kw__: Record<string, unknown> } | undefined
      fig.series.push({
        kind: "scatter",
        x: toNumbers(xArg),
        y: toNumbers(yArg),
        label: String(kw?.__kw__?.label ?? ""),
        ...(typeof kw?.__kw__?.color === "string" ? { color: kw.__kw__.color } : {})
      })
    },
    bar: (xArg: unknown, yArg: unknown, ...rest: unknown[]) => {
      const fig = ensureFigure()
      const rawX = Array.isArray(xArg) ? xArg : toNumbers(xArg)
      const xVals = rawX.map((v, idx) => (typeof v === "number" && Number.isFinite(v) ? v : idx))
      const kw = rest.find((item) => item && typeof item === "object" && "__kw__" in (item as Record<string, unknown>)) as { __kw__: Record<string, unknown> } | undefined
      fig.series.push({
        kind: "bar",
        x: xVals,
        y: toNumbers(yArg),
        label: String(kw?.__kw__?.label ?? ""),
        ...(typeof kw?.__kw__?.color === "string" ? { color: kw.__kw__.color } : {})
      })
    },
    title: (text: unknown) => {
      ensureFigure().title = String(text ?? "")
    },
    xlabel: (text: unknown) => {
      ensureFigure().xlabel = String(text ?? "")
    },
    ylabel: (text: unknown) => {
      ensureFigure().ylabel = String(text ?? "")
    },
    grid: (enabled: unknown = true) => {
      ensureFigure().grid = Boolean(enabled)
    },
    legend: () => undefined,
    xlim: () => undefined,
    ylim: () => undefined,
    tight_layout: () => undefined,
    clf: () => {
      currentFigure = null
    },
    close: () => {
      currentFigure = null
    },
    show: () => {
      flushFigure()
    }
  }

  const elefModule = {
    slider: (...args: unknown[]) => {
      sliderCalls += 1
      if (sliderCalls > 1) {
        throw new Error("ValueError: Only one elef.slider is supported per block in v0")
      }
      const positional: unknown[] = []
      let kwLabel: unknown
      let kwMin: unknown
      let kwMax: unknown
      let kwStep: unknown
      let kwValue: unknown
      for (const arg of args) {
        if (arg && typeof arg === "object" && "__kw__" in (arg as Record<string, unknown>)) {
          const kw = (arg as { __kw__: Record<string, unknown> }).__kw__
          for (const key of Object.keys(kw)) {
            if (!["label", "min", "min_val", "max", "max_val", "step", "value"].includes(key)) {
              throw new Error(`TypeError: slider() got an unexpected keyword argument '${key}'`)
            }
          }
          if ("label" in kw) kwLabel = kw.label
          if ("min" in kw) kwMin = kw.min
          if ("min_val" in kw) kwMin = kw.min_val
          if ("max" in kw) kwMax = kw.max
          if ("max_val" in kw) kwMax = kw.max_val
          if ("step" in kw) kwStep = kw.step
          if ("value" in kw) kwValue = kw.value
        } else {
          positional.push(arg)
        }
      }
      const label = String(kwLabel ?? positional[0] ?? "Value")
      const minVal = Number(kwMin ?? positional[1] ?? 0)
      const maxVal = Number(kwMax ?? positional[2] ?? 10)
      const stepVal = Number(kwStep ?? positional[3] ?? 1)
      const defaultVal = kwValue !== undefined ? Number(kwValue) : positional[4] !== undefined ? Number(positional[4]) : null
      const spec = buildSliderSpec(label, minVal, maxVal, stepVal, defaultVal)
      if (recordSlider) sliderSpec = spec
      return sliderOverride === null ? spec.defaultValue : sliderOverride
    }
  }

  const pdModule = {
    DataFrame: (data: unknown, ...rest: unknown[]) => {
      const kw = rest.find((item) => item && typeof item === "object" && "__kw__" in (item as Record<string, unknown>)) as { __kw__: Record<string, unknown> } | undefined
      const columns = Array.isArray(kw?.__kw__?.columns) ? (kw?.__kw__?.columns as unknown[]).map(String) : undefined
      return new DataFrameValue(data, columns)
    }
  }

  const npModule = createNumpyModule()
  const LinearRegression = createSklearnLinearRegression()
  const sklearnModule = {
    linear_model: { LinearRegression },
    LinearRegression
  }

  const scope: Record<string, unknown> = {
    True: true,
    False: false,
    None: null,
    abs: (x: unknown) => Math.abs(Number(x)),
    round: (x: unknown, digits: unknown = 0) => Number(Number(x).toFixed(Number(digits))),
    min: (...args: unknown[]) => {
      const vals = args.length === 1 && (Array.isArray(args[0]) || args[0] instanceof NdArray) ? toNumbers(args[0]) : args.map(Number)
      return Math.min(...vals)
    },
    max: (...args: unknown[]) => {
      const vals = args.length === 1 && (Array.isArray(args[0]) || args[0] instanceof NdArray) ? toNumbers(args[0]) : args.map(Number)
      return Math.max(...vals)
    },
    sum: (items: unknown) => toNumbers(items).reduce((a, b) => a + b, 0),
    len: (items: unknown) => {
      if (items instanceof NdArray) return items.length
      if (items instanceof DataFrameValue) return items.rows.length
      if (Array.isArray(items) || typeof items === "string") return items.length
      return 0
    },
    int: (x: unknown) => Math.trunc(Number(x)),
    float: (x: unknown) => Number(x),
    str: (x: unknown) => String(x ?? ""),
    list: (x: unknown) => (x instanceof NdArray ? x.toArray() : Array.isArray(x) ? [...x] : []),
    range: (a: unknown, b?: unknown, c: unknown = 1) => {
      const start = b === undefined ? 0 : Number(a)
      const stop = b === undefined ? Number(a) : Number(b)
      const step = Number(c) || 1
      const out: number[] = []
      for (let i = start; step > 0 ? i < stop : i > stop; i += step) out.push(i)
      return out
    },
    print: (...args: unknown[]) => {
      const filtered = args.filter((arg) => !(arg && typeof arg === "object" && "__kw__" in (arg as Record<string, unknown>)))
      const formatted = filtered
        .map((item) => {
          if (item instanceof NdArray) return `[${item.values.map((v) => Number(v.toFixed(4))).join(" ")}]`
          if (item instanceof DataFrameValue) return item.to_html()
          if (typeof item === "boolean") return item ? "True" : "False"
          if (item === null || item === undefined) return "None"
          return String(item)
        })
        .join(" ")
      stdoutLines.push(formatted)
    },
    display: (value: unknown) => {
      if (value instanceof DataFrameValue) {
        dataframeHtml = value.to_html()
      }
    }
  }

  const resolveModule = (modName: string): unknown => {
    if (modName === "elef") return elefModule
    if (modName === "numpy") return npModule
    if (modName === "pandas") return pdModule
    if (modName === "matplotlib.pyplot" || modName === "pyplot") return pltModule
    if (modName === "matplotlib") return { pyplot: pltModule, use: () => undefined, rcParams: {} }
    if (modName === "sklearn.linear_model") return sklearnModule.linear_model
    if (modName === "sklearn") return sklearnModule
    if (modName === "math") return Math
    throw new Error(`ModuleNotFoundError: No module named '${modName}'`)
  }

  const evalExpr = (raw: string, localScope: Record<string, unknown>): unknown => {
    const expr = raw.trim()
    if (!expr) return null

    if (expr.startsWith("f\"") || expr.startsWith("f'")) {
      const quote = expr[1] ?? '"'
      if (expr.endsWith(quote)) {
        const body = expr.slice(2, -1)
        return body.replace(/\{([^}]+)\}/g, (_, inner: string) => {
          const [valExpr, fmtSpec] = inner.split(":")
          const val = evalExpr(valExpr ?? "", localScope)
          if (fmtSpec && fmtSpec.endsWith("f")) {
            const decimals = parseInt(fmtSpec.replace(/[^\d]/g, ""), 10)
            if (!Number.isNaN(decimals)) return Number(val).toFixed(decimals)
          }
          return String(val ?? "")
        })
      }
    }

    if ((expr.startsWith('"') && expr.endsWith('"')) || (expr.startsWith("'") && expr.endsWith("'"))) {
      const quote = expr[0]
      const inner = expr.slice(1, -1)
      if (!inner.includes(quote ?? '"')) {
        return inner.replaceAll("\\n", "\n").replaceAll("\\t", "\t")
      }
    }

    if (/^-?\d+(?:\.\d+)?(?:e[+-]?\d+)?$/i.test(expr)) {
      return Number(expr)
    }

    if (expr.startsWith("(") && expr.endsWith(")")) {
      const inner = expr.slice(1, -1)
      const topParts = splitTopLevel(inner, ",")
      if (topParts.length === 1 && splitTopLevel(expr, "(").length === 2) {
        return evalExpr(inner, localScope)
      }
      if (topParts.length > 1 && splitTopLevel(expr, "(").length === 2) {
        return topParts.filter((p) => p.trim() !== "").map((p) => evalExpr(p, localScope))
      }
    }

    if (expr.startsWith("[") && expr.endsWith("]")) {
      const inner = expr.slice(1, -1).trim()
      if (!inner) return []
      const compMatch = /^(.+?)\s+for\s+([A-Za-z_]\w*)\s+in\s+(.+)$/.exec(inner)
      if (compMatch) {
        const [, itemExpr = "", varName = "", iterExpr = ""] = compMatch
        const iterable = evalExpr(iterExpr, localScope)
        const listItems = iterable instanceof NdArray ? iterable.values : Array.isArray(iterable) ? iterable : []
        return listItems.map((item) => evalExpr(itemExpr, { ...localScope, [varName]: item }))
      }
      return splitTopLevel(inner, ",")
        .filter((part) => part.trim() !== "")
        .map((part) => evalExpr(part, localScope))
    }

    if (expr.startsWith("{") && expr.endsWith("}")) {
      const inner = expr.slice(1, -1).trim()
      if (!inner) return {}
      const out: Record<string, unknown> = {}
      for (const entry of splitTopLevel(inner, ",")) {
        if (!entry.trim()) continue
        const colonIdx = entry.indexOf(":")
        if (colonIdx < 0) continue
        const k = String(evalExpr(entry.slice(0, colonIdx), localScope))
        const v = evalExpr(entry.slice(colonIdx + 1), localScope)
        out[k] = v
      }
      return out
    }

    const cmpOp = findMainBinaryOperator(expr, ["==", "!=", "<=", ">=", "<", ">"])
    if (cmpOp) {
      const l = evalExpr(expr.slice(0, cmpOp.index), localScope)
      const r = evalExpr(expr.slice(cmpOp.index + cmpOp.op.length), localScope)
      if (cmpOp.op === "==") return l === r
      if (cmpOp.op === "!=") return l !== r
      if (cmpOp.op === "<=") return Number(l) <= Number(r)
      if (cmpOp.op === ">=") return Number(l) >= Number(r)
      if (cmpOp.op === "<") return Number(l) < Number(r)
      if (cmpOp.op === ">") return Number(l) > Number(r)
    }

    const addOp = findMainBinaryOperator(expr, ["+", "-"])
    if (addOp) {
      const l = evalExpr(expr.slice(0, addOp.index), localScope)
      const r = evalExpr(expr.slice(addOp.index + addOp.op.length), localScope)
      return applyBinaryOp(addOp.op, l, r)
    }

    const mulOp = findMainBinaryOperator(expr, ["//", "*", "/", "%"])
    if (mulOp) {
      const l = evalExpr(expr.slice(0, mulOp.index), localScope)
      const r = evalExpr(expr.slice(mulOp.index + mulOp.op.length), localScope)
      return applyBinaryOp(mulOp.op, l, r)
    }

    const powOp = findMainBinaryOperator(expr, ["**"])
    if (powOp) {
      const l = evalExpr(expr.slice(0, powOp.index), localScope)
      const r = evalExpr(expr.slice(powOp.index + powOp.op.length), localScope)
      return applyBinaryOp("**", l, r)
    }

    if (expr.startsWith("-")) {
      const val = evalExpr(expr.slice(1), localScope)
      return applyBinaryOp("*", -1, val)
    }

    const callMatch = /^(.+?)\(([\s\S]*)\)$/.exec(expr)
    if (callMatch) {
      const calleeStr = (callMatch[1] ?? "").trim()
      const argsStr = (callMatch[2] ?? "").trim()
      if (splitTopLevel(calleeStr, "(").length === 1) {
        const rawArgs = argsStr ? splitTopLevel(argsStr, ",") : []
        const evaluatedArgs: unknown[] = []
        const kwargs: Record<string, unknown> = {}
        let hasKw = false
        for (const rawArg of rawArgs) {
          const trimmedArg = rawArg.trim()
          if (!trimmedArg) continue
          const kwMatch = /^([A-Za-z_]\w*)\s*=\s*([\s\S]+)$/.exec(trimmedArg)
          if (kwMatch && !trimmedArg.includes("==")) {
            hasKw = true
            kwargs[kwMatch[1] ?? ""] = evalExpr(kwMatch[2] ?? "", localScope)
          } else {
            evaluatedArgs.push(evalExpr(trimmedArg, localScope))
          }
        }
        if (hasKw) evaluatedArgs.push({ __kw__: kwargs })

        const dotParts = splitTopLevel(calleeStr, ".")
        if (dotParts.length > 1) {
          const methodName = (dotParts.pop() ?? "").trim()
          const receiver = evalExpr(dotParts.join("."), localScope) as Record<string, unknown> | null | undefined
          if (!receiver || (typeof receiver !== "object" && typeof receiver !== "function")) {
            throw new Error(`AttributeError: '${String(receiver)}' object has no attribute '${methodName}'`)
          }
          const fn = (receiver as Record<string, unknown>)[methodName]
          if (typeof fn !== "function") {
            throw new Error(`AttributeError: object has no callable attribute '${methodName}'`)
          }
          if (fn.prototype && methodName[0] === methodName[0]?.toUpperCase()) {
            const Ctor = fn as new (...a: unknown[]) => unknown
            return new Ctor(...evaluatedArgs)
          }
          return (fn as (...a: unknown[]) => unknown).apply(receiver, evaluatedArgs)
        }

        const fn = evalExpr(calleeStr, localScope)
        if (typeof fn !== "function") {
          throw new Error(`TypeError: '${calleeStr}' is not callable`)
        }
        if (fn.prototype && calleeStr[0] === calleeStr[0]?.toUpperCase()) {
          const Ctor = fn as new (...a: unknown[]) => unknown
          return new Ctor(...evaluatedArgs)
        }
        return (fn as (...a: unknown[]) => unknown)(...evaluatedArgs)
      }
    }

    const indexMatch = /^([A-Za-z_][\w.]*)\[(.+)\]$/.exec(expr)
    if (indexMatch) {
      const target = evalExpr(indexMatch[1] ?? "", localScope)
      const key = evalExpr(indexMatch[2] ?? "", localScope)
      if (target instanceof NdArray) return target.values[Number(key)]
      if (Array.isArray(target)) return target[Number(key)]
      if (target && typeof target === "object") return (target as Record<string, unknown>)[String(key)]
      return undefined
    }

    const dotParts = splitTopLevel(expr, ".")
    if (dotParts.length > 1) {
      let current: unknown = evalExpr(dotParts[0] ?? "", localScope)
      for (let i = 1; i < dotParts.length; i += 1) {
        const prop = (dotParts[i] ?? "").trim()
        if (current && (typeof current === "object" || typeof current === "function") && prop in (current as Record<string, unknown>)) {
          current = (current as Record<string, unknown>)[prop]
        } else {
          throw new Error(`AttributeError: object has no attribute '${prop}'`)
        }
      }
      return current
    }

    if (/^[A-Za-z_]\w*$/.test(expr)) {
      if (expr in localScope) return localScope[expr]
      if (expr in scope) return scope[expr]
      throw new Error(`NameError: name '${expr}' is not defined`)
    }

    throw new Error(`SyntaxError: invalid syntax in '${expr}'`)
  }

  const rawLines = code.replace(/\r\n/g, "\n").split("\n")
  const statements: Array<{ indent: number; text: string; lineNo: number }> = []
  let openBuffer = ""
  let openIndent = 0
  let openLineNo = 1
  let bracketBalance = 0

  for (let idx = 0; idx < rawLines.length; idx += 1) {
    const rawLine = rawLines[idx] ?? ""
    const strippedComment = rawLine.replace(/#.*$/, "")
    if (!strippedComment.trim() && bracketBalance === 0) continue
    if (bracketBalance === 0) {
      openIndent = ( rawLine.match(/^\s*/)?.[0] ?? "" ).length
      openLineNo = idx + 1
      openBuffer = strippedComment.trim()
    } else {
      openBuffer += " " + strippedComment.trim()
    }
    for (const ch of strippedComment) {
      if (ch === "(" || ch === "[" || ch === "{") bracketBalance += 1
      else if (ch === ")" || ch === "]" || ch === "}") bracketBalance = Math.max(0, bracketBalance - 1)
    }
    if (bracketBalance === 0 && openBuffer) {
      statements.push({ indent: openIndent, text: openBuffer, lineNo: openLineNo })
      openBuffer = ""
    }
  }
  if (bracketBalance !== 0) {
    throw new Error(`SyntaxError: '(' was never closed (line ${openLineNo})`)
  }

  let lastExprValue: unknown = null

  const runBlock = (startIdx: number, baseIndent: number, localScope: Record<string, unknown>): number => {
    let i = startIdx
    while (i < statements.length) {
      const stmt = statements[i]
      if (!stmt || stmt.indent < baseIndent) break
      const line = stmt.text
      lastExprValue = null

      if (/^while\s+(.+):$/.test(line)) {
        const condExpr = /^while\s+(.+):$/.exec(line)?.[1] ?? "False"
        const bodyStart = i + 1
        const bodyIndent = statements[bodyStart]?.indent ?? baseIndent + 2
        while (evalExpr(condExpr, localScope)) {
          runBlock(bodyStart, bodyIndent, localScope)
        }
        i = bodyStart
        while (i < statements.length && (statements[i]?.indent ?? 0) >= bodyIndent) i += 1
        continue
      }

      const whileInlineMatch = /^while\s+([^:]+):\s*(.+)$/.exec(line)
      if (whileInlineMatch) {
        const condExpr = whileInlineMatch[1] ?? "False"
        while (evalExpr(condExpr, localScope)) {
          // intentional spin when condition stays truthy (e.g. while True: pass)
        }
        i += 1
        continue
      }

      const forMatch = /^for\s+([A-Za-z_]\w*)\s+in\s+(.+):$/.exec(line)
      if (forMatch) {
        const varName = forMatch[1] ?? "_"
        const iterVal = evalExpr(forMatch[2] ?? "[]", localScope)
        const items = iterVal instanceof NdArray ? iterVal.values : Array.isArray(iterVal) ? iterVal : []
        const bodyStart = i + 1
        const bodyIndent = statements[bodyStart]?.indent ?? baseIndent + 2
        for (const item of items) {
          localScope[varName] = item
          runBlock(bodyStart, bodyIndent, localScope)
        }
        i = bodyStart
        while (i < statements.length && (statements[i]?.indent ?? 0) >= bodyIndent) i += 1
        continue
      }

      const ifMatch = /^if\s+(.+):$/.exec(line)
      if (ifMatch) {
        const cond = Boolean(evalExpr(ifMatch[1] ?? "False", localScope))
        const bodyStart = i + 1
        const bodyIndent = statements[bodyStart]?.indent ?? baseIndent + 2
        let nextIdx = bodyStart
        while (nextIdx < statements.length && (statements[nextIdx]?.indent ?? 0) >= bodyIndent) nextIdx += 1
        if (cond) {
          runBlock(bodyStart, bodyIndent, localScope)
        }
        i = nextIdx
        if (i < statements.length && statements[i]?.indent === baseIndent && statements[i]?.text === "else:") {
          const elseStart = i + 1
          const elseIndent = statements[elseStart]?.indent ?? baseIndent + 2
          let afterElse = elseStart
          while (afterElse < statements.length && (statements[afterElse]?.indent ?? 0) >= elseIndent) afterElse += 1
          if (!cond) {
            runBlock(elseStart, elseIndent, localScope)
          }
          i = afterElse
        }
        continue
      }

      const defMatch = /^def\s+([A-Za-z_]\w*)\(([^)]*)\):$/.exec(line)
      if (defMatch) {
        const fnName = defMatch[1] ?? "fn"
        const paramNames = (defMatch[2] ?? "")
          .split(",")
          .map((p) => p.trim())
          .filter(Boolean)
        const bodyStart = i + 1
        const bodyIndent = statements[bodyStart]?.indent ?? baseIndent + 2
        let nextIdx = bodyStart
        while (nextIdx < statements.length && (statements[nextIdx]?.indent ?? 0) >= bodyIndent) nextIdx += 1
        const bodyEnd = nextIdx
        localScope[fnName] = (...callArgs: unknown[]) => {
          const fnScope: Record<string, unknown> = { ...localScope }
          paramNames.forEach((param, pIdx) => {
            fnScope[param] = callArgs[pIdx]
          })
          for (let b = bodyStart; b < bodyEnd; b += 1) {
            const bLine = statements[b]?.text ?? ""
            if (bLine.startsWith("return ")) {
              return evalExpr(bLine.slice("return ".length), fnScope)
            }
            const assign = /^([A-Za-z_]\w*)\s*=\s*([\s\S]+)$/.exec(bLine)
            if (assign) {
              fnScope[assign[1] ?? ""] = evalExpr(assign[2] ?? "", fnScope)
            } else {
              evalExpr(bLine, fnScope)
            }
          }
          return null
        }
        i = bodyEnd
        continue
      }

      if (line === "pass") {
        i += 1
        continue
      }

      if (line.startsWith("raise ")) {
        const errExpr = line.slice("raise ".length).trim()
        const errMatch = /^([A-Za-z_]\w*)\((.*)\)$/.exec(errExpr)
        if (errMatch) {
          const errType = errMatch[1] ?? "Exception"
          const msg = errMatch[2] ? String(evalExpr(errMatch[2], localScope)) : ""
          throw new Error(`${errType}: ${msg}`)
        }
        throw new Error(errExpr)
      }

      const importAsMatch = /^import\s+([\w.]+)(?:\s+as\s+([A-Za-z_]\w*))?$/.exec(line)
      if (importAsMatch) {
        const modName = importAsMatch[1] ?? ""
        const alias = importAsMatch[2] ?? modName.split(".")[0] ?? modName
        localScope[alias] = resolveModule(modName)
        i += 1
        continue
      }

      const fromImportMatch = /^from\s+([\w.]+)\s+import\s+(.+)$/.exec(line)
      if (fromImportMatch) {
        const modName = fromImportMatch[1] ?? ""
        const modObj = resolveModule(modName) as Record<string, unknown>
        const targets = (fromImportMatch[2] ?? "").split(",").map((s) => s.trim()).filter(Boolean)
        for (const t of targets) {
          const parts = t.split(/\s+as\s+/)
          const orig = (parts[0] ?? "").trim()
          const alias = (parts[1] ?? orig).trim()
          localScope[alias] = modObj?.[orig]
        }
        i += 1
        continue
      }

      const augAssign = /^([A-Za-z_]\w*)\s*(\+=|-=|\*=|\/=)\s*([\s\S]+)$/.exec(line)
      if (augAssign) {
        const varName = augAssign[1] ?? ""
        const op = (augAssign[2] ?? "+=").slice(0, 1)
        const rhs = evalExpr(augAssign[3] ?? "0", localScope)
        const currentVal = evalExpr(varName, localScope)
        localScope[varName] = applyBinaryOp(op, currentVal, rhs)
        i += 1
        continue
      }

      const tupleAssign = /^([A-Za-z_]\w*(?:\s*,\s*[A-Za-z_]\w*)+)\s*=\s*([\s\S]+)$/.exec(line)
      if (tupleAssign && !line.includes("==")) {
        const names = (tupleAssign[1] ?? "").split(",").map((n) => n.trim())
        const rhs = evalExpr(tupleAssign[2] ?? "", localScope)
        const values = rhs instanceof NdArray ? rhs.values : Array.isArray(rhs) ? rhs : [rhs]
        names.forEach((name, idx) => {
          localScope[name] = values[idx]
        })
        i += 1
        continue
      }

      const assignMatch = /^([A-Za-z_]\w*)\s*=\s*([\s\S]+)$/.exec(line)
      if (assignMatch && !line.startsWith("if ") && !line.includes("==")) {
        const varName = assignMatch[1] ?? ""
        const rhs = assignMatch[2] ?? ""
        localScope[varName] = evalExpr(rhs, localScope)
        i += 1
        continue
      }

      lastExprValue = evalExpr(line, localScope)
      i += 1
    }
    return i
  }

  runBlock(0, 0, scope)
  flushFigure()

  if (lastExprValue instanceof DataFrameValue) {
    dataframeHtml = lastExprValue.to_html()
  }

  return {
    frame: {
      value: sliderOverride,
      stdout: stdoutLines.length ? `${stdoutLines.join("\n")}\n` : "",
      figuresSvg,
      dataframeHtml
    },
    slider: sliderSpec
  }
}

export function executePythonWithBuiltInEngine(code: string, theme: WorkerThemeConfig): WorkerExecutionResult {
  try {
    const first = executeFallbackSingleFrame(code, theme, null, true)
    if (!first.slider) {
      return {
        ok: true,
        frames: [first.frame],
        slider: null,
        error: null
      }
    }
    const frames: WorkerRenderFrame[] = []
    for (const val of first.slider.values) {
      if (val === first.slider.defaultValue) {
        first.frame.value = val
        frames.push(first.frame)
      } else {
        const next = executeFallbackSingleFrame(code, theme, val, false)
        frames.push(next.frame)
      }
    }
    return {
      ok: true,
      frames,
      slider: first.slider,
      error: null
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    return {
      ok: false,
      frames: [],
      slider: null,
      error: `Traceback (most recent call last):\n  File "<elef-python>", line 1, in <module>\n${message}`
    }
  }
}

;(globalThis as Record<string, unknown>).__elefBuiltInPythonEngine = executePythonWithBuiltInEngine

let pyodidePromise: Promise<PyodideInstance> | null = null
let activeRuntimeBase = ""

async function getPyodide(runtimeBaseUrl: string): Promise<PyodideInstance> {
  const normalizedBase = (runtimeBaseUrl || "/python-runtime/").endsWith("/")
    ? runtimeBaseUrl || "/python-runtime/"
    : `${runtimeBaseUrl}/`
  if (pyodidePromise && activeRuntimeBase === normalizedBase) return pyodidePromise
  activeRuntimeBase = normalizedBase
  pyodidePromise = (async () => {
    try {
      const baseHref = typeof self !== "undefined" && self.location ? self.location.href : "http://127.0.0.1/"
      const resolvedBase = new URL(normalizedBase, baseHref).href
      if (typeof fetch === "function") {
        await fetch(`${resolvedBase}runtime-manifest.json`).catch(() => null)
      }
      const moduleUrl = `${resolvedBase}pyodide.mjs`
      const mod = (await import(moduleUrl)) as {
        loadPyodide?: (options: { indexURL: string }) => Promise<PyodideInstance>
      }
      if (typeof mod.loadPyodide === "function") {
        const instance = await mod.loadPyodide({ indexURL: resolvedBase })
        if (typeof instance.runPythonAsync === "function" && !instance.executeElefPythonBlock) {
          await instance.runPythonAsync(PYODIDE_PREAMBLE)
        }
        return instance
      }
    } catch {
      // Fall back to the deterministic built-in engine when offline or when external WASM assets are absent.
    }
    return {
      executeElefPythonBlock: (code: string, theme: WorkerThemeConfig) =>
        executePythonWithBuiltInEngine(code, theme)
    }
  })()
  return pyodidePromise
}

export async function runPythonWorkerRequest(
  code: string,
  theme: WorkerThemeConfig,
  runtimeBaseUrl: string = "/python-runtime/"
): Promise<WorkerExecutionResult> {
  const pyodide = await getPyodide(runtimeBaseUrl)
  if (typeof pyodide.executeElefPythonBlock === "function") {
    return await pyodide.executeElefPythonBlock(code, theme)
  }
  if (typeof pyodide.runPythonAsync === "function" && pyodide.globals) {
    if (typeof pyodide.loadPackagesFromImports === "function") {
      try {
        await pyodide.loadPackagesFromImports(code)
      } catch {
        // Ignore package auto-load errors; missing modules raise normal ModuleNotFoundError during execution.
      }
    }
    const runner = pyodide.globals.get("_elef_execute_block") as ((c: string, t: string) => string) | undefined
    if (typeof runner === "function") {
      const rawJson = runner(code, JSON.stringify(theme))
      return JSON.parse(String(rawJson)) as WorkerExecutionResult
    }
  }
  return executePythonWithBuiltInEngine(code, theme)
}

if (typeof self !== "undefined" && typeof self.addEventListener === "function" && typeof document === "undefined") {
  self.addEventListener("message", async (event: MessageEvent<WorkerRunRequest>) => {
    const data = event.data
    if (!data || data.type !== "run") return
    try {
      const result = await runPythonWorkerRequest(data.code, data.theme, data.runtimeBaseUrl)
      self.postMessage({ id: data.id, result })
    } catch (error) {
      self.postMessage({
        id: data.id,
        result: {
          ok: false,
          frames: [],
          slider: null,
          error: error instanceof Error ? error.message : String(error)
        }
      })
    }
  })
}
