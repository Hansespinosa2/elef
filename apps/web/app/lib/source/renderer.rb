module Source
  module Renderer
    module_function

    def render(markdown, media_resolver: nil)
      Source::JavascriptRenderer.render(markdown, media_resolver: media_resolver).html_safe
    end
  end
end
