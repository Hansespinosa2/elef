module DocumentLinks
  module Renderer
    module_function

    def render(markdown, documents: nil, workspace: nil, media_resolver: nil)
      source = markdown.to_s
      unless source.include?("[[")
        return Source::Renderer.render(markdown, media_resolver: media_resolver)
      end

      workspace ||= documents&.first&.workspace || Workspace.default
      documents = (documents || Document.where(workspace: workspace).includes(:document_detail, :document_aliases)).to_a
      nodes = documents.map do |document|
        {
          id: document.id.to_s,
          title: document.title,
          documentKey: document.document_key,
          aliases: document.document_aliases.map(&:alias_name),
          href: Rails.application.routes.url_helpers.document_path(document)
        }
      end
      Source::JavascriptRenderer.render(
        source,
        media_resolver: media_resolver,
        document_nodes: nodes
      ).html_safe
    end
  end
end
