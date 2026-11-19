export async function vimRelativeLineNumbersWorkflow(ui) {
  await ui.enableVimRelativeLineNumbers()
  await ui.openWork()
  await ui.showSourceMode()
  await ui.assertRelativeLineNumbers()
}
