// Always-on stage marks for open/edit performance analysis. Marks are cheap,
// DevTools-visible, and namespaced under "elef:"; consumers read them with
// performance.getEntriesByType("mark") and pair start/end by name.
export function markStage(stage: string): void {
  try {
    performance?.mark?.(`elef:${stage}`)
  } catch {
    // Performance timeline unavailable (non-browser host); stages stay silent.
  }
}
