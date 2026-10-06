export async function vimRelativeLineNumbersWorkflow(ui) {
  await ui.enableVimRelativeLineNumbers()
  await ui.openDeck()
  await ui.assertRelativeLineNumbers()
}
