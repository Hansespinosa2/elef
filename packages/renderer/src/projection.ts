export { renderMarkdownBlock } from "./renderer.js"

// The bare block render the shipped ESM entries expose: plain structural
// wrappers with no editor controls (bareChrome default in renderer.js).
// Editor chrome composition lives in the editor-runtime-owned entry
// (packages/editor-runtime/src/composed_renderer.ts), never here: this
// package must stay free of the editor-runtime edge so the package build
// orders topologically. Export flows render through this entry; the
// desktop PPTX model keeps its projection import with zero code change.
