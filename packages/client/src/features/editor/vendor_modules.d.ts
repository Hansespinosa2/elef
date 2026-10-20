declare module "codemirror" {
  import type { Extension } from "@codemirror/state";

  export const basicSetup: Extension[];
}

declare module "@codemirror/lang-markdown" {
  import type { LanguageSupport } from "@codemirror/language";

  export interface MarkdownConfig {
    extensions?: unknown;
    [key: string]: unknown;
  }

  export function markdown(config?: MarkdownConfig): LanguageSupport;
}

declare module "@replit/codemirror-vim" {
  import type { Extension } from "@codemirror/state";
  import type { EditorView } from "@codemirror/view";

  export interface VimApi {
    handleKey(cm: unknown, key: string, origin: string): void;
    map(key: string, value: string, mode: string): void;
    unmap(key: string, mode?: string): void;
    [key: string]: unknown;
  }

  export const Vim: VimApi;
  export function getCM(view: EditorView): any;
  export function vim(): Extension;
}
