export async function completeBootstrap({ initialize, waitForPaint, markInteractive = () => {}, waitForEditor, confirmReady }) {
  await initialize()
  await waitForPaint()
  markInteractive()
  await waitForEditor()
  await confirmReady()
}
