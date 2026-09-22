module DocumentLinks
  module Renderer
    module_function

    def render(markdown, documents: nil, workspace: nil)
      documents = (documents || Document.all).to_a
      workspace ||= documents.first&.workspace || Workspace.default
      documents_by_title = documents.index_by(&:title)
      documents_by_key = documents.index_by(&:document_key)
      documents_by_alias = documents.flat_map { |document| document.aliases.map { |alias_record| [alias_record.alias_name, document] } }.to_h
      replacements = {}

      annotated = DocumentLinks::Parser.replace(markdown) do |token|
        placeholder = "ELEFDOCUMENTLINK#{replacements.length}X#{SecureRandom.hex(6)}"
        token_key, label = token.title.split("|", 2)
        target = if token_key.match?(/\A(?:document|id):/)
          documents_by_key[token_key.sub(/\A(?:document|id):/, "")]
        end
        target ||= documents_by_alias[token_key]
        target ||= documents_by_title[token_key]
        target ||= Document.resolve_link(token_key, workspace: workspace) unless target
        replacements[placeholder] = replacement_for(token, target, label: label)
        placeholder
      end

      html = Presentations::MarkdownRenderer.render(annotated)
      replacements.each { |placeholder, replacement| html = html.gsub(placeholder) { replacement } }
      html.html_safe
    end

    def replacement_for(token, document, label: nil)
      display = label.presence || document&.title || token.title
      return %(<span class="document-link unresolved" aria-label="Unresolved document link">#{ERB::Util.html_escape("[[#{display}]]")}</span>) unless document

      href = Rails.application.routes.url_helpers.document_path(document)
      %(<a class="document-link" data-document-link-title="#{ERB::Util.html_escape(document.title)}" href="#{ERB::Util.html_escape(href)}" aria-label="Open document preview: #{ERB::Util.html_escape(document.title)}">#{ERB::Util.html_escape(display)}</a>)
    end
    private_class_method :replacement_for
  end
end
