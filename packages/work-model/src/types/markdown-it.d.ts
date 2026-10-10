// Minimal honest types for the markdown-it surface packages/work-model
// uses. markdown-it ships no TypeScript declarations and the campaign adds
// no new dependencies, so this ambient module declares exactly the parser
// constructor, parse entry, and token fields art_source touches (block
// levels, nesting, line maps, list attributes, inline children). The
// renderer keeps its own twin for the ruler/render surface it touches.
declare module "markdown-it" {
  export interface MarkdownItArtToken {
    type: string
    level: number
    nesting: number
    map?: number[] | null
    attrs?: Array<[string, string | number]> | null
    children?: MarkdownItArtToken[] | null
  }

  export interface MarkdownItArtOptions {
    html?: boolean
    linkify?: boolean
    breaks?: boolean
    typographer?: boolean
  }

  export interface MarkdownItArtInstance {
    parse(src: string, env: unknown): MarkdownItArtToken[]
  }

  export interface MarkdownItArtFactory {
    new (options?: MarkdownItArtOptions): MarkdownItArtInstance
    (options?: MarkdownItArtOptions): MarkdownItArtInstance
  }

  const MarkdownIt: MarkdownItArtFactory
  export default MarkdownIt
}
