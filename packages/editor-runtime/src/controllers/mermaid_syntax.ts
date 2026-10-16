const FLOWCHART_OPERATORS = ["-.->", "-->>", "---x", "---o", "==>", "--x", "--o", "-->", "---"]
const IDENTIFIER = "[A-Za-z_][A-Za-z0-9_-]*"

export interface DiagramSelection {
  from: number;
  to: number;
}

export interface DiagramTemplate {
  text: string;
  selection: DiagramSelection;
}

// Palette edit shape: a caret move or a ranged replacement with a selection.
export interface MermaidEdit {
  moveTo?: number;
  insert?: string;
  from?: number;
  to?: number;
  selection?: DiagramSelection;
}

export interface SlashDiagramQuery {
  start: number;
  end: number;
  text: string;
  kind: "diagram-command" | "diagram-types";
}

export interface MermaidCompletionMatch {
  text: string;
  label: string;
  detail: string;
}

export interface MermaidCompletion {
  kind: string;
  from: number;
  to: number;
  query: string;
  matches: MermaidCompletionMatch[];
}

interface MermaidFence {
  mermaid: boolean;
  contentFrom: number;
  contentTo: number;
}

interface MermaidLine {
  from: number;
  to: number;
  text: string;
}

interface MermaidContext extends MermaidFence {
  content: string;
  type: string;
  line: MermaidLine;
}

interface FlowNode {
  id: string;
  idFrom: number;
  labelFrom: number;
  labelTo: number;
  nodeTo: number;
}

export const MERMAID_DIAGRAMS = [
  { id: "flowchart", label: "Flowchart / process", detail: "flowchart LR" },
  { id: "sequence", label: "Sequence diagram", detail: "sequenceDiagram" },
  { id: "mindmap", label: "Mind map", detail: "mindmap" },
  { id: "state", label: "State diagram", detail: "stateDiagram-v2" }
]

const DIAGRAM_TEMPLATES = {
  flowchart: {
    text: "```mermaid\nflowchart LR\n    A[]\n```",
    selection: "A[".length + "```mermaid\nflowchart LR\n    ".length
  },
  sequence: {
    text: "```mermaid\nsequenceDiagram\n    participant Alice\n    participant Bob\n    Alice->>Bob: Message\n```",
    selectedText: "Message"
  },
  mindmap: {
    text: "```mermaid\nmindmap\n  root((Central idea))\n```",
    selectedText: "Central idea"
  },
  state: {
    text: "```mermaid\nstateDiagram-v2\n    [*] --> StateA\n```",
    selectedText: "StateA"
  }
}

export function diagramTemplate(id: string): DiagramTemplate | null {
  const template = DIAGRAM_TEMPLATES[id as keyof typeof DIAGRAM_TEMPLATES]
  if (!template) return null

  const selectedText = "selectedText" in template ? template.selectedText : undefined
  if (selectedText) {
    const from = template.text.indexOf(selectedText)
    return { text: template.text, selection: { from, to: from + selectedText.length } }
  }

  const collapsed = template as { text: string; selection: number }
  return { text: collapsed.text, selection: { from: collapsed.selection, to: collapsed.selection } }
}

export function slashDiagramQuery(source: string, caret: number): SlashDiagramQuery | null {
  const line = lineAt(source, caret)
  const before = source.slice(line.from, caret)
  const after = source.slice(caret, line.to)
  const match = before.match(/(?:^|\s)(\/[A-Za-z]*)$/)
  if (!match || after.trim() || markdownFenceAt(source, caret) || insideInlineCode(before)) return null

  const start = line.from + (match.index ?? 0) + match[0].lastIndexOf("/")
  const text = (match[1] ?? "").toLowerCase()
  if (!"/diagram".startsWith(text)) return null

  return { start, end: caret, text, kind: text === "/diagram" ? "diagram-types" : "diagram-command" }
}

export function mermaidCompletion(source: string, caret: number): MermaidCompletion | null {
  const context = mermaidContextAt(source, caret)
  if (!context) return null

  const { line, type } = context
  if (type === "flowchart") {
    const match = line.text.match(new RegExp(`^(\\s*(?:${IDENTIFIER}(?:\\[[^\\]\\n]*\\])?\\s*(?:${FLOWCHART_OPERATORS.map(escapeRegExp).join("|")})\\s*)+)([A-Za-z_][A-Za-z0-9_-]*)?$`))
    if (!match) return null
    const query = match[2] || ""
    const queryStart = line.from + (match[1] ?? "").length
    if (caret !== line.to || queryStart + query.length !== caret) return null

    const nodes = flowchartNodes(context)
    return completionModel("flowchart-node", queryStart, caret, query, nodes)
  }

  if (type === "sequence") {
    const participants = sequenceParticipants(context)
    if (participants.length === 0) return null
    const beforeCaret = line.text.slice(0, caret - line.from)
    const afterCaret = line.text.slice(caret - line.from)
    const partialActor = beforeCaret.match(new RegExp(`^(\\s*)(${IDENTIFIER})$`))
    if (partialActor && caret === line.to) {
      const query = partialActor[2] ?? ""
      return completionModel("sequence-participant", line.from + (partialActor[1] ?? "").length, caret, query, participants)
    }

    const partialTarget = beforeCaret.match(new RegExp(`^(\\s*${IDENTIFIER}\\s*(?:-->>|->>|-->|->|--x|->x|--o|->o)\\s*)(${IDENTIFIER})?$`))
    if (partialTarget && (caret === line.to || /^:\s*/.test(afterCaret))) {
      const query = partialTarget[2] || ""
      return completionModel("sequence-participant", line.from + (partialTarget[1] ?? "").length, caret, query, participants)
    }
  }

  if (type === "state") {
    const match = line.text.match(new RegExp(`^(\\s*.*?(?:-->|->)\\s*)(${IDENTIFIER})?$`))
    if (!match || caret !== line.to) return null
    const query = match[2] || ""
    const states = stateNames(context)
    return completionModel("state-name", line.from + (match[1] ?? "").length, caret, query, states)
  }

  return null
}

export function mermaidEnterEdit(source: string, caret: number): MermaidEdit | null {
  const context = mermaidContextAt(source, caret)
  if (!context) return null

  if (context.type === "flowchart") {
    const flow = parseSimpleFlowLine(context.line.text, context.line.from)
    if (!flow || flow.nodes.length === 0 || flow.operators.some((operator) => operator !== "-->")) return null
    const last = flow.nodes.at(-1)
    if (!last) return null
    if (caret !== context.line.to && caret !== last.labelTo) return null

    const id = nextNodeId(context.content)
    const insert = ` --> ${id}[]`
    const selection = insert.indexOf("[") + 1
    return { from: context.line.to, to: context.line.to, insert, selection: { from: selection, to: selection } }
  }

  if (context.type === "sequence") {
    const message = parseSequenceMessage(context.line.text)
    if (!message || !message.text.trim() || caret !== context.line.to) return null

    const insert = `\n${message.indent}${message.to}->>${message.from}: Message`
    const from = insert.lastIndexOf("Message")
    return { from: context.line.to, to: context.line.to, insert, selection: { from, to: from + "Message".length } }
  }

  return null
}

export function mermaidTabEdit(source: string, caret: number, { shift = false }: { shift?: boolean } = {}): MermaidEdit | null {
  const context = mermaidContextAt(source, caret)
  if (!context || context.type !== "flowchart") return null

  const flow = parseSimpleFlowLine(context.line.text, context.line.from)
  if (!flow || flow.nodes.length === 0 || flow.operators.some((operator) => operator !== "-->")) return null
  const currentIndex = flow.nodes.findIndex((node) => caret >= node.idFrom && caret <= node.nodeTo && (caret === node.labelTo || caret === node.nodeTo || (shift && caret === node.labelFrom)))
  const index = caret === context.line.to ? flow.nodes.length - 1 : currentIndex
  if (index < 0) return null
  const current = flow.nodes[index]
  if (!current) return null

  if (shift) {
    const parent = index > 0 ? flow.nodes[index - 1] : incomingFlowParent(context, current.id, context.line.from)
    if (!parent) return null
    return { moveTo: parent.labelFrom }
  }

  const id = nextNodeId(context.content)
  const indent = (context.line.text.match(/^\s*/)?.[0] ?? "") + "    "
  const insert = `\n${indent}${current.id} --> ${id}[]`
  const selection = insert.indexOf("[") + 1
  return { from: context.line.to, to: context.line.to, insert, selection: { from: selection, to: selection } }
}

function mermaidContextAt(source: string, caret: number): MermaidContext | null {
  const fence = markdownFenceAt(source, caret)
  if (!fence || !fence.mermaid) return null

  const content = source.slice(fence.contentFrom, fence.contentTo)
  const header = content.split("\n").map((line) => line.trim()).find(Boolean) || ""
  const type = diagramType(header)
  if (!type) return null

  const line = lineAt(source, caret)
  return { ...fence, content, type, line }
}

function completionModel(
  kind: string,
  from: number,
  to: number,
  query: string,
  values: Array<{ name: string; detail?: string }>
): MermaidCompletion | null {
  const normalizedQuery = query.toLowerCase()
  const matches = values
    .filter((value) => value.name.toLowerCase().startsWith(normalizedQuery))
    .map((value) => ({ text: value.name, label: value.name, detail: value.detail || "" }))
  if (matches.length === 0) return null
  return { kind, from, to, query, matches }
}

function flowchartNodes(context: MermaidContext): Array<{ name: string; detail: string }> {
  const nodes = new Map<string, { name: string; detail: string }>()
  for (const line of context.content.split("\n")) {
    const flow = parseSimpleFlowLine(line, 0)
    if (!flow) continue
    for (const node of flow.nodes) nodes.set(node.id, { name: node.id, detail: "Flowchart node" })
  }
  return [...nodes.values()]
}

function sequenceParticipants(context: MermaidContext): Array<{ name: string; detail: string }> {
  const names = new Set<string>()
  for (const line of context.content.split("\n")) {
    const declaration = line.match(/^\s*(?:participant|actor)\s+([A-Za-z_][A-Za-z0-9_-]*)\b/)
    if (declaration) names.add(declaration[1] ?? "")
    const message = parseSequenceMessage(line)
    if (message) {
      names.add(message.from)
      names.add(message.to)
    }
  }
  return [...names].map((name) => ({ name, detail: "Sequence participant" }))
}

function stateNames(context: MermaidContext): Array<{ name: string; detail: string }> {
  const names = new Set<string>()
  for (const line of context.content.split("\n")) {
    const transitions = line.matchAll(new RegExp(`\\b(${IDENTIFIER})\\s*(?:-->|->)\\s*(${IDENTIFIER})`, "g"))
    for (const transition of transitions) {
      for (const name of [transition[1] ?? "", transition[2] ?? ""]) {
        if (!/^stateDiagram(?:-v2)?$/i.test(name)) names.add(name)
      }
    }
    const declaration = line.match(/^\s*state\s+"[^"]+"\s+as\s+([A-Za-z_][A-Za-z0-9_-]*)\b/i)
    if (declaration) names.add(declaration[1] ?? "")
  }
  return [...names].map((name) => ({ name, detail: "State" }))
}

function nextNodeId(content: string): string {
  const used = new Set(content.match(/[A-Za-z_][A-Za-z0-9_-]*/g) || [])
  for (let index = 0; index < 10000; index += 1) {
    const candidate = alphabeticId(index)
    if (!used.has(candidate)) return candidate
  }
  return `Node${used.size + 1}`
}

function alphabeticId(index: number): string {
  let value = index + 1
  let id = ""
  while (value > 0) {
    value -= 1
    id = String.fromCharCode(65 + (value % 26)) + id
    value = Math.floor(value / 26)
  }
  return id
}

function leadingWhitespaceLength(text: string): number {
  return text.match(/^\s*/)?.[0]?.length ?? 0
}

function parseSimpleFlowLine(line: string, absoluteStart: number): { nodes: FlowNode[]; operators: string[] } | null {
  const nodes: FlowNode[] = []
  const operators: string[] = []
  let cursor = leadingWhitespaceLength(line)

  const parseNode = () => {
    const match = line.slice(cursor).match(new RegExp(`^(${IDENTIFIER})(?:\\[([^\\]\\n]*)\\])?`))
    if (!match) return false
    const idFrom = cursor
    const hasLabel = match[2] !== undefined
    const labelFrom = cursor + (hasLabel ? (match[1] ?? "").length + 1 : 0)
    const labelTo = cursor + (match[1] ?? "").length + (hasLabel ? 1 + (match[2] ?? "").length : 0)
    nodes.push({
      id: match[1] ?? "",
      idFrom: absoluteStart + idFrom,
      labelFrom: absoluteStart + labelFrom,
      labelTo: absoluteStart + labelTo,
      nodeTo: absoluteStart + cursor + (match[0] ?? "").length
    })
    cursor += (match[0] ?? "").length
    return true
  }

  if (!parseNode()) return null
  while (cursor < line.length) {
    const whitespace = leadingWhitespaceLength(line.slice(cursor))
    cursor += whitespace
    if (cursor === line.length) break
    const operator = FLOWCHART_OPERATORS.find((candidate) => line.startsWith(candidate, cursor))
    if (!operator) return null
    cursor += operator.length
    cursor += leadingWhitespaceLength(line.slice(cursor))
    if (!parseNode()) return null
    operators.push(operator)
  }

  return { nodes, operators }
}

function incomingFlowParent(context: MermaidContext, id: string, beforeOffset: number): FlowNode | null {
  const lines = context.content.split("\n")
  let offset = context.contentFrom
  const candidates: Array<{ parent: FlowNode; target: FlowNode }> = []
  for (const text of lines) {
    const flow = parseSimpleFlowLine(text, offset)
    if (flow) {
      for (let index = 1; index < flow.nodes.length; index += 1) {
        const node = flow.nodes[index]
        const parent = flow.nodes[index - 1]
        if (node && parent && node.id === id && flow.operators[index - 1] === "-->") {
          candidates.push({ parent, target: node })
        }
      }
    }
    offset += text.length + 1
  }
  const candidate = candidates.filter(({ target }) => target.idFrom < beforeOffset).at(-1) || candidates.at(-1)
  return candidate?.parent || null
}

interface SequenceMessage {
  indent: string;
  from: string;
  arrow: string;
  to: string;
  text: string;
}

function parseSequenceMessage(line: string): SequenceMessage | null {
  const match = line.match(new RegExp(`^(\\s*)(${IDENTIFIER})\\s*(-->>|->>|-->|->|--x|->x|--o|->o)\\s*(${IDENTIFIER})\\s*:\\s*(.*?)\\s*$`))
  if (!match) return null
  const [, indent = "", from = "", arrow = "", to = "", text = ""] = match
  return { indent, from, arrow, to, text }
}

function markdownFenceAt(source: string, caret: number): MermaidFence | null {
  const lines = source.split("\n")
  let offset = 0
  let active: { character: string; length: number; mermaid: boolean; start: number; contentFrom: number } | null = null

  for (const text of lines) {
    const lineStart = offset
    const lineEnd = offset + text.length
    const marker = text.match(/^ {0,3}(`{3,}|~{3,})(.*)$/)
    if (marker) {
      const value = marker[1] ?? ""
      const info = (marker[2] ?? "").trim()
      if (!active) {
        active = {
          character: value[0] ?? "",
          length: value.length,
          mermaid: /^mermaid(?:\s|$)/i.test(info),
          start: lineStart,
          contentFrom: lineEnd + (lineEnd < source.length ? 1 : 0)
        }
      } else if (value[0] === active.character && value.length >= active.length && info === "") {
        const closeFrom = lineStart
        if (caret >= active.contentFrom && caret < closeFrom) {
          return { mermaid: active.mermaid, contentFrom: active.contentFrom, contentTo: closeFrom }
        }
        active = null
      }
    }

    offset = lineEnd + 1
  }

  if (active && caret >= active.contentFrom && caret <= source.length) {
    return { mermaid: active.mermaid, contentFrom: active.contentFrom, contentTo: source.length }
  }

  return null
}

function diagramType(header: string): string | null {
  if (/^(?:flowchart|graph)\b/i.test(header)) return "flowchart"
  if (/^sequenceDiagram\b/i.test(header)) return "sequence"
  if (/^mindmap\b/i.test(header)) return "mindmap"
  if (/^stateDiagram(?:-v2)?\b/i.test(header)) return "state"
  return null
}

function lineAt(source: string, caret: number): MermaidLine {
  const from = source.lastIndexOf("\n", Math.max(0, caret) - 1) + 1
  const nextNewline = source.indexOf("\n", caret)
  const to = nextNewline === -1 ? source.length : nextNewline
  return { from, to, text: source.slice(from, to) }
}

function insideInlineCode(text: string): boolean {
  let delimiterLength = 0
  for (let index = 0; index < text.length;) {
    if (text[index] === "\\") {
      index += 2
      continue
    }
    if (text[index] !== "`") {
      index += 1
      continue
    }

    let length = 1
    while (text[index + length] === "`") length += 1
    if (delimiterLength === 0) delimiterLength = length
    else if (delimiterLength === length) delimiterLength = 0
    index += length
  }
  return delimiterLength > 0
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
}
