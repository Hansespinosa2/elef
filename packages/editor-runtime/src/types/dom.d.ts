import type { Application, Controller } from "@hotwired/stimulus";

declare global {
  interface Element {
    editorController?: Controller | null | undefined;
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

  // Vendored Mermaid global (host-served mermaid.min.js).
  var mermaid:
    | {
        initialize(config: unknown): void;
        render(id: string, source: string): Promise<{ svg: string }>;
        run(options: { nodes: unknown; suppressErrors?: boolean }): Promise<void>;
      }
    | undefined;

  var __elefE2EControllerErrors: Array<Record<string, string>> | undefined;
  var __elefPreviewTrace: unknown[] | undefined;
  var __elefPresentationTestHooks: unknown;
}

export {};
