// Minimal honest types for the highlight.js common build surface the
// renderer uses. The "./lib/common" subpath ships no "types" condition, so
// this ambient module declares exactly getLanguage/highlight.
declare module "highlight.js/lib/common" {
  export interface HighlightJsCommon {
    getLanguage(name: string): unknown
    highlight(code: string, options: { language: string; ignoreIllegals?: boolean }): { value: string }
  }

  const hljs: HighlightJsCommon
  export default hljs
}
