async function measurePaintedAction(action, {
  now = () => performance.now(),
  paint = () => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)))
} = {}) {
  const started = now();
  const result = await action();
  await paint();
  return { milliseconds: now() - started, result };
}
function percentile95(samples) {
  if (!Array.isArray(samples) || samples.length < 20 || samples.some((value) => !Number.isFinite(value) || value < 0)) {
    throw new Error("Performance measurements require at least 20 finite, nonnegative samples.");
  }
  const sorted = [...samples].sort((a, b) => a - b);
  return sorted[Math.ceil(samples.length * 0.95) - 1];
}
export {
  measurePaintedAction,
  percentile95
};
