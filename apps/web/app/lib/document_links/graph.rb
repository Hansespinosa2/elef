module DocumentLinks
  class Graph
    def initialize(documents)
      @documents = documents.to_a
    end

    def as_json(*)
      Source::JavascriptRenderer.document_graph(@documents.map do |document|
        {
          id: document.id,
          title: document.title,
          url: Rails.application.routes.url_helpers.document_path(document),
          documentKey: document.document_key,
          aliases: document.aliases.map(&:alias_name),
          source: document.source.to_s
        }
      end)
    end
  end
end
