module Source
  module Document
    Position = Data.define(:horizontal, :vertical, :vertical_explicit)
    Block = Data.define(:markdown, :position)
    Region = Data.define(:blocks)
    MarginSettings = Data.define(:section, :subsection, :footnote, :slide_count)
    Slide = Data.define(:id, :index, :markdown, :layout, :blocks, :title, :regions, :section, :subsection, :footnote, :warnings)
    Parsed = Data.define(:source_name, :mode, :theme, :typography, :margin_settings, :slides, :warnings)
    SourceLine = Data.define(:start, :end_pos, :text, :ending)
    FrontMatter = Data.define(:lines, :closing_line, :body_start, :eol)

    module_function

    def parse(source, source_name: "Untitled presentation", mode: :presentation)
      raise ArgumentError, "The selected file did not contain readable text." unless source.is_a?(String)

      mode = mode.to_sym
      raise ArgumentError, "Unsupported document mode" unless %i[presentation document].include?(mode)

      theme = theme_from_source(source)
      typography = typography_from_source(source)
      margin_settings = margin_settings_from_source(source)
      content = content_without_front_matter(source)
      sections = mode == :document ? [content] : split_sections(content)
      context = { section: nil, subsection: nil }
      slides = sections.map.with_index do |section, index|
        metadata = slide_metadata(section, context, mode: mode)
        Slide.new(
          id: "#{source_name}-#{index + 1}",
          index: index,
          markdown: metadata[:content],
          layout: metadata[:layout],
          blocks: metadata[:blocks],
          title: metadata[:title],
          regions: metadata[:regions],
          section: metadata[:section],
          subsection: metadata[:subsection],
          footnote: metadata[:footnote],
          warnings: metadata[:warnings]
        )
      end
      Parsed.new(
        source_name: source_name,
        mode: mode,
        theme: theme,
        typography: typography,
        margin_settings: margin_settings,
        slides: slides,
        warnings: slides.flat_map { |slide| slide_warnings(slide) }
      )
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

    def theme_from_source(source)
      front_matter = initial_front_matter(source)
      return "match" unless front_matter

      front_matter.lines[1...front_matter.closing_line].each do |line|
        match = line.text.match(/\Atheme\s*:\s*(.*)\z/)
        return normalize_theme_value(match[1]) if match
      end
      "match"
    end

    def typography_from_source(source)
      value = front_matter_value(source, "typography", default: nil) { |raw| raw }
      return "book" unless value

      normalize_typography_value(value)
    end

    def style_overrides(source)
      {
        theme: normalized_override(source, "theme", method(:normalize_theme_value)),
        typography: normalized_override(source, "typography", method(:normalize_typography_value))
      }
    end

    def margin_settings_from_source(source)
      settings = { section: true, subsection: true, footnote: true, slide_count: true }
      front_matter = initial_front_matter(source)
      return MarginSettings.new(**settings) unless front_matter

      in_margin_settings = false
      front_matter.lines[1...front_matter.closing_line].each do |line|
        if line.text.match?(/\Ashow-in-margin\s*:\s*\z/)
          in_margin_settings = true
        elsif in_margin_settings && (match = line.text.match(/\A\s+([A-Za-z][\w-]*)\s*:\s*(true|false)\s*\z/))
          key = match[1].tr("-", "_").gsub(/([A-Z])/, '_\\1').downcase.sub(/\A_/, "")
          settings[key.to_sym] = match[2] == "true" if settings.key?(key.to_sym)
        elsif line.text.match?(/\A\S/)
          in_margin_settings = false
        end
      end

      MarginSettings.new(**settings)
    end

    def with_front_matter_value(source, key, value)
      return remove_front_matter_value(source, key) if value.nil?

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

    def remove_front_matter_value(source, key)
      normalized_source = source.to_s
      front_matter = initial_front_matter(normalized_source)
      return normalized_source unless front_matter

      lines = source_lines(normalized_source)
      matching_line = (1...front_matter.closing_line).find do |index|
        lines[index].text.match?(/\A\s*#{Regexp.escape(key)}\s*:/)
      end
      return normalized_source unless matching_line

      line = lines[matching_line]
      updated = normalized_source.dup
      updated[line.start...line.end_pos] = ""
      remaining = updated.lines
      if remaining.length >= 2 && remaining.first.to_s.strip == "---" && remaining[1].to_s.strip == "---"
        closing = remaining[1]
        return updated[(remaining.first.length + closing.length)..].to_s.sub(/\A\r?\n/, "")
      end
      updated
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

    def replace_first_h1(source, title)
      normalized_source = source.to_s
      normalized_title = title.to_s.tr("\r\n", " ").squish
      front_matter = initial_front_matter(normalized_source)
      body_start = front_matter&.body_start || 0
      fence = nil

      source_lines(normalized_source).each do |line|
        next if line.end_pos <= body_start

        incoming_fence = fence_marker(line.text)
        if fence
          fence = toggle_fence(fence, incoming_fence) if incoming_fence
          next
        elsif incoming_fence
          fence = incoming_fence
          next
        end

        heading = line.text.match(/\A([ \t]{0,3}#)(?:[ \t]+|(?=\z)).*\z/)
        next unless heading

        updated = normalized_source.dup
        updated[line.start...line.end_pos] = "#{heading[1]} #{normalized_title}#{line.ending}"
        return updated
      end

      body = normalized_source[body_start..].to_s
      prefix = normalized_source[0...body_start].to_s
      eol = if normalized_source.include?("\r\n")
        "\r\n"
      elsif normalized_source.include?("\r")
        "\r"
      else
        "\n"
      end
      separator = body.blank? ? "" : eol * 2
      "#{prefix}# #{normalized_title}#{separator}#{body}"
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

    # Build the short-lived source projection used by the visual editor. The
    # renderer deliberately works with the parsed document above, while this
    # map points back into the original source so visual edits can replace the
    # smallest possible range. JavaScript uses UTF-16 offsets, which is also
    # the coordinate system used by CodeMirror and browser strings.
    def editor_map(source, source_name: "Untitled presentation", mode: :presentation)
      raise ArgumentError, "The selected file did not contain readable text." unless source.is_a?(String)

      mode = mode.to_sym
      raise ArgumentError, "Unsupported document mode" unless %i[presentation document].include?(mode)

      previous_offsets = Thread.current[:elef_editor_utf16_offsets]
      offsets = [0]
      source.each_codepoint { |codepoint| offsets << offsets[-1] + (codepoint > 0xFFFF ? 2 : 1) }
      Thread.current[:elef_editor_utf16_offsets] = [source, offsets]
      parsed = parse(source, source_name: source_name, mode: mode)
      front_matter = initial_front_matter(source)
      slide_ranges = if mode == :document
        [{ index: 0, start: front_matter&.body_start || 0, end: source.length, delimiter_start: nil, delimiter_end: nil }]
      else
        slide_source_ranges(source)
      end
      map = {
        version: 1,
        source_name: source_name.to_s,
        mode: mode.to_s,
        source_length: utf16_length(source),
        front_matter: front_matter && {
          range: utf16_range(source, 0, front_matter.body_start),
          body_start: utf16_index(source, front_matter.body_start)
        },
        slides: [],
        directives: [],
        editable_regions: []
      }

      slide_ranges.each_with_index do |slide_range, index|
        slide = parsed.slides[index]
        blocks, directives, regions = editor_blocks(
          source,
          slide_range[:start],
          slide_range[:end],
          slide,
          index,
          mode: mode
        )
        if mode == :document
          empty_blocks = empty_editor_blocks(source, index, blocks)
          blocks = (blocks + empty_blocks.map(&:first)).sort_by { |block| block[:range][:start] }
          regions.concat(empty_blocks.map(&:last))
        end
        slide_map = {
          id: "slide-#{index + 1}",
          index: index,
          layout: slide&.layout || "body",
          range: utf16_range(source, slide_range[:start], slide_range[:end]),
          source_range: utf16_range(source, slide_range[:start], slide_range[:end]),
          delimiter_range: if slide_range[:delimiter_start]
            utf16_range(source, slide_range[:delimiter_start], slide_range[:delimiter_end])
          end,
          blocks: blocks,
          directives: directives,
          editable_regions: regions
        }
        map[:slides] << slide_map
        map[:directives].concat(directives)
        map[:editable_regions].concat(regions)
      end

      map
    ensure
      Thread.current[:elef_editor_utf16_offsets] = previous_offsets if defined?(previous_offsets)
    end

    def editor_blocks(source, start_pos, end_pos, slide, slide_index, mode: :presentation)
      section = source[start_pos...end_pos].to_s
      lines = source_lines(section)
      blocks = []
      directives = []
      regions = []
      current = []
      pending_position = nil
      fence = nil

      flush = lambda do
        next if current.empty?

        first = current.first
        last = current.last
        block_start = start_pos + first.start
        block_end = start_pos + last.end_pos
        markdown = source[block_start...block_end].to_s.sub(/\r\n?\z|\n\z/, "")
        block_index = blocks.length
        block_id = "slide-#{slide_index + 1}-block-#{block_index + 1}"
        kind = editable_block_kind(markdown)
        block = {
          id: block_id,
          index: block_index,
          kind: kind,
          markdown: markdown,
          position: pending_position && pending_position[:value],
          position_directive_id: pending_position && pending_position[:directive_id],
          position_scope: pending_position && (pending_position[:scoped] ? "group" : "block"),
          range: utf16_range(source, block_start, block_end),
          source_range: utf16_range(source, block_start, block_end),
          content_range: utf16_range(source, block_start, block_start + markdown.length)
        }
        blocks << block

        region = editable_region_for_block(
          source,
          block_start,
          markdown,
          block_id,
          slide_index,
          block_index,
          kind,
          slide,
          mode
        )
        regions << region
        block[:editable_region_id] = region[:id]
        current = []
        pending_position = nil if pending_position && !pending_position[:scoped]
      end

      lines.each_with_index do |line, line_index|
        incoming_fence = fence_marker(line.text)
        if fence
          current << line
          fence = toggle_fence(fence, incoming_fence) if incoming_fence
          next
        elsif incoming_fence
          current << line
          fence = incoming_fence
          next
        end

        if line.text.blank?
          flush.call
          next
        end

        if line.text.match?(/\A\s*:::/)
          flush.call
          directive_text = line.text.strip
          directive = editor_directive(
            source,
            start_pos + line.start,
            start_pos + line.end_pos,
            directive_text,
            slide_index,
            directives.length
          )
          directives << directive
          if (position = position_from_block(directive_text))
            pending_position = {
              value: position_payload(position),
              directive_id: directive[:id],
              scoped: position_scope_closes?(lines, line_index)
            }
          elsif directive_text == ":::" && pending_position
            pending_position = nil
          end
          next
        end

        current << line
      end
      flush.call

      # `parse_blocks` removes margin directives before building its blocks.
      # Keep the map honest when a source line was a directive but the parser
      # did not expose a corresponding editable block.
      if mode == :document
        directives.each { |directive| directive[:scope] = "document" }
      end

      [blocks, directives, regions]
    end

    def position_scope_closes?(lines, start_index)
      fence = nil
      lines[(start_index + 1)..].to_a.each do |line|
        incoming_fence = fence_marker(line.text)
        if fence
          fence = toggle_fence(fence, incoming_fence) if incoming_fence
          next
        elsif incoming_fence
          fence = incoming_fence
          next
        end

        return true if line.text.strip == ":::"
        return false if line.text.match?(/\A\s*:::position[ \t]*\{/)
      end
      false
    end

    def editor_directive(source, start_pos, end_pos, text, slide_index, directive_index)
      position_match = text.match(/\A:::position[ \t]*\{([^}]*)\}/)
      margin_match = text.match(/\A:::(section|subsection|footnote)\{/)
      type = if text == ":::"
        "position_close"
      elsif position_match
        "position"
      elsif margin_match
        margin_match[1]
      else
        "unknown"
      end
      value = position_match && position_match[1]
      {
        id: "slide-#{slide_index + 1}-directive-#{directive_index + 1}",
        type: type,
        value: value&.strip,
        text: text,
        range: utf16_range(source, start_pos, end_pos),
        source_range: utf16_range(source, start_pos, end_pos),
        editable: type == "position"
      }
    end

    def editable_region_for_block(source, block_start, markdown, block_id, slide_index, block_index, kind, slide, mode)
      editable = client_can_round_trip?(markdown, kind)
      heading = markdown.match(/\A(\s{0,3})(#+)(\s+)(.+?)(\s*#*\s*)\z/m)
      if heading
        text_start = block_start + heading.begin(4)
        text_end = block_start + heading.end(4)
        return {
          id: "slide-#{slide_index + 1}-region-#{block_index + 1}",
          block_id: block_id,
          role: (mode == :document && block_index.zero?) || slide&.title == markdown ? "title" : "heading",
          kind: "heading",
          text: heading[4].strip,
          range: utf16_range(source, block_start, block_start + markdown.length),
          source_range: utf16_range(source, block_start, block_start + markdown.length),
          content_range: utf16_range(source, text_start, text_end),
          editable: editable
        }
      end

      empty_heading = markdown.match(/\A(\s{0,3}#)[ \t]*\z/)
      if empty_heading
        text_start = block_start + empty_heading.end(0)
        return {
          id: "slide-#{slide_index + 1}-region-#{block_index + 1}",
          block_id: block_id,
          role: "title",
          kind: "heading",
          text: "",
          range: utf16_range(source, block_start, block_start + markdown.length),
          source_range: utf16_range(source, block_start, block_start + markdown.length),
          content_range: utf16_range(source, text_start, text_start),
          editable: editable,
          empty_heading: true
        }
      end

      {
        id: "slide-#{slide_index + 1}-region-#{block_index + 1}",
        block_id: block_id,
        role: "block",
        kind: kind,
        text: markdown,
        range: utf16_range(source, block_start, block_start + markdown.length),
        source_range: utf16_range(source, block_start, block_start + markdown.length),
        content_range: utf16_range(source, block_start, block_start + markdown.length),
        editable: editable
      }
    end

    def editable_block_kind(markdown)
      return "heading" if heading_for(markdown)
      return "heading" if markdown.match?(/\A\s{0,3}#[ \t]*\z/)
      return "code" if fenced_code_source?(markdown) || indented_code_source?(markdown)
      return "image" if image_block?(markdown)
      return "table" if table_block?(markdown)
      return "list" if markdown.match?(/\A\s*(?:[-*+] |\d+[.)] )/)
      return "quote" if markdown.match?(/\A\s*>/)
      return "rule" if markdown.match?(/\A\s*(?:-{3,}|\*{3,}|_{3,})\s*\z/)

      "paragraph"
    end

    def empty_editor_blocks(source, slide_index, blocks)
      placeholders = []
      sequence = 0

      blocks.each_cons(2) do |previous, following|
        start_index = character_index_for_utf16(source, previous[:content_range][:end])
        end_index = character_index_for_utf16(source, following[:range][:start])
        separator = source[start_index...end_index].to_s
        next unless separator.match?(/\A[ \t]*(?:(?:\r\n|\r|\n)[ \t]*)*\z/)

        line_endings = separator.scan(/\r\n|\r|\n/)
        empty_count = [line_endings.length / 2 - 1, 0].max
        1.upto(empty_count) do |empty_index|
          character_offset = start_index + line_endings.take(empty_index * 2).sum(&:length)
          sequence += 1
          placeholders << empty_editor_block(source, slide_index, sequence, character_offset)
        end
      end

      trailing_source = source[/((?:\r\n|\r|\n)+)\z/, 1].to_s
      trailing_endings = trailing_source.scan(/\r\n|\r|\n/)
      trailing_count = trailing_endings.length / 2
      trailing_start = source.length - trailing_source.length
      1.upto(trailing_count) do |empty_index|
        character_offset = trailing_start + trailing_endings.take(empty_index * 2).sum(&:length)
        sequence += 1
        placeholders << empty_editor_block(source, slide_index, sequence, character_offset)
      end

      placeholders
    end

    def empty_editor_block(source, slide_index, sequence, character_offset)
      offset = utf16_index(source, character_offset)
      block_id = "slide-#{slide_index + 1}-empty-#{sequence}"
      region_id = "slide-#{slide_index + 1}-empty-region-#{sequence}"
      range = { start: offset, end: offset }
      block = {
        id: block_id,
        index: sequence,
        kind: "paragraph",
        markdown: "",
        range: range.dup,
        source_range: range.dup,
        content_range: range.dup,
        editable_region_id: region_id,
        empty_placeholder: true
      }
      region = {
        id: region_id,
        block_id: block_id,
        role: "block",
        kind: "paragraph",
        text: "",
        range: range.dup,
        source_range: range.dup,
        content_range: range.dup,
        editable: true,
        empty_placeholder: true
      }
      [block, region]
    end

    def client_can_round_trip?(markdown, kind)
      return supported_fenced_code_block?(markdown) if kind == "code" && fenced_code_source?(markdown)
      return false if kind == "code" || kind == "rule"
      return false if kind == "heading" && markdown.lines.length != 1
      return false if kind == "table" && !supported_table_block?(markdown)
      return false if kind == "quote" && markdown.lines.any? { |line| line.match?(/\A[ \t]*>[ \t]*>/) }
      return false if kind != "image" && markdown.match?(/!\[[^\]]*\]\(elef-asset:[0-9a-f]{64}(?:\s+[^)]*)?\)/)
      return false if markdown.match?(/\A[^\r\n]+\r?\n[=-]{3,}[ \t]*\z/)
      return false if unsupported_block_syntax?(markdown)

      true
    end

    def supported_fenced_code_block?(markdown)
      match = markdown.match(/\A([ \t]*)(`{3,}|~{3,})([^\r\n]*?)(\r\n|\n|\r)([\s\S]*?)(\r\n|\n|\r)([`~]{3,})([ \t]*)\z/)
      return false unless match

      opening = match[2]
      closing = match[7]
      closing[0] == opening[0] && closing.each_char.all? { |character| character == opening[0] } && closing.length >= opening.length
    end

    def supported_table_block?(markdown)
      lines = markdown.split(/\r?\n/)
      return false if lines.length < 3
      return false unless lines[1].match?(/\A\s*\|?\s*:?-{3,}:?\s*(?:\|\s*:?-{3,}:?\s*)*\|?\s*\z/)

      columns = table_cell_count(lines.first)
      columns.positive? && table_cell_count(lines[1]) == columns && lines.drop(2).all? do |line|
        !line.blank? && table_cell_count(line) == columns
      end
    end

    def table_cell_count(line)
      value = line.to_s.strip
      pipe_positions = []
      escaped = false
      value.each_char.with_index do |character, index|
        if character == "\\" && !escaped
          escaped = true
          next
        end
        pipe_positions << index if character == "|" && !escaped
        escaped = false
      end

      leading_pipe = pipe_positions.first == 0 ? 1 : 0
      trailing_pipe = pipe_positions.last == value.length - 1 ? 1 : 0
      [pipe_positions.length - leading_pipe - trailing_pipe + 1, 0].max
    end

    def unsupported_block_syntax?(markdown)
      return true if markdown.match?(/<\s*!--|--\s*>|<\/?[A-Za-z][^>]*>/)
      return true if markdown.match?(/<\s*(?:https?:\/\/|mailto:)[^>]+>|<\s*[^<>\s@]+@[^<>\s@]+\s*>/i)
      return true if markdown.match?(/\[[^\]]+\]\s*\[[^\]]*\]|^\s*\[[^\]]+\]:|\[\^[^\]]+\]/)
      return true if markdown.match?(/&(?:[A-Za-z][A-Za-z0-9]+|#\d+|#x[0-9A-Fa-f]+);/)
      return true if markdown.match?(/\]\([^)]*\(/)
      return true if markdown.match?(/[[:alnum:]][_*]{1,2}[^\s*_]+?[*_]{1,2}[[:alnum:]]/)
      return true if markdown.lines.any? { |line| line.match?(/(?: {2,}|\\)\r?\n?\z/) }
      return true if unsupported_escaped_punctuation?(markdown)

      false
    end

    def unsupported_escaped_punctuation?(markdown)
      without_math = markdown.gsub(/(?<!\\)\$\$[\s\S]+?\$\$(?!\$)|(?<![\\$])\$(?!\$|\s)[^$\r\n]+?(?<!\s)\$(?!\$)/, "")
      without_math.each_char.with_index.any? do |character, index|
        next false unless character == "\\"

        next_character = without_math[index + 1]
        next false if next_character.nil? || next_character == "$" || next_character.match?(/[[:alnum:]_[:space:]]/)

        true
      end
    end

    def fenced_code_source?(markdown)
      fence_marker(markdown.lines.first.to_s.chomp).present?
    end

    def indented_code_source?(markdown)
      markdown.match?(/\A(?: {4}|\t)/)
    end

    def position_payload(position)
      {
        horizontal: position.horizontal,
        vertical: position.vertical,
        vertical_explicit: position.vertical_explicit
      }
    end

    def utf16_length(value)
      value.to_s.encode("UTF-16LE").bytesize / 2
    end

    def utf16_index(source, character_index)
      cached = Thread.current[:elef_editor_utf16_offsets]
      return cached[1][character_index] if cached && cached[0].equal?(source) && character_index.between?(0, cached[1].length - 1)

      utf16_length(source.to_s[0...character_index].to_s)
    end

    def character_index_for_utf16(source, offset)
      cached = Thread.current[:elef_editor_utf16_offsets]
      if cached && cached[0].equal?(source)
        index = cached[1].bsearch_index { |width| width >= offset }
        return index if index && cached[1][index] == offset
        return index ? index - 1 : source.length
      end

      units = 0
      index = 0
      source.to_s.each_char do |character|
        width = utf16_length(character)
        break if units + width > offset

        units += width
        index += 1
        break if units == offset
      end
      index
    end

    def utf16_range(source, start_pos, end_pos)
      {
        start: utf16_index(source, start_pos),
        end: utf16_index(source, end_pos)
      }
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

    def normalized_override(source, key, normalizer)
      value = front_matter_value(source, key, default: nil) { |raw| raw }
      return unless value

      normalized = normalizer.call(value)
      return normalized if normalized == value.to_s.strip.sub(/\s+#.*\z/, "").strip.sub(/\A(['"])(.*)\1\z/, '\2')

      nil
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
      match = line.match(/\A\s{0,3}(`{3,}|~{3,})(.*)\z/)
      return unless match

      { marker: match[1][0], length: match[1].length, closing: match[2].match?(/\A[ \t]*\z/) }
    end

    def toggle_fence(current, incoming)
      return incoming unless current
      return nil if current[:marker] == incoming[:marker] &&
        incoming[:length] >= current[:length] && incoming[:closing]

      current
    end

    def slide_metadata(markdown, context, mode: :presentation)
      normalized = markdown.gsub(/\r\n?/, "\n")
      margin = if mode == :presentation
        parse_margin_directives(normalized, context)
      else
        { content: normalized, section: nil, subsection: nil, footnote: nil, warnings: [] }
      end
      normalized = margin[:content]
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
        section: margin[:section],
        subsection: margin[:subsection],
        footnote: margin[:footnote],
        warnings: margin[:warnings] + parsed[:warnings]
      }
    end

    def parse_margin_directives(markdown, context)
      lines = markdown.split("\n", -1)
      content = []
      warnings = []
      leading = true
      fence = nil
      footnote = nil

      lines.each_with_index do |line, index|
        incoming_fence = fence_marker(line)
        if fence
          content << line
          fence = toggle_fence(fence, incoming_fence) if incoming_fence
          next
        elsif incoming_fence
          content << line
          fence = incoming_fence
          leading = false
          next
        end

        directive = margin_directive_from_line(line)
        if directive
          if directive[:malformed]
            warnings << "Malformed #{directive[:type]} margin directive was removed."
          elsif directive[:type] == "footnote"
            if lines[(index + 1)..].to_a.all?(&:blank?)
              footnote = directive[:value]
            else
              warnings << "Footnote margin directive must appear at the end of a slide."
            end
          elsif leading
            context[directive[:type].to_sym] = directive[:value]
          else
            warnings << "#{directive[:type].capitalize} margin directive must appear at the beginning of a slide."
          end
          next
        end

        leading = false unless line.blank?
        content << line
      end

      {
        content: content.join("\n"),
        section: context[:section],
        subsection: context[:subsection],
        footnote: footnote,
        warnings: warnings
      }
    end

    def margin_directive_from_line(line)
      match = line.match(/\A\s*:::(section|subsection|footnote)\{/)
      return unless match

      characters = line[match.end(0)..].to_s.chars
      value = []
      depth = 1
      index = 0

      while index < characters.length
        character = characters[index]
        if character == "\\" && characters[index + 1] && %w[{ } \\].include?(characters[index + 1])
          value << characters[index + 1]
          index += 2
          next
        elsif character == "{"
          depth += 1
          value << character
        elsif character == "}"
          depth -= 1
          if depth.zero?
            return { type: match[1], value: value.join.strip } if characters[(index + 1)..].join.strip.blank?

            return { type: match[1], malformed: true }
          end
          value << character
        else
          value << character
        end
        index += 1
      end

      { type: match[1], malformed: true }
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
      match = block.match(/\A\s*:::position[ \t]*\{([^}]*)\}\s*\z/)
      return unless match

      values = match[1].split.map(&:downcase)
      horizontal = values.find { |value| %w[left center right].include?(value) }
      vertical = values.find { |value| %w[top middle bottom].include?(value) }
      return unless horizontal || vertical

      Position.new(horizontal || "left", vertical || "top", vertical.present?)
    end

    def infer_layout(blocks)
      meaningful = blocks.reject { |block| block.markdown.blank? }
      return "body" if meaningful.empty?
      return "image" if meaningful.length == 1 && image_block?(meaningful.first.markdown)

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
      opening = markdown.lines.first.to_s.match(/\A\s*([`~]{3,})/)
      closing = markdown.lines.last.to_s.match(/\A\s*([`~]{3,})\s*\z/)
      opening && closing && opening[1][0] == closing[1][0] && closing[1].length >= opening[1].length
    end

    def prose_block?(markdown)
      !markdown.match?(/\A\s*(?:[-*+] |\d+[.)] |> |!\[|\||`{3,}|~{3,})/)
    end
  end
end
