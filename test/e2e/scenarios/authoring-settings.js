import { randomUUID } from "node:crypto"

export async function authoringSettingsWorkflow(ui) {
  const token = randomUUID().replaceAll("-", "").slice(0, 8)
  const snippetTrigger = `shared-${token}`
  const snippetName = `Shared E2E snippet ${token}`
  const editedSnippetName = `${snippetName} edited`
  const mathAlias = `shared${token}`
  const editedMathAlias = `updated${token}`
  const mathName = `Shared E2E shortcut ${token}`

  await ui.openAuthoringSettings()
  await ui.selectAuthoringRegistry("snippets")
  await ui.assertBuiltInAuthoringEntryReadOnly("Bold text")
  await ui.createAuthoringEntry("snippets", {
    name: snippetName,
    trigger: snippetTrigger,
    description: "Created in the shared authoring-settings flow",
    category: "Markdown",
    body: "**${1:shared}**"
  })
  await ui.assertAuthoringEntryVisible(snippetTrigger)

  await ui.closeAuthoringSettings()
  await ui.openDeck("E2E seed")
  await ui.showSourceMode()
  const originalSource = await ui.readSource()
  const prefix = `${originalSource.trimEnd()}\n`
  await ui.replaceSource(`${prefix}/${snippetTrigger}`)
  await ui.waitForAuthoringOption("snippet", snippetName)
  await ui.selectAuthoringOption("snippet", snippetName)
  const expandedSource = `${prefix}**shared**`
  await ui.waitForSource(expandedSource)
  await ui.waitForSaved(expandedSource)
  await ui.replaceSource(originalSource)
  await ui.waitForSaved(originalSource)

  await ui.openAuthoringSettings()
  await ui.selectAuthoringRegistry("snippets")
  await ui.assertAuthoringEntryVisible(snippetTrigger)
  await ui.editAuthoringEntry("snippets", snippetTrigger, {
    name: editedSnippetName,
    trigger: snippetTrigger,
    description: "Edited in the shared authoring-settings flow",
    category: "Markdown",
    body: "**${1:updated}**"
  })
  await ui.assertAuthoringEntryVisible(editedSnippetName)
  await ui.deleteAuthoringEntry("snippets", editedSnippetName)
  await ui.assertAuthoringEntryMissing(snippetTrigger)

  await ui.selectAuthoringRegistry("math_shortcuts")
  await ui.createAuthoringEntry("math_shortcuts", {
    name: mathName,
    aliases: mathAlias,
    description: "Created in the shared authoring-settings flow",
    prefix: "@",
    expansion: "\\mathbb{${1}}"
  })
  await ui.assertAuthoringEntryVisible(mathAlias)

  await ui.closeAuthoringSettings()
  await ui.openAuthoringSettings()
  await ui.selectAuthoringRegistry("math_shortcuts")
  await ui.assertAuthoringEntryVisible(mathAlias)
  await ui.editAuthoringEntry("math_shortcuts", mathName, {
    name: mathName,
    aliases: editedMathAlias,
    description: "Edited in the shared authoring-settings flow",
    prefix: ".",
    expansion: "\\mathcal{${1}}"
  })
  await ui.assertAuthoringEntryVisible(editedMathAlias)
  await ui.deleteAuthoringEntry("math_shortcuts", mathName)
  await ui.assertAuthoringEntryMissing(editedMathAlias)
  await ui.closeAuthoringSettings()
}
