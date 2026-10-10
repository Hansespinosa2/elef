// Shipped types for the @elef/renderer projection API. The implementation
// stays untyped JavaScript; this declaration is the single source of truth
// for its public surface. Shapes owned elsewhere are reused, never
// redeclared: work-model owns the structure/style/link vocabulary.
//
// The `chrome` option is intentionally `unknown`: the renderer calls sixteen
// presentation-chrome methods on it, but no static cross-package caller
// passes a chrome today (the desktop worker injects one at runtime). Typing
// the full RendererChrome interface belongs with the renderer's S4 home
// completion, when renderer_chrome.test.js can prove it.
import type {
  EditorMap,
  EditorStructure,
  EditorStyle,
  MarginSettings,
  ResolvedDocument,
} from "@elef/work-model";

export interface RendererPreviewInput {
  readonly source?: string;
  readonly kind?: string;
  readonly title?: string;
  readonly deckId?: string;
  readonly mediaBaseUrl?: string;
  // Host-provided and deliberately opaque (the client's own prop type is
  // readonly unknown[]): the link resolver validates entries at runtime.
  readonly documentNodes?: readonly unknown[];
  readonly mediaMap?: Record<string, unknown>;
  readonly allowRemoteMedia?: boolean;
  readonly style?: Partial<EditorStyle>;
  readonly marginSettings?: Partial<MarginSettings>;
}

export interface RendererPreviewOutput {
  readonly html: string;
  readonly warnings: EditorStructure["warnings"];
  readonly editor_map: EditorMap;
  readonly style: EditorStyle;
}

export interface RenderMarkdownOptions {
  readonly mediaBaseUrl?: string;
  readonly mediaMap?: Record<string, unknown>;
  readonly allowRemoteMedia?: boolean;
  readonly documentNodes?: readonly unknown[];
  readonly resolveDocumentLink?: (value: unknown) => ResolvedDocument | null;
  readonly chrome?: unknown;
}

export function collectMediaReferences(source?: string): string[];
export function renderMarkdownBlock(source?: string, options?: RenderMarkdownOptions): string;
export function renderPreviewCore(
  input?: RendererPreviewInput,
  options?: { chrome?: unknown },
): RendererPreviewOutput;
