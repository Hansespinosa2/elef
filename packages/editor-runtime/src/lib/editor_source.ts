import type { Controller } from "@hotwired/stimulus";

export interface ApplyEditorSourceOptions {
  id: unknown;
  expectedSource: string;
  getWorkId(): unknown;
  getSource(): unknown;
  waitForEditor(): Promise<Controller | null>;
  setFallback(source: string): void;
  materializeEdits?: () => void;
}

export async function applyEditorSource(source: string, {
  id, expectedSource, getWorkId, getSource, waitForEditor, setFallback, materializeEdits = () => {}
}: ApplyEditorSourceOptions) {
  const controller = await waitForEditor()
  materializeEdits()
  // Readiness may wait while navigation or typing changes the target buffer.
  // A delayed reload/recovery must not replace another work or newer edits.
  if (getWorkId() !== id || getSource() !== expectedSource) return false
  if (controller) controller.setExternalValue(source)
  else setFallback(source)
  return true
}
