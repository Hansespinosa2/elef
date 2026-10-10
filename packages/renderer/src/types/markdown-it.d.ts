// Minimal honest types for the markdown-it surface packages/renderer uses.
// markdown-it ships no TypeScript declarations and the campaign adds no new
// dependencies, so this ambient module declares exactly the constructor
// options, rulers, renderer rules, tokens and state fields the renderer
// touches. Rule-state `env` stays unknown: every parse/render call site
// passes a complete RenderEnv, narrowed back in renderer.ts.
declare module "markdown-it" {
  export interface MarkdownItToken {
    type: string
    content: string
    map?: number[] | null
    children?: MarkdownItToken[] | null
    attrGet(name: string): string | null
    attrSet(name: string, value: string): void
  }

  export interface MarkdownItBlockState {
    src: string
    blkIndent: number
    bMarks: number[]
    eMarks: number[]
    line: number
    env?: unknown
    getLines(begin: number, end: number, indent: number, keepLastLF: boolean): string
    push(type: string, tag: string, nesting: number): MarkdownItToken
  }

  export interface MarkdownItInlineState {
    src: string
    pos: number
    env?: unknown
    push(type: string, tag: string, nesting: number): MarkdownItToken
  }

  export interface MarkdownItCoreState {
    tokens: MarkdownItToken[]
    env?: unknown
  }

  export type MarkdownItBlockRule = (
    state: MarkdownItBlockState,
    startLine: number,
    endLine: number,
    silent: boolean
  ) => boolean

  export type MarkdownItInlineRule = (state: MarkdownItInlineState, silent: boolean) => boolean

  export type MarkdownItCoreRule = (state: MarkdownItCoreState) => void

  export interface MarkdownItRuler<Rule> {
    before(beforeName: string, ruleName: string, fn: Rule): void
    after(afterName: string, ruleName: string, fn: Rule): void
  }

  export type MarkdownItRenderRule = (
    tokens: MarkdownItToken[],
    index: number,
    options: unknown,
    env: unknown
  ) => string

  export interface MarkdownItOptions {
    html?: boolean
    linkify?: boolean
    breaks?: boolean
    typographer?: boolean
    highlight?: (code: string, language: string) => string
    validateLink?: (url: string) => boolean
  }

  export interface MarkdownItInstance {
    readonly utils: { escapeHtml(value: string): string }
    readonly block: { ruler: MarkdownItRuler<MarkdownItBlockRule> }
    readonly inline: { ruler: MarkdownItRuler<MarkdownItInlineRule> }
    readonly core: { ruler: MarkdownItRuler<MarkdownItCoreRule> }
    readonly renderer: { rules: Record<string, MarkdownItRenderRule | undefined> }
    parse(src: string, env: unknown): MarkdownItToken[]
    render(src: string, env?: unknown): string
  }

  export interface MarkdownItFactory {
    new (options?: MarkdownItOptions): MarkdownItInstance
    (options?: MarkdownItOptions): MarkdownItInstance
  }

  const MarkdownIt: MarkdownItFactory
  export default MarkdownIt
}
