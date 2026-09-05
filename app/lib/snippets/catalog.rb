module Snippets
  class Catalog
    PLACEHOLDER = /\$\{(\d+)(?::([^}]*))?\}/

    def self.all
      Snippet.ordered
    end

    def self.for_editor
      all.map do |snippet|
        {
          id: snippet.id,
          name: snippet.name,
          trigger: snippet.trigger,
          description: snippet.description,
          category: snippet.category,
          body: snippet.body
        }
      end
    end

    def self.expand(body)
      text = body.to_s
      stops = []
      expanded = text.gsub(PLACEHOLDER) do
        number = Regexp.last_match(1).to_i
        value = Regexp.last_match(2).to_s
        start = Regexp.last_match.begin(0)
        stops << { number: number, start: start, length: value.length }
        value
      end
      { text: expanded, stops: stops.sort_by { |stop| stop[:number].zero? ? Float::INFINITY : stop[:number] } }
    end
  end
end
