import assert from "node:assert/strict"

export const PYTHON_PARITY_SOURCE = `# Python runtime parity

\`\`\`python run
import matplotlib.pyplot as plt
import pandas as pd
from sklearn.linear_model import LinearRegression
import elef

slope = elef.slider("Slope", min=1, max=3, step=1, value=2)
plt.plot([0, 1, 2], [0, slope, slope * 2])
plt.title(f"Slope {slope}")
plt.show()
df = pd.DataFrame({"x": [0, 1], "y": [0, slope]})
print(f"slope={slope}")
df
\`\`\`

---

# Show code parity

\`\`\`python run show-code
print("visible source")
\`\`\`
`

export async function pythonRenderingWorkflow(ui) {
  await ui.openWork()
  const originalSource = await ui.readSource()

  try {
    await ui.replaceSource(PYTHON_PARITY_SOURCE)
    await ui.waitForSaved(PYTHON_PARITY_SOURCE)
    await ui.refreshPreview()
    await ui.showVisualMode()
    await ui.waitForPythonBlocks(2)

    const initialBlocks = await ui.readPythonBlockSemantics()
    assert.equal(initialBlocks.length, 2)
    assert.equal(initialBlocks[0].mode, "run")
    assert.equal(initialBlocks[0].processed, "true")
    assert.equal(initialBlocks[0].hasCode, false)
    assert.equal(initialBlocks[0].svgCount, 1)
    assert.equal(initialBlocks[0].tableCount, 1)
    assert.match(initialBlocks[0].stdout, /slope=2/)
    assert.equal(initialBlocks[0].sliderValue, "2")

    assert.equal(initialBlocks[1].mode, "run-show-code")
    assert.equal(initialBlocks[1].processed, "true")
    assert.equal(initialBlocks[1].hasCode, true)
    assert.match(initialBlocks[1].stdout, /visible source/)

    await ui.scrubPythonSlider(3)
    const scrubbedBlocks = await ui.readPythonBlockSemantics()
    assert.match(scrubbedBlocks[0].stdout, /slope=3/)
    assert.equal(scrubbedBlocks[0].sliderValue, "3")
  } finally {
    await ui.replaceSource(originalSource)
    await ui.waitForSaved(originalSource)
    await ui.refreshPreview()
    await ui.showVisualMode()
  }
}
