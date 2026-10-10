export interface PaintedActionClocks {
  now?: () => number;
  paint?: () => unknown;
}

export async function measurePaintedAction<T>(action: () => T | Promise<T>, {
  now = () => performance.now(),
  paint = () => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))
}: PaintedActionClocks = {}): Promise<{ milliseconds: number; result: T }> {
  const started = now()
  const result = await action()
  await paint()
  return { milliseconds: now() - started, result }
}

export function percentile95(samples: unknown): number {
  if (!Array.isArray(samples) || samples.length < 20 || samples.some((value: number) => !Number.isFinite(value) || value < 0)) {
    throw new Error("Performance measurements require at least 20 finite, nonnegative samples.")
  }
  const sorted = [...samples].sort((a: number, b: number) => a - b)
  return sorted[Math.ceil(samples.length * 0.95) - 1] as number
}
