module Snippets
  class Catalog
    PLACEHOLDER = /\$\{(\d+)(?::([^}]*))?\}/.freeze

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
      offset = 0
      expanded = text.gsub(PLACEHOLDER) do
        match = Regexp.last_match
        number = match[1].to_i
        value = match[2].to_s
        start = match.begin(0) + offset
        offset += value.length - match[0].length
        stops << { number: number, start: start, length: value.length }
        value
      end
      { text: expanded, stops: stops.sort_by { |stop| stop[:number].zero? ? Float::INFINITY : stop[:number] } }
    end
  end
end
