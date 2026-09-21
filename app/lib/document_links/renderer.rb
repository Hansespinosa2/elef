module DocumentLinks
  module Renderer
    module_function

    def render(markdown, documents: nil)
      documents_by_title = (documents || Document.all).index_by(&:title)
      replacements = {}

      annotated = DocumentLinks::Parser.replace(markdown) do |token|
        placeholder = "ELEFDOCUMENTLINK#{replacements.length}X#{SecureRandom.hex(6)}"
        replacements[placeholder] = replacement_for(token, documents_by_title[token.title])
        placeholder
      end

      html = Presentations::MarkdownRenderer.render(annotated)
      replacements.each { |placeholder, replacement| html = html.gsub(placeholder, replacement) }
      html.html_safe
    end

    def replacement_for(token, document)
      return %(<span class="document-link unresolved" aria-label="Unresolved document link">#{ERB::Util.html_escape("[[#{token.title}]]")}</span>) unless document

      href = Rails.application.routes.url_helpers.document_path(document)
      %(<a class="document-link" data-document-link-title="#{ERB::Util.html_escape(document.title)}" href="#{ERB::Util.html_escape(href)}" aria-label="Open document preview: #{ERB::Util.html_escape(document.title)}">#{ERB::Util.html_escape(document.title)}</a>)
    end
    private_class_method :replacement_for
  end
end
