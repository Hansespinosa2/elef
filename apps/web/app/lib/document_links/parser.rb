module DocumentLinks
  class Parser
    Token = Struct.new(:title, :start, :end, keyword_init: true)

    class << self
      def parse(source)
        source = source.to_s
        parsed = Source::JavascriptRenderer.document_link_tokens(source)
        offsets = ruby_character_offsets(source, parsed.flat_map { |token| [token[:start], token[:end]] })
        parsed.map do |token|
          Token.new(title: token[:title], start: offsets.fetch(token[:start]), end: offsets.fetch(token[:end]))
        end
      end

      def linkable_title?(title)
        Source::JavascriptRenderer.linkable_document_titles([title]).any?
      end

      def replace(source)
        source = source.to_s
        tokens = parse(source)
        return source if tokens.empty?

        result = String.new
        cursor = 0
        tokens.each do |token|
          result << source[cursor...token.start]
          result << yield(token)
          cursor = token.end
        end
        result << source[cursor..]
      end

      def rewrite(source, old_title, new_title)
        replace(source) do |token|
          token.title == old_title ? "[[#{new_title}]]" : "[[#{token.title}]]"
        end
      end

      private

      def ruby_character_offsets(source, javascript_offsets)
        requested = javascript_offsets.uniq.sort
        positions = {}
        target = 0
        utf16_offset = 0
        character_offset = 0

        source.each_char do |character|
          while requested[target] == utf16_offset
            positions[requested[target]] = character_offset
            target += 1
          end
          utf16_offset += character.ord > 0xFFFF ? 2 : 1
          character_offset += 1
        end

        while target < requested.length
          positions[requested[target]] = character_offset
          target += 1
        end

        positions
      end
    end
  end
end
