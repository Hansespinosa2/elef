// Minimal honest types for the @elef/renderer surface the client uses.
// The renderer package is untyped JS; this seam declares exactly the input
// fields and output fields the library feature touches.
declare module "@elef/renderer" {
  export interface ClientPreviewInput {
    readonly source?: string;
    readonly kind?: string;
    readonly title?: string;
    readonly deckId?: string;
    readonly mediaBaseUrl?: string;
    readonly documentNodes?: readonly unknown[];
    readonly allowRemoteMedia?: boolean;
  }

  export interface ClientPreviewStyle {
    readonly theme: string;
    readonly typography: string;
  }

  export interface ClientPreviewOutput {
    readonly html: string;
    readonly style: ClientPreviewStyle;
  }

  export function renderPreviewCore(input?: ClientPreviewInput): ClientPreviewOutput;
}
