import { test } from "node:test";
import assert from "node:assert/strict";
import { parseHTML } from "linkedom";
import {
  PYTHON_ERROR_CLASS,
  clearPythonExecutionCache,
  getPythonWorkerMessageCount,
  mountPythonExecutionResult,
  renderPythonBlocks,
  resetPythonWorkerMessageCount,
  runPythonCode,
  sanitizePythonSvg,
  sanitizePythonTable,
  setPythonExecutionTimeoutForTests,
  setPythonExecutorForTests,
} from "../src/features/editor/python_runtime.js";

function setupDom(html: string): { document: Document; root: HTMLElement } {
  const { document } = parseHTML(`<html><body><div id="root">${html}</div></body></html>`);
  const view = (document as unknown as { defaultView?: unknown }).defaultView;
  (globalThis as Record<string, unknown>)["window"] = view ?? { document };
  (globalThis as Record<string, unknown>)["document"] = document;
  const root = document.getElementById("root") as unknown as HTMLElement;
  return { document, root };
}

test("each executable python block runs in an isolated variable namespace", async () => {
  clearPythonExecutionCache();
  setPythonExecutorForTests(null);
  const { root } = setupDom("");

  const first = await runPythonCode("secret_val = 42\nprint(secret_val)", root);
  assert.equal(first.ok, true);
  assert.equal(first.frames[0]?.stdout, "42\n");

  const second = await runPythonCode("print(secret_val)", root);
  assert.equal(second.ok, false);
  assert.match(second.error ?? "", /NameError: name 'secret_val' is not defined/);
});

test("matplotlib plots and pandas dataframes are captured with theme colors", async () => {
  clearPythonExecutionCache();
  setPythonExecutorForTests(null);
  const { root } = setupDom(`
    <div class="elef-python-block">
      <pre class="elef-python-source">import numpy as np
import pandas as pd
import matplotlib.pyplot as plt

x = np.linspace(0, 6, 12)
y = np.sin(x)
plt.plot(x, y, label="sin(x)")
plt.title("Harmonic Wave")
plt.xlabel("Phase")
plt.ylabel("Amplitude")

df = pd.DataFrame({"metric": ["rmse", "r2"], "score": [0.12, 0.98]})
df</pre>
      <div class="elef-python-output"></div>
    </div>
  `);

  const rendered = await renderPythonBlocks(root);
  assert.equal(rendered, true);

  const svg = root.querySelector(".elef-python-figures svg");
  assert.ok(svg, "expected rendered SVG figure");
  assert.match(svg.outerHTML, /Harmonic Wave/);
  assert.ok(svg.querySelector("path.elef-python-series-line"));

  const table = root.querySelector("table.elef-python-dataframe");
  assert.ok(table, "expected rendered DataFrame HTML table");
  assert.match(table.textContent ?? "", /rmse/);
  assert.match(table.textContent ?? "", /0\.98/);
});

test("scikit-learn LinearRegression fits and predicts in executable blocks", async () => {
  clearPythonExecutionCache();
  setPythonExecutorForTests(null);
  const { root } = setupDom("");

  const result = await runPythonCode(
    [
      "from sklearn.linear_model import LinearRegression",
      "model = LinearRegression()",
      "model.fit([1, 2, 3, 4], [3, 5, 7, 9])",
      "preds = model.predict([5, 6])",
      "print(round(preds[0], 1), round(preds[1], 1))",
    ].join("\n"),
    root,
  );
  assert.equal(result.ok, true);
  assert.equal(result.frames[0]?.stdout, "11 13\n");
});

test("elef.slider pre-computes discrete frames and scrubs in pure JS with zero worker round-trips", async () => {
  clearPythonExecutionCache();
  setPythonExecutorForTests(null);
  resetPythonWorkerMessageCount();
  const { document, root } = setupDom(`
    <div class="elef-python-block">
      <pre class="elef-python-source">import elef
import numpy as np
import matplotlib.pyplot as plt

freq = elef.slider("Frequency", 1, 5, step=1, value=2)
x = np.linspace(0, 3, 10)
plt.plot(x, np.sin(freq * x))
plt.title(f"Freq {freq} Hz")
print(f"active={freq}")</pre>
      <div class="elef-python-output"></div>
    </div>
  `);

  const block = root.querySelector(".elef-python-block") as HTMLElement;
  const result = await runPythonCode(
    block.querySelector(".elef-python-source")?.textContent ?? "",
    block,
  );
  assert.equal(result.ok, true);
  assert.ok(result.slider);
  assert.deepEqual(result.slider.values, [1, 2, 3, 4, 5]);
  assert.equal(result.slider.defaultValue, 2);
  assert.equal(result.frames.length, 5);
  assert.equal(getPythonWorkerMessageCount(), 1);

  mountPythonExecutionResult(block, result);

  const sliderInput = block.querySelector<HTMLInputElement>("input.elef-python-slider");
  const valueOutput = block.querySelector<HTMLElement>("output.elef-python-slider-value");
  const frames = [...block.querySelectorAll<HTMLElement>(".elef-python-frame")];
  assert.ok(sliderInput);
  assert.ok(valueOutput);
  assert.equal(frames.length, 5);
  assert.equal(valueOutput.textContent, "2");
  assert.equal(frames[1]?.hidden, false);
  assert.equal(frames[3]?.hidden, true);

  // Scrubbing the slider must swap frames synchronously with zero worker messages.
  resetPythonWorkerMessageCount();
  sliderInput.value = "4";
  const inputEvent = document.createEvent("Event");
  inputEvent.initEvent("input", true, true);
  sliderInput.dispatchEvent(inputEvent);

  assert.equal(getPythonWorkerMessageCount(), 0);
  assert.equal(valueOutput.textContent, "4");
  assert.equal(frames[1]?.hidden, true);
  assert.equal(frames[3]?.hidden, false);
  assert.match(frames[3]?.textContent ?? "", /active=4/);

  // Validate keyword min/max arguments.
  const kwSlider = await runPythonCode(
    'import elef\ns = elef.slider("Slope", min=10, max=12, step=1, value=11)\nprint(f"s={s}")',
    block,
  );
  assert.equal(kwSlider.ok, true);
  assert.deepEqual(kwSlider.slider?.values, [10, 11, 12]);
  assert.equal(kwSlider.slider?.min, 10);
  assert.equal(kwSlider.slider?.max, 12);
  assert.equal(kwSlider.slider?.defaultValue, 11);

  // Validate >25 step rejection and >1 slider rejection in v0.
  const tooManySteps = await runPythonCode(
    'import elef\nk = elef.slider("Count", 1, 30, step=1)',
    block,
  );
  assert.equal(tooManySteps.ok, false);
  assert.match(tooManySteps.error ?? "", /at most 25 steps/);

  const twoSliders = await runPythonCode(
    'import elef\na = elef.slider("A", 1, 3)\nb = elef.slider("B", 1, 3)',
    block,
  );
  assert.equal(twoSliders.ok, false);
  assert.match(twoSliders.error ?? "", /Only one elef\.slider is supported per block/);
});

test("in-memory cache deduplicates identical runs across trailing-newline differences until force is requested", async () => {
  clearPythonExecutionCache();
  setPythonExecutorForTests(null);
  resetPythonWorkerMessageCount();
  const { root } = setupDom("");

  const code = "print(21 * 2)";
  const r1 = await runPythonCode(code, root);
  const r2 = await runPythonCode(`${code}\n`, root);
  assert.equal(r1.frames[0]?.stdout, "42\n");
  assert.equal(r2.frames[0]?.stdout, "42\n");
  assert.equal(getPythonWorkerMessageCount(), 1);

  const r3 = await runPythonCode(code, root, { force: true });
  assert.equal(r3.frames[0]?.stdout, "42\n");
  assert.equal(getPythonWorkerMessageCount(), 2);
});

test("worker timeout terminates a hung block after the timeout and recovers for subsequent blocks", async () => {
  clearPythonExecutionCache();
  setPythonExecutionTimeoutForTests(35);
  const { root } = setupDom(`<div class="elef-python-block"><div class="elef-python-output"></div></div>`);
  const block = root.querySelector(".elef-python-block") as HTMLElement;

  try {
    setPythonExecutorForTests(async (code) => {
      if (code.includes("while True")) {
        return await new Promise(() => {
          // Hang indefinitely to trigger timeout recovery.
        });
      }
      return {
        ok: true,
        frames: [{ value: null, stdout: "recovered\n", figuresSvg: [], dataframeHtml: null }],
        slider: null,
        error: null,
      };
    });

    const timedOut = await runPythonCode("while True:\n  pass", block);
    assert.equal(timedOut.ok, false);
    assert.equal(timedOut.error, "Execution timed out after 35ms.");
    mountPythonExecutionResult(block, timedOut);
    assert.ok(block.classList.contains(PYTHON_ERROR_CLASS));
    assert.match(block.textContent ?? "", /Execution timed out after 35ms/);

    const nextRun = await runPythonCode("print('recovered')", block);
    assert.equal(nextRun.ok, true);
    assert.equal(nextRun.frames[0]?.stdout, "recovered\n");
  } finally {
    setPythonExecutorForTests(null);
    setPythonExecutionTimeoutForTests(10_000);
  }
});

test("sanitizePythonSvg and sanitizePythonTable strip scripts, styles, animation setters, event handlers, and external URLs", () => {
  const { document } = setupDom("");

  const dirtySvg = `<svg xmlns="http://www.w3.org/2000/svg" onload="alert(1)"><script>alert(2)</script><style>body { display: none; }</style><set attributeName="onload" to="alert(3)"/><animate attributeName="href" to="javascript:alert(4)"/><foreignObject><iframe></iframe></foreignObject><use href="#safe-id"/><use href="https://evil.example/payload.svg#x"/><path d="M 0 0 L 10 10" filter="url(https://evil.example/filter#f)" clip-path="url(#local-clip)" onclick="evil()"/></svg>`;
  const cleanSvg = sanitizePythonSvg(dirtySvg, document);
  assert.ok(cleanSvg);
  const serializedSvg = cleanSvg.outerHTML;
  assert.ok(!serializedSvg.includes("<script"));
  assert.ok(!serializedSvg.includes("<style"));
  assert.ok(!serializedSvg.includes("<set"));
  assert.ok(!serializedSvg.includes("<animate"));
  assert.ok(!serializedSvg.includes("foreignObject"));
  assert.ok(!serializedSvg.includes("onload"));
  assert.ok(!serializedSvg.includes("onclick"));
  assert.ok(!serializedSvg.includes("evil.example"));
  assert.ok(serializedSvg.includes('href="#safe-id"'));
  assert.ok(serializedSvg.includes('clip-path="url(#local-clip)"'));

  const dirtyTable = `<table class="dataframe" onclick="evil()"><thead><tr style="text-align: right;"><th>col</th></tr></thead><tbody><tr><td style="background:url(javascript:alert(1))">val<script>evil()</script></td></tr></tbody></table>`;
  const cleanTableFrag = sanitizePythonTable(dirtyTable, document);
  const holder = document.createElement("div");
  holder.appendChild(cleanTableFrag);
  assert.ok(!holder.innerHTML.includes("<script"));
  assert.ok(!holder.innerHTML.includes("onclick"));
  assert.ok(!holder.innerHTML.includes("javascript:"));
  assert.ok(holder.querySelector("table.dataframe"));
});
