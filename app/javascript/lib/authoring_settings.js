const SNIPPET_CATEGORIES = new Set(["Markdown", "LaTeX", "Mermaid", "Elef DSL"])
const MATH_ALIAS = /^(?:[A-Za-z][A-Za-z0-9_-]*|[0-9]|=)$/

function requiredText(value, field, maxLength) {
  const text = String(value ?? "").trim()
  if (!text || text.length > maxLength) throw new TypeError(`Enter a ${field} of 1–${maxLength} characters.`)
  return text
}

function optionalText(value, field, maxLength) {
  const text = String(value ?? "").trim()
  if (text.length > maxLength) throw new TypeError(`${field} must be at most ${maxLength} characters.`)
  return text
}

function requiredContent(value, field, maxLength) {
  const content = String(value ?? "")
  if (!content.trim() || content.length > maxLength) throw new TypeError(`Enter ${field} with 1–${maxLength} characters.`)
  return content
}

export function buildAuthoringEntry(registry, fields, id) {
  const common = {
    id: requiredText(id, "entry ID", 200),
    name: requiredText(fields.name, "name", 120),
    description: optionalText(fields.description, "description", 500),
    built_in: false
  }

  if (registry === "snippets") {
    const trigger = requiredText(fields.trigger, "trigger", 120)
    if (!/^[a-z0-9][a-z0-9-]*$/.test(trigger)) {
      throw new TypeError("Snippet triggers must use lowercase letters, numbers, and hyphens.")
    }
    const category = requiredText(fields.category, "category", 80)
    if (!SNIPPET_CATEGORIES.has(category)) throw new TypeError("Choose a supported snippet category.")
    return {
      ...common,
      trigger,
      category,
      body: requiredContent(fields.body, "a snippet body", 20_000)
    }
  }

  if (registry === "math_shortcuts") {
    const prefix = String(fields.prefix ?? "")
    if (![".", "@"].includes(prefix)) throw new TypeError("Choose a supported math shortcut prefix.")
    const aliases = [...new Set(String(fields.aliases ?? "").split(/[\s,]+/).map(alias => alias.trim().toLowerCase()).filter(Boolean))]
    if (!aliases.length || aliases.length > 100 || aliases.some(alias => alias.length > 120 || !MATH_ALIAS.test(alias))) {
      throw new TypeError("Enter one or more valid aliases separated by commas.")
    }
    return {
      ...common,
      prefix,
      aliases,
      expansion: requiredContent(fields.expansion, "an expansion", 20_000)
    }
  }

  throw new TypeError("Choose a supported authoring registry.")
}

export function upsertAuthoringEntry(entries, entry) {
  return [...entries.filter(existing => String(existing.id) !== String(entry.id)), entry]
}

export function removeAuthoringEntry(entries, id) {
  return entries.filter(entry => String(entry.id) !== String(id))
}
