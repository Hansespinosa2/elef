// Temporary re-export: the sanitizer implementation moved to @elef/client
// (src/ui/sanitize.ts), consumed here as the committed dist bundle. The
// editor (Phase 08) and settings (Phase 05) slices import this path until
// they migrate to the client; this file is deleted then.
export { sanitizePreview as installSanitizedPreview } from "@elef/client/sanitize"
