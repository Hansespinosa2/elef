import { POSITION_VOCABULARY } from "@elef/work-model/document-map"

export interface RegistryEntry {
  id?: unknown;
  namespace?: unknown;
  [key: string]: any;
}

function registryKey(entry: RegistryEntry) {
  return JSON.stringify([entry.namespace || "", String(entry.id)])
}

const LEGACY_DIRECTIVE_TRIGGERS = new Map([
  ["sse", "section"],
  ["sss", "subsection"],
  ["foot", "footnote"]
])

const DIRECTIVE_SCHEMAS = new Map([
  ["align", {
    grammar: ["alignment_or_position", "vertical_position?"],
    argument_count: { minimum: 1, maximum: 2 },
    values: [
      [...POSITION_VOCABULARY.horizontal, ...POSITION_VOCABULARY.vertical],
      [...POSITION_VOCABULARY.vertical]
    ]
  }],
  ["section", { grammar: ["text"], argument_count: 1, values: [] }],
  ["subsection", { grammar: ["text"], argument_count: 1, values: [] }],
  ["footnote", { grammar: ["text"], argument_count: 1, values: [] }]
])

function placeholders(template: unknown) {
  return [...String(template || "").matchAll(/\$\{(\d+)(?::([^}]*))?\}/g)]
    .map(([, position, label = ""]) => ({ position: Number(position), label }))
}

function editorSnippet(entry: RegistryEntry): RegistryEntry {
  if (!entry || typeof entry !== "object" || typeof entry.body !== "string" || typeof entry.trigger !== "string") {
    return entry
  }

  const sourceTrigger = entry.trigger
  const trigger = LEGACY_DIRECTIVE_TRIGGERS.get(sourceTrigger) || sourceTrigger
  const aliases = [...new Set([
    ...(Array.isArray(entry.aliases) ? entry.aliases : []),
    ...(trigger === sourceTrigger ? [] : [sourceTrigger])
  ])]
  const namespace = entry.namespace || (entry.category === "Elef DSL" ? ":" : "/")
  const template = entry.body
  const name = String(entry.name || "")
  const description = String(entry.description || "")

  return {
    ...entry,
    namespace,
    trigger,
    aliases,
    search_terms: [trigger, ...aliases, name, description].filter(Boolean),
    contexts: entry.category === "LaTeX" && !/^\s*\$/.test(template) ? ["math"] : ["source"],
    behavior: {
      type: "insert",
      template,
      placeholders: placeholders(template)
    },
    commit_behavior: "accept_palette_selection",
    documentation_example: `${namespace}${trigger} → ${template}`,
    argument_schema: namespace === ":"
      ? (DIRECTIVE_SCHEMAS.get(trigger) || { grammar: ["free_text"] })
      : null
  }
}

function editorMathShortcut(entry: RegistryEntry): RegistryEntry {
  if (!entry || typeof entry !== "object" || typeof entry.expansion !== "string" || !Array.isArray(entry.aliases)) {
    return entry
  }

  const prefix = String(entry.prefix || "@")
  const aliases = entry.aliases
  const template = entry.expansion
  const name = String(entry.name || "")
  const description = String(entry.description || "")
  const transform = prefix === "."

  return {
    ...entry,
    prefix,
    namespace: entry.namespace || prefix,
    trigger: entry.trigger || aliases[0] || "",
    search_terms: [name, ...aliases, description].filter(Boolean),
    contexts: ["math"],
    commit_behavior: transform
      ? ["space", "tab", "enter", "cursor_leaves_chain", "editor_blur", "save"]
      : "accept_palette_selection",
    documentation_example: `${prefix}${aliases[0] || ""} → ${template}`,
    behavior: {
      type: transform ? "transform" : "insert",
      template,
      placeholders: placeholders(template),
      operator_class: null,
      accepted_operand: transform ? "atomic_math_object" : null,
      serializer: template
    }
  }
}

export function mergeAuthoringRegistryEntries(
  builtInEntries: Iterable<RegistryEntry>,
  snippetEntries: RegistryEntry[] = [],
  mathShortcutEntries: RegistryEntry[] = []
): RegistryEntry[] {
  const entries = new Map<string, RegistryEntry>()
  for (const entry of builtInEntries) {
    if (entry && (typeof entry.id === "string" || typeof entry.id === "number")) {
      entries.set(registryKey(entry), entry)
    }
  }
  const customEntries = [
    ...snippetEntries.map(editorSnippet),
    ...mathShortcutEntries.map(editorMathShortcut)
  ]
  for (const entry of customEntries) {
    if (!entry || entry.built_in === true || (typeof entry.id !== "string" && typeof entry.id !== "number")) continue
    entries.set(registryKey(entry), entry)
  }
  return [...entries.values()]
}
