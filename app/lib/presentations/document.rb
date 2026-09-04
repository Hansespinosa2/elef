module Presentations
  module Document
    Position = Data.define(:horizontal, :vertical)
    Block = Data.define(:markdown, :position)
    Region = Data.define(:blocks)
    Slide = Data.define(:id, :index, :markdown, :layout, :blocks, :title, :regions, :warnings)
    Parsed = Data.define(:source_name, :presentation_theme, :slides, :warnings)
    SourceLine = Data.define(:start, :end_pos, :text, :ending)
    FrontMatter = Data.define(:lines, :closing_line, :body_start, :eol)

    module_function

    def parse(source, source_name: "Untitled presentation")
      raise ArgumentError, "The selected file did not contain readable text." unless source.is_a?(String)

      theme = presentation_theme_from_source(source)
      content = content_without_front_matter(source)
      sections = split_sections(content)
      slides = sections.map.with_index do |section, index|
        metadata = slide_metadata(section)
        Slide.new(
          id: "#{source_name}-#{index + 1}",
          index: index,
          markdown: metadata[:content],
          layout: metadata[:layout],
          blocks: metadata[:blocks],
          title: metadata[:title],
          regions: metadata[:regions],
          warnings: metadata[:warnings]
        )
      end
      Parsed.new(source_name: source_name, presentation_theme: theme, slides: slides, warnings: slides.flat_map { |slide| slide_warnings(slide) })
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
      parsed = parse_blocks(normalized)
      content = parsed[:blocks].map(&:markdown).join("\n\n")
      layout = infer_layout(parsed[:blocks])
      title = column_title(parsed[:blocks], layout)
      regions = column_regions(parsed[:blocks], layout)
      {
        layout: layout,
        content: content,
        blocks: parsed[:blocks],
        title: title,
        regions: regions,
        warnings: parsed[:warnings]
      }
    end

    def slide_warnings(slide)
      slide.warnings
    end

    def parse_blocks(markdown)
      raw_blocks = markdown_blocks(markdown)
      blocks = []
      warnings = []
      index = 0

      while index < raw_blocks.length
        block = raw_blocks[index]
        position = position_from_block(block)
        if position
          closing_index = raw_blocks[(index + 1)..]&.index(":::")
          if closing_index
            closing_index += index + 1
            grouped = raw_blocks[(index + 1)...closing_index]
            grouped.each { |group| blocks << Block.new(group, position) unless group == "" }
            index = closing_index + 1
          elsif raw_blocks[index + 1]
            blocks << Block.new(raw_blocks[index + 1], position)
            index += 2
          else
            warnings << "Position directive has no following Markdown block."
            index += 1
          end
        elsif block == ":::" || block.start_with?(":::")
          warnings << "Unknown or malformed presentation directive was removed."
          index += 1
        else
          blocks << Block.new(block, nil)
          index += 1
        end
      end

      { blocks: blocks, warnings: warnings }
    end

    def markdown_blocks(markdown)
      blocks = []
      current = []
      fence = nil

      markdown.split("\n", -1).each do |line|
        next_fence = fence_marker(line)
        fence = toggle_fence(fence, next_fence) if next_fence

        if fence.nil? && line.match?(/\A\s*:::/)
          blocks << current.join("\n") if current.any?
          blocks << line.strip
          current = []
        elsif line.blank? && fence.nil?
          blocks << current.join("\n") if current.any?
          current = []
        else
          current << line
        end
      end
      blocks << current.join("\n") if current.any?
      blocks
    end

    def position_from_block(block)
      match = block.match(/\A\s*:::position\{([^}]*)\}\s*\z/)
      return unless match

      values = match[1].split.map(&:downcase)
      horizontal = values.find { |value| %w[left center right].include?(value) }
      vertical = values.find { |value| %w[top middle bottom].include?(value) }
      return unless horizontal || vertical

      Position.new(horizontal || "left", vertical || "top")
    end

    def infer_layout(blocks)
      meaningful = blocks.reject { |block| block.markdown.blank? }
      return "body" if meaningful.empty?

      if heading_for(meaningful.first.markdown)&.fetch(:level, nil) == 1
        section_blocks = meaningful.drop(1).select { |block| heading_for(block.markdown) }
        section_levels = section_blocks.map { |block| heading_for(block.markdown)[:level] }
        first_section_index = meaningful.drop(1).index { |block| heading_for(block.markdown) }
        if section_blocks.length.between?(2, 3) && first_section_index == 0 && section_levels.uniq.one? && section_levels.first > 1
          return section_blocks.length == 2 ? "two-column" : "three-column"
        end
      end

      content_blocks = meaningful.drop(1) if heading_for(meaningful.first.markdown)&.fetch(:level, nil) == 1
      if content_blocks&.length == 1
        content = content_blocks.first.markdown
        return "image" if image_block?(content)
        return "table" if table_block?(content)
        return "code" if code_block?(content)
        return "statement" if prose_block?(content)
      end
      "body"
    end

    def column_title(blocks, layout)
      return unless %w[two-column three-column].include?(layout)

      blocks.first.markdown
    end

    def column_regions(blocks, layout)
      return [Region.new(blocks)] unless %w[two-column three-column].include?(layout)

      regions = []
      blocks.drop(1).each do |block|
        if heading_for(block.markdown)
          regions << Region.new([])
        end
        next if regions.empty?

        regions[-1].blocks << block
      end
      regions
    end

    def heading_for(markdown)
      first_line = markdown.lines.first.to_s
      match = first_line.match(/\A\s{0,3}(#+)\s+(.+?)\s*#*\s*\z/)
      match && { level: match[1].length, text: match[2].strip }
    end

    def image_block?(markdown)
      markdown.match?(/\A\s*!\[[^\]]*\]\([^\)]+\)\s*\z/m)
    end

    def table_block?(markdown)
      markdown.lines.length >= 2 && markdown.lines[0].include?("|") && markdown.lines[1].match?(/\A\s*\|?\s*:?-{3,}/)
    end

    def code_block?(markdown)
      markdown.match?(/\A\s*(`{3,}|~{3,})[^\n]*\n.*\n\s*\1\s*\z/m)
    end

    def prose_block?(markdown)
      !markdown.match?(/\A\s*(?:[-*+] |\d+[.)] |> |!\[|\||`{3,}|~{3,})/)
    end
  end
end
