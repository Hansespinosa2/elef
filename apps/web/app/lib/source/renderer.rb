module Source
  module Renderer
    module_function

    def render(markdown, media_resolver: nil)
      Source::JavascriptRenderer.render(markdown, media_resolver: media_resolver).html_safe
    end

    def render_art_block(markdown, host_mode: "flowing", media_resolver: nil, document_nodes: [])
      Source::JavascriptRenderer.render_art_block(
        markdown,
        host_mode: host_mode,
        media_resolver: media_resolver,
        document_nodes: document_nodes
      ).html_safe
    end
  end
end
