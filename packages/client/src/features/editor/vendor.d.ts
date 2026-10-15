/// <reference path="./vendor_modules.d.ts" />
import type { EditorEngine } from "./engine.js";

declare global {
  interface Element {
    editorController?: EditorEngine | null | undefined;
    previewController?: any;
    visualEditorController?: any;
    presentationEditorController?: any;
  }
  var mermaid: { initialize(config: unknown): void; render(id: string, source: string): Promise<{svg: string}>; run(options: {nodes: unknown; suppressErrors?: boolean}): Promise<void> } | undefined;
}

