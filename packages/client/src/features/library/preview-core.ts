// Lazy preview-rendering entry for library cards.
//
// The projection renderer drags in KaTeX, highlight.js and markdown-it,
// roughly half of the client bundle's boot parse. Card previews are the only
// client consumer, and every load is already asynchronous (idle-gated), so
// this entry keeps that weight out of the boot graph: it ships as a separate
// committed file (`dist/preview-core.js`, served deferred beside the boot
// entry) which the desktop build re-bundles into its own deferred chunk.
// A failed load degrades to the card's "unavailable" state, never a crash.
export { renderPreviewCore } from "@elef/renderer";
export type {
  ClientPreviewInput,
  ClientPreviewOutput,
  ClientPreviewStyle,
} from "@elef/renderer";
