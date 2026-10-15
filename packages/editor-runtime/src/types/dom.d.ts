import type { Application } from "@hotwired/stimulus";

declare global {
  interface Element {
    previewController?: any;
    visualEditorController?: any;
    presentationEditorController?: any;
  }

  interface Window {
    Stimulus?: Application | undefined;
    __elefPerformanceTestHooks?:
      | { interactive(): void; ready(removed: unknown): void }
      | undefined;
  }

  var Stimulus: Application | undefined;

  var __elefE2EControllerErrors: Array<Record<string, string>> | undefined;
  var __elefPreviewTrace: unknown[] | undefined;
  var __elefPresentationTestHooks: unknown;
  var __elefPrintResult: { native: boolean } | undefined;
}

export {};
