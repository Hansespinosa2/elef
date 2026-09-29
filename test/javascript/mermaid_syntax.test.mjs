import assert from "node:assert/strict"
import test from "node:test"
import { readFile } from "node:fs/promises"

const source = await readFile(new URL("../../app/javascript/controllers/mermaid_syntax.js", import.meta.url), "utf8")
const mermaid = await import(`data:text/javascript;base64,${Buffer.from(source).toString("base64")}`)

function applyEdit(source, edit) {
  return source.slice(0, edit.from) + edit.insert + source.slice(edit.to)
}

function fenced(body) {
  return `\`\`\`mermaid\n${body}\n\`\`\``
}

test("diagram starters are ordinary fenced Mermaid with useful selections", () => {
  const expectedHeaders = {
    flowchart: "flowchart LR",
    sequence: "sequenceDiagram",
    mindmap: "mindmap",
    state: "stateDiagram-v2"
  }

  for (const diagram of mermaid.MERMAID_DIAGRAMS) {
    const template = mermaid.diagramTemplate(diagram.id)
    assert.ok(template.text.startsWith("```mermaid\n"))
    assert.ok(template.text.endsWith("\n```"))
    assert.ok(template.text.includes(expectedHeaders[diagram.id]))
    assert.equal(template.text.slice(template.selection.from, template.selection.to), diagram.id === "flowchart" ? "" : ({ sequence: "Message", mindmap: "Central idea", state: "StateA" })[diagram.id])
  }
  assert.equal(mermaid.diagramTemplate("unknown"), null)
})

test("/diagram is suggested outside code fences and ignored inside them", () => {
  const text = "A title\n/diag"
  const query = mermaid.slashDiagramQuery(text, text.length)
  assert.deepEqual(query, { start: 8, end: text.length, text: "/diag", kind: "diagram-command" })
  assert.equal(mermaid.slashDiagramQuery(fenced("/diagram"), fenced("/diagram").indexOf("/diagram") + 8), null)

  const inlineCode = "Use `/diagram` in a note"
  assert.equal(mermaid.slashDiagramQuery(inlineCode, inlineCode.indexOf("/diagram") + 8), null)
  const midToken = "Use /diagram afterwards"
  assert.equal(mermaid.slashDiagramQuery(midToken, midToken.indexOf("/diagram") + 4), null)
})

test("flowchart Enter appends a connected node and repeated Enter continues the chain", () => {
  let text = fenced("flowchart LR\n    A[Research]")
  let caret = text.indexOf("A[Research]") + "A[Research]".length
  let edit = mermaid.mermaidEnterEdit(text, caret)
  assert.ok(edit)
  text = applyEdit(text, edit)
  caret = edit.from + edit.selection.from
  assert.equal(text, fenced("flowchart LR\n    A[Research] --> B[]"))
  assert.equal(text.slice(caret - 1, caret + 1), "[]")

  text = text.slice(0, caret) + "Design" + text.slice(caret)
  caret += "Design".length
  edit = mermaid.mermaidEnterEdit(text, caret)
  assert.ok(edit)
  text = applyEdit(text, edit)
  assert.equal(text, fenced("flowchart LR\n    A[Research] --> B[Design] --> C[]"))
  assert.equal(text.slice(edit.from + edit.selection.from - 1, edit.from + edit.selection.from + 1), "[]")
})

test("flowchart IDs skip IDs already present in the diagram", () => {
  const text = fenced("flowchart LR\n    A[Research] --> B[Design]\n    C[Existing]")
  const caret = text.indexOf("B[Design]") + "B[Design]".length
  const edit = mermaid.mermaidEnterEdit(text, caret)
  assert.ok(edit)
  const result = applyEdit(text, edit)
  assert.ok(result.includes("B[Design] --> D[]"))
  assert.equal((result.match(/\bD\b/g) || []).length, 1)
})

test("flowchart Tab creates a child edge and Shift+Tab moves to its parent", () => {
  let text = fenced("flowchart LR\n    A[Research]")
  let caret = text.indexOf("A[Research]") + "A[Research]".length
  let edit = mermaid.mermaidTabEdit(text, caret)
  assert.ok(edit)
  text = applyEdit(text, edit)
  caret = edit.from + edit.selection.from
  assert.ok(text.includes("\n        A --> B[]"))
  assert.equal(text.slice(caret - 1, caret + 1), "[]")

  edit = mermaid.mermaidTabEdit(text, caret)
  assert.ok(edit)
  text = applyEdit(text, edit)
  caret = edit.from + edit.selection.from
  assert.ok(text.includes("\n            B --> C[]"))

  edit = mermaid.mermaidTabEdit(text, caret, { shift: true })
  assert.ok(edit)
  assert.equal(text[edit.moveTo], "B")
  edit = mermaid.mermaidTabEdit(text, edit.moveTo, { shift: true })
  assert.ok(edit)
  assert.equal(text[edit.moveTo], "A")
  assert.equal(mermaid.mermaidTabEdit(text, edit.moveTo, { shift: true }), null)
})

test("sequence Enter uses the existing participants and selects the next message", () => {
  let text = fenced("sequenceDiagram\n    participant Alice\n    participant Bob\n    Alice->>Bob: Request")
  const caret = text.indexOf("Alice->>Bob: Request") + "Alice->>Bob: Request".length
  const edit = mermaid.mermaidEnterEdit(text, caret)
  assert.ok(edit)
  text = applyEdit(text, edit)
  assert.ok(text.includes("\n    Bob->>Alice: Message"))
  assert.equal(text.slice(edit.from + edit.selection.from, edit.from + edit.selection.to), "Message")
})

test("completion suggests flowchart nodes, sequence participants, and existing states", () => {
  const flowchart = fenced("flowchart LR\n    A[Research]\n    A --> ")
  const flowCompletion = mermaid.mermaidCompletion(flowchart, flowchart.length - "```".length - 1)
  assert.ok(flowCompletion?.matches.some((match) => match.text === "A"))

  const sequence = fenced("sequenceDiagram\n    participant Alice\n    participant Bob\n    Alice->>Bo: Message")
  const sequenceCompletion = mermaid.mermaidCompletion(sequence, sequence.indexOf("Alice->>Bo:") + "Alice->>Bo".length)
  assert.ok(sequenceCompletion?.matches.some((match) => match.text === "Bob"))

  const state = fenced("stateDiagram-v2\n    [*] --> Idle\n    Idle --> I")
  const stateCompletion = mermaid.mermaidCompletion(state, state.length - "```".length - 1)
  assert.ok(stateCompletion?.matches.some((match) => match.text === "Idle"))
})

test("ambiguous, middle-of-line, and unsupported contexts fall back without edits", () => {
  const flowchart = fenced("flowchart LR\n    A[Research] --> B[Design]")
  const middle = flowchart.indexOf("Research") + 3
  assert.equal(mermaid.mermaidEnterEdit(flowchart, middle), null)
  assert.equal(mermaid.mermaidTabEdit(flowchart, middle), null)

  const state = fenced("stateDiagram-v2\n    [*] --> Ready")
  assert.equal(mermaid.mermaidEnterEdit(state, state.indexOf("Ready") + 5), null)
  assert.equal(mermaid.mermaidEnterEdit("A paragraph", "A paragraph".length), null)
  assert.equal(mermaid.mermaidEnterEdit(fenced("flowchart LR\n    A(Research)"), fenced("flowchart LR\n    A(Research)").indexOf("A(Research)") + 11), null)
})
