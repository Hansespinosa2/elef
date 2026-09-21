module DocumentLinks
  class Parser
    Token = Struct.new(:title, :start, :end, keyword_init: true)

    LINK_PATTERN = /\[\[([^\]\r\n]+?)\]\]/

    class << self
      def parse(source)
        source = source.to_s
        tokens = []
        offset = 0
        fence = nil

        source.each_line do |line|
          if fence
            fence = nil if closing_fence?(line, fence)
          elsif (opening = opening_fence(line))
            fence = opening
          elsif indented_code?(line)
            # Markdown treats four-space and tab-indented lines as code too.
          else
            scan_line(line, offset, tokens)
          end
          offset += line.length
        end

        tokens
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

      def opening_fence(line)
        match = line.match(/\A {0,3}(`{3,}|~{3,})/)
        return unless match

        { character: match[1][0], length: match[1].length }
      end

      def closing_fence?(line, fence)
        line.match?(/\A {0,3}#{Regexp.escape(fence[:character])}{#{fence[:length]},}[ \t]*\r?\n?\z/)
      end

      def scan_line(line, offset, tokens)
        inline_code_ranges(line).tap do |code_ranges|
          line.to_enum(:scan, LINK_PATTERN).each do
            match = Regexp.last_match
            start = offset + match.begin(0)
            next if escaped?(line, match.begin(0))
            next if code_ranges.any? { |range| range.cover?(match.begin(0)) }

            tokens << Token.new(title: match[1], start: start, end: offset + match.end(0))
          end
        end
      end

      def indented_code?(line)
        line.start_with?("    ", "\t")
      end

      def inline_code_ranges(line)
        ranges = []
        cursor = 0

        while (opening = line.index("`", cursor))
          length = 1
          length += 1 while line[opening + length] == "`"
          marker = "`" * length
          closing = line.index(marker, opening + length)
          break unless closing

          ranges << (opening...closing + length)
          cursor = closing + length
        end

        ranges
      end

      def escaped?(line, index)
        backslashes = 0
        cursor = index - 1
        while cursor >= 0 && line[cursor] == "\\"
          backslashes += 1
          cursor -= 1
        end
        backslashes.odd?
      end
    end
  end
end
