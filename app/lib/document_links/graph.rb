module DocumentLinks
  class Graph
    def initialize(documents)
      @documents = documents.to_a
      @documents_by_title = @documents.index_by(&:title)
    end

    def as_json(*)
      {
        nodes: @documents.each_with_index.map { |document, index| node(document, index) },
        edges: edges
      }
    end

    private

    def node(document, index)
      {
        id: document.id,
        title: document.title,
        url: Rails.application.routes.url_helpers.document_path(document),
        x: 120 + (index % 4) * 220,
        y: 100 + ((index / 4) % 3) * 150
      }
    end

    def edges
      seen = {}
      @documents.flat_map do |document|
        DocumentLinks::Parser.parse(document.source).filter_map do |token|
          target = @documents_by_title[token.title]
          next unless target

          key = [document.id, target.id]
          next if seen[key]

          seen[key] = true
          { source: document.id, target: target.id }
        end
      end
    end
  end
end
