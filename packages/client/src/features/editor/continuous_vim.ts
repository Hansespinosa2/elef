import { Vim } from "@replit/codemirror-vim"
import type { EditorView } from "@codemirror/view"

interface Position { line: number; ch: number }
interface LineMotionArgs { forward?: boolean; repeat: number; repeatOffset?: number; toFirstChar?: boolean }
interface MotionState { lastMotion?: unknown; lastHPos?: number; lastHSPos?: number }
interface MotionEditor {
  readonly cm6: EditorView
  firstLine(): number
  lastLine(): number
  getLine(line: number): string
  charCoords(position: Position, mode: string): { left: number }
}
type Motion = (this: MotionDictionary, cm: MotionEditor, head: Position, args: LineMotionArgs, state: MotionState, input: unknown) => Position
interface MotionDictionary {
  moveByLines: Motion
  elefSourceLines: Motion
  moveByDisplayLines: unknown
  moveByScroll: unknown
  moveToColumn: unknown
  moveToEol: unknown
}

let registered = false

// Use the plugin's motion API, not a second key router. Its operators,
// repeat counts, registers and macro recorder still execute normally.
// Built-in moveByLines treats concealed Markdown as folded text and skips
// it; source-line motion in continuous authoring must retain those lines.
export function registerContinuousVimMotions(): void {
  if (registered) return
  registered = true
  const api = Vim as unknown as {
    defineMotion(name: string, motion: Motion): void
    mapCommand(keys: string, type: string, motion: string, args: object, extra: object): void
  }
  api.defineMotion("elefSourceLines", function (cm, head, args, state, input) {
    if (!cm.cm6.dom.classList.contains("continuous-document")) {
      if (state.lastMotion === this.elefSourceLines) state.lastMotion = this.moveByLines
      return this.moveByLines(cm, head, args, state, input)
    }
    const maintainsColumn = [this.elefSourceLines, this.moveByLines, this.moveByDisplayLines,
      this.moveByScroll, this.moveToColumn, this.moveToEol].includes(state.lastMotion)
    let column = maintainsColumn ? state.lastHPos ?? head.ch : head.ch
    if (!maintainsColumn) state.lastHPos = column
    const repeat = args.repeat + (args.repeatOffset ?? 0)
    const requestedLine = head.line + (args.forward ? repeat : -repeat)
    const line = Math.max(cm.firstLine(), Math.min(cm.lastLine(), requestedLine))
    if (requestedLine < cm.firstLine() && head.line === cm.firstLine()) column = 0
    if (requestedLine > cm.lastLine() && head.line === cm.lastLine()) column = cm.getLine(line).length
    if (args.toFirstChar) {
      column = cm.getLine(line).search(/\S/)
      if (column < 0) column = 0
      state.lastHPos = column
    }
    state.lastHSPos = cm.charCoords({ line, ch: column }, "div").left
    return { line, ch: column }
  })
  for (const [key, args] of [
    ["j", { forward: true, linewise: true }],
    ["k", { forward: false, linewise: true }],
    ["+", { forward: true, toFirstChar: true }],
    ["-", { forward: false, toFirstChar: true }],
    ["_", { forward: true, toFirstChar: true, repeatOffset: -1 }],
  ] as const) api.mapCommand(key, "motion", "elefSourceLines", args, {})
}
