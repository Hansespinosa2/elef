module Presentations
  module Document
    Slide = Data.define(:id, :index, :markdown, :layout)
    Parsed = Data.define(:source_name, :presentation_theme, :presentation_typography, :slides)
    SourceLine = Data.define(:start, :end_pos, :text, :ending)
    FrontMatter = Data.define(:lines, :closing_line, :body_start, :eol)

    module_function

    def parse(source, source_name: "Untitled presentation")
      raise ArgumentError, "The selected file did not contain readable text." unless source.is_a?(String)

      theme = presentation_theme_from_source(source)
      typography = presentation_typography_from_source(source)
      content = content_without_front_matter(source)
      sections = split_sections(content)
      slides = sections.map.with_index do |section, index|
        metadata = slide_metadata(section)
        Slide.new(id: "#{source_name}-#{index + 1}", index: index, markdown: metadata[:content], layout: metadata[:layout])
      end
      Parsed.new(source_name: source_name, presentation_theme: theme, presentation_typography: typography, slides: slides)
    end

    def split_sections(content)
      normalized = content.gsub(/\r\n?/, "\n")
      sections = []
      section = []
      fence = nil

      normalized.split("\n", -1).each do |line|
        next_fence = fence_marker(line)
        fence = toggle_fence(fence, next_fence) if next_fence

        if fence.nil? && line.match?(/\A---[ \t]*\z/)
          sections << normalize_section(section.join("\n"))
          section = []
        else
          section << line
        end
      end

      sections << normalize_section(section.join("\n"))
      sections
    end

    def presentation_theme_from_source(source)
      front_matter = initial_front_matter(source)
      return "match" unless front_matter

      front_matter.lines[1...front_matter.closing_line].each do |line|
        match = line.text.match(/\ApresentationTheme\s*:\s*(.*)\z/)
        return normalize_theme_value(match[1]) if match
      end
      "match"
    end

    def presentation_typography_from_source(source)
      front_matter_value(source, "presentationTypography", default: "book") do |value|
        normalize_typography_value(value)
      end
    end

    def with_front_matter_value(source, key, value)
      normalized_source = source.to_s
      front_matter = initial_front_matter(normalized_source)
      eol = front_matter&.eol || (normalized_source.include?("\r\n") ? "\r\n" : "\n")
      replacement = "#{key}: #{value}"

      unless front_matter
        prefix = "---#{eol}#{replacement}#{eol}---#{eol}"
        return prefix + normalized_source
      end

      lines = source_lines(normalized_source)
      metadata_range = 1...front_matter.closing_line
      matching_line = metadata_range.find { |index| lines[index].text.match?(/\A\s*#{Regexp.escape(key)}\s*:/) }

      if matching_line
        line = lines[matching_line]
        normalized_source.dup.tap do |updated|
          updated[line.start...line.end_pos] = "#{replacement}#{line.ending}"
        end
      else
        closing = lines[front_matter.closing_line]
        normalized_source.dup.tap do |updated|
          updated.insert(closing.start, "#{replacement}#{eol}")
        end
      end
    end

    def extract_first_h1(source)
      content = content_without_front_matter(source)
      fence = nil
      content.gsub(/\r\n?/, "\n").split("\n").each do |line|
        next_fence = fence_marker(line)
        if next_fence
          fence = toggle_fence(fence, next_fence)
          next
        end
        next unless fence.nil?

        match = line.match(/\A\s{0,3}#(?!#)\s+(.+?)\s*#*\s*\z/)
        return match[1].strip if match
      end
      nil
    end

    def normalize_folder_name(title, fallback: "Untitled presentation")
      value = (title.presence || fallback).unicode_normalize(:nfkc)
      value = value.gsub(/[<>:"\/\\|?*\u0000-\u001f]/, " ").gsub(/\s+/, " ").gsub(/[. ]+\z/, "").strip
      return fallback if value.blank? || [".", ".."].include?(value)

      value[0, 120]
    end

    def slide_source_ranges(source)
      front_matter = initial_front_matter(source)
      body_start = front_matter&.body_start || 0
      ranges = []
      slide_start = body_start
      fence = nil

      source_lines(source).each do |line|
        next if line.end_pos <= body_start

        next_fence = fence_marker(line.text)
        fence = toggle_fence(fence, next_fence) if next_fence

        if fence.nil? && line.text.match?(/\A---[ \t]*\z/)
          ranges << { index: ranges.length, start: slide_start, end: line.start, delimiter_start: line.start, delimiter_end: line.end_pos }
          slide_start = line.end_pos
        end
      end

      ranges << { index: ranges.length, start: slide_start, end: source.length, delimiter_start: nil, delimiter_end: nil }
      ranges
    end

    def content_without_front_matter(source)
      front_matter = initial_front_matter(source)
      front_matter ? source[front_matter.body_start..] || "" : source
    end

    def initial_front_matter(source)
      lines = source_lines(source)
      return nil if lines.empty? || lines.first.text.sub(/\A\uFEFF/, "").rstrip != "---"

      closing_line = lines.find_index.with_index { |line, index| index.positive? && line.text.rstrip == "---" }
      return nil unless closing_line

      metadata_lines = lines[1...closing_line]
      return nil unless metadata_lines.any? { |line| line.text.match?(/\A[A-Za-z_][\w-]*\s*:/) }

      eol = lines.find { |line| line.ending.present? }&.ending || "\n"
      FrontMatter.new(lines: lines, closing_line: closing_line, body_start: lines[closing_line].end_pos, eol: eol)
    end

    def source_lines(source)
      lines = []
      source.to_enum(:scan, /([^\r\n]*)(\r\n|\n|\r|\z)/).each do
        full = Regexp.last_match(0)
        next if full.empty?

        lines << SourceLine.new(
          start: Regexp.last_match.begin(0),
          end_pos: Regexp.last_match.end(0),
          text: Regexp.last_match(1),
          ending: Regexp.last_match(2)
        )
      end
      lines
    end

    def normalize_theme_value(value)
      without_comment = value.strip.sub(/\s+#.*\z/, "").strip
      unquoted = without_comment.match(/\A(['"])(.*)\1\z/)&.[](2) || without_comment
      %w[light dark match].include?(unquoted) ? unquoted : "match"
    end

    def normalize_typography_value(value)
      without_comment = value.to_s.strip.sub(/\s+#.*\z/, "").strip
      unquoted = without_comment.match(/\A(['"])(.*)\1\z/)&.[](2) || without_comment
      %w[book modern technical].include?(unquoted) ? unquoted : "book"
    end

    def front_matter_value(source, key, default:)
      front_matter = initial_front_matter(source)
      return default unless front_matter

      front_matter.lines[1...front_matter.closing_line].each do |line|
        match = line.text.match(/\A#{Regexp.escape(key)}\s*:\s*(.*)\z/)
        return yield(match[1]) if match
      end
      default
    end

    def front_matter_has_key?(source, key)
      front_matter = initial_front_matter(source)
      front_matter && front_matter.lines[1...front_matter.closing_line].any? do |line|
        line.text.match?( /\A\s*#{Regexp.escape(key)}\s*:/ )
      end
    end

    def normalize_section(value)
      value.sub(/\A\n/, "").sub(/\n\z/, "")
    end

    def fence_marker(line)
      match = line.match(/\A\s{0,3}(`{3,}|~{3,})/)
      match && { marker: match[1][0], length: match[1].length }
    end

    def toggle_fence(current, incoming)
      if current && current[:marker] == incoming[:marker] && incoming[:length] >= current[:length]
        nil
      else
        incoming
      end
    end

    def slide_metadata(markdown)
      normalized = markdown.gsub(/\r\n?/, "\n")
      lines = normalized.split("\n", -1)
      first_content_line = lines.find_index { |line| line.strip.present? }
      return { layout: "body", directive: nil, content: normalized } unless first_content_line

      match = lines[first_content_line].match(/\A\s{0,3}:::slide-layout\{([^}\s]+)\}[ \t]*\z/)
      return { layout: "body", directive: nil, content: normalized } unless match

      layout = %w[intro body].include?(match[1]) ? match[1] : "body"
      content_lines = lines[0...first_content_line] + lines[(first_content_line + 1)..]
      content_lines.delete_at(first_content_line) if content_lines[first_content_line] == ""
      { layout: layout, directive: lines[first_content_line], content: content_lines.join("\n") }
    end
  end
end
