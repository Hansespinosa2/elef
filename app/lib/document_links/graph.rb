module DocumentLinks
  class Graph
    def initialize(documents)
      @documents = documents.to_a
      @documents_by_title = @documents.index_by(&:title)
      @documents_by_alias = @documents.flat_map { |document| document.aliases.map { |alias_record| [alias_record.alias_name, document] } }.to_h
      @documents_by_key = @documents.index_by(&:document_key)
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
        y: 100 + (index / 4) * 150
      }
    end

    def edges
      seen = {}
      @documents.flat_map do |document|
        DocumentLinks::Parser.parse(document.source).filter_map do |token|
          token_key, = token.title.split("|", 2)
          target = if token_key.match?(/\A(?:document|id):/)
            @documents_by_key[token_key.sub(/\A(?:document|id):/, "")]
          end
          target ||= @documents_by_alias[token_key]
          target ||= @documents_by_title[token_key]
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
