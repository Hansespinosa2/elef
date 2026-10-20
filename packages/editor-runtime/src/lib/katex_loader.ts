// Shared lazy KaTeX loader for the runtime math helpers. KaTeX (262K
// minified ESM) stays out of the open path: render sites use the cached
// module synchronously when present (bit-identical to today's sync path)
// and render a TeX placeholder with an async swap otherwise. The module
// itself is preloaded at idle after open (see live_preview preload), so
// the placeholder path only triggers when interaction outruns the fetch
// (slow networks + immediate math edits). The import() cache is shared
// process-wide, so concurrent loaders here and in live_preview resolve
// to one fetch and one eval.
export type KatexApi = {
  renderToString: (tex: string, options?: Record<string, unknown>) => string
}

let katexPromise: Promise<KatexApi> | null = null
let katexCached: KatexApi | null = null

export function loadKatex(): Promise<KatexApi> {
  katexPromise ??= (import("katex") as Promise<unknown>).then(
    (module) => {
      const holder = module as { default?: KatexApi }
      const api = holder.default ?? (module as KatexApi)
      katexCached = api
      return api
    },
    (error: unknown) => {
      katexPromise = null
      throw error
    }
  )
  return katexPromise
}

// Synchronous fast path: the loaded module, or null when KaTeX has not
// arrived yet. Render sites must handle null via placeholder + swap.
export function cachedKatex(): KatexApi | null {
  return katexCached
}
