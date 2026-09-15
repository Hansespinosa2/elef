export function hasUnsavedChanges(source: string, baseline: string, sourceName: string | null): boolean {
  return sourceName !== null && source !== baseline;
}
