export async function vimRelativeLineNumbersWorkflow(ui) {
  await ui.openDeck()
  await ui.assertRelativeLineNumbers()
}
