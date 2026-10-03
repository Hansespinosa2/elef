export async function completeBootstrap({ initialize, waitForEditor, waitForPaint, confirmReady }) {
  await initialize()
  await waitForEditor()
  await waitForPaint()
  await confirmReady()
}
