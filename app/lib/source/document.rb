require "json"
require "set"

module Source
  module Document
    PORTABLE_DOCUMENT_KEY = "elef_document_key".freeze
    PORTABLE_DOCUMENT_ALIASES = "elef_aliases".freeze
    Position = Data.define(:horizontal, :vertical, :vertical_explicit)
    Block = Data.define(:markdown, :position, :art, :reveal_event) do
      def initialize(attributes)
        super(**{ art: nil, reveal_event: nil, **attributes })
      end
    end
    Region = Data.define(:blocks)
    MarginSettings = Data.define(:section, :subsection, :footnote, :slide_count)
    Slide = Data.define(:id, :index, :markdown, :layout, :blocks, :title, :regions, :section, :subsection, :footnote, :warnings, :art_diagnostics) do
      def initialize(attributes)
        super(**{ art_diagnostics: [], **attributes })
      end

      def reveal_event_count
        blocks.filter_map(&:reveal_event).uniq.length
      end
    end
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
        # The shared resolver owns both directive bindings and Markdown block
        # boundaries. Reuse its result in margin parsing and block splitting.
        art_resolution = Source::JavascriptRenderer.resolve_art_bindings(section)
        metadata = slide_metadata(section, context, mode: mode, art_resolution: art_resolution)
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
          warnings: metadata[:warnings],
          art_diagnostics: metadata[:art_diagnostics]
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
      math_fence = nil

      normalized.split("\n", -1).each do |line|
        next_fence = fence_marker(line)
        fence = toggle_fence(fence, next_fence) if next_fence

        if fence.nil? && math_fence
          math_fence = nil if display_math_fence_marker(line) == math_fence
          section << line
          next
        elsif fence.nil? && (opening_math_fence = display_math_fence_opener(line))
          math_fence = opening_math_fence
          section << line
          next
        end

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
      normalized_override(source, "theme", method(:normalize_theme_value)) || "match"
    end

    def typography_from_source(source)
      normalized_override(source, "typography", method(:normalize_typography_value)) || "book"
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

    def portable_document_link_metadata(source)
      key = parse_front_matter_json(source, PORTABLE_DOCUMENT_KEY)
      aliases = parse_front_matter_json(source, PORTABLE_DOCUMENT_ALIASES)
      {
        document_key: key.is_a?(String) && key.present? ? key : nil,
        aliases: aliases.is_a?(Array) ? aliases.select { |value| value.is_a?(String) && value.present? }.map(&:strip).uniq : []
      }
    end

    def with_portable_document_link_metadata(source, document_key:, aliases:)
      normalized_key = document_key.to_s.presence
      normalized_aliases = Array(aliases).filter_map { |value| value.to_s.strip.presence }.uniq
      updated = with_front_matter_value(
        source.to_s,
        PORTABLE_DOCUMENT_KEY,
        normalized_key && JSON.generate(normalized_key)
      )
      with_front_matter_value(
        updated,
        PORTABLE_DOCUMENT_ALIASES,
        normalized_aliases.empty? ? nil : JSON.generate(normalized_aliases)
      )
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
      math_fence = nil

      source_lines(source).each do |line|
        next if line.end_pos <= body_start

        next_fence = fence_marker(line.text)
        fence = toggle_fence(fence, next_fence) if next_fence

        if fence.nil? && math_fence
          math_fence = nil if display_math_fence_marker(line.text) == math_fence
          next
        elsif fence.nil? && (opening_math_fence = display_math_fence_opener(line.text))
          math_fence = opening_math_fence
          next
        end

        if fence.nil? && line.text.match?(/\A---[ \t]*\z/)
          ranges << { index: ranges.length, start: slide_start, end: line.start, delimiter_start: line.start, delimiter_end: line.end_pos }
          slide_start = line.end_pos
        end
      end

      ranges << { index: ranges.length, start: slide_start, end: source.length, delimiter_start: nil, delimiter_end: nil }
      ranges
    end

    # Build the short-lived source projection used by the visual editor. The
    # shared JavaScript parser maps back into the original source so visual
    # edits can replace the smallest possible range. JavaScript and CodeMirror
    # both use UTF-16 offsets.
    def editor_map(source, source_name: "Untitled presentation", mode: :presentation)
      Source::JavascriptRenderer.editor_map(source, source_name: source_name, mode: mode)
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

      eol = lines.find { |line| !line.ending.empty? }&.ending || "\n"
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

    def parse_front_matter_json(source, key)
      raw = front_matter_value(source, key, default: nil) { |value| value }
      JSON.parse(raw) if raw.present?
    rescue JSON::ParserError
      nil
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

    def display_math_fence_marker(line)
      line.match(/\A[ \t]{0,3}(\$\$|\\\[|\\\])[ \t]*\z/)&.[](1)
    end

    def display_math_fence_opener(line)
      marker = display_math_fence_marker(line)
      return "$$" if marker == "$$"
      return "\\]" if marker == "\\["

      inline_display_opener = line.match(/\A[ \t]{0,3}\$\$[ \t]*(\S.*)\z/)
      "$$" if inline_display_opener && !inline_display_opener[1].include?("$$")
    end

    def display_math_fence_source?(markdown)
      lines = markdown.to_s.split(/\r\n|\r|\n/, -1)
      opener = display_math_fence_opener(lines.first.to_s)
      return false unless opener
      return true if lines.length == 1

      display_math_fence_marker(lines.last.to_s) == opener
    end

    def toggle_fence(current, incoming)
      return incoming unless current
      return nil if current[:marker] == incoming[:marker] &&
        incoming[:length] >= current[:length] && incoming[:closing]

      current
    end

    def slide_metadata(markdown, context, mode: :presentation, art_resolution: { directives: [], bindings: [], diagnostics: [] })
      normalized = markdown.gsub(/\r\n?/, "\n")
      margin = if mode == :presentation
        parse_margin_directives(normalized, context, art_resolution)
      else
        { content: normalized, section: nil, subsection: nil, footnote: nil, warnings: [] }
      end
      reveals = resolve_reveal_groups(normalized, mode, art_resolution)
      normalized = margin[:content]
      lines = normalized.split("\n", -1)
      art_resolution[:directives].each { |directive| lines[directive[:line]] = "" }
      reveals[:directive_lines].each { |line| lines[line] = "" }
      parsed = parse_blocks(lines.join("\n"), art_resolution, reveals)
      art_warnings = art_resolution[:diagnostics].map { |diagnostic| art_diagnostic_message(diagnostic[:code]) }
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
        warnings: margin[:warnings] + reveals[:warnings] + parsed[:warnings] + art_warnings,
        reveal_event_count: parsed[:reveal_event_count] || 0,
        art_diagnostics: art_resolution[:diagnostics]
      }
    end

    def parse_margin_directives(markdown, context, art_resolution)
      lines = markdown.split("\n", -1)
      directive_lines = art_resolution.dig(:boundary_map, :directiveLines).to_set
      blank_lines = art_resolution.dig(:boundary_map, :blankLines).to_set
      content = []
      warnings = []
      leading = true
      fence = nil
      math_fence = nil
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
        elsif math_fence
          math_fence = nil if display_math_fence_marker(line) == math_fence
          content << line
          next
        elsif (opening_math_fence = display_math_fence_opener(line))
          math_fence = opening_math_fence
          content << line
          leading = false
          next
        end

        directive = directive_lines.include?(index) ? margin_directive_from_line(line) : nil
        if directive
          content << ""
          if directive[:malformed]
            warnings << "Malformed #{directive[:type]} margin directive was removed."
          elsif directive[:type] == "footnote"
            if (index + 1...lines.length).all? { |following| blank_lines.include?(following) }
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

        leading = false unless blank_lines.include?(index)
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

    def parse_blocks(markdown, art_resolution = { bindings: [] }, reveals = nil)
      raw_blocks = markdown_blocks(markdown, art_resolution)
      return parse_blocks_legacy(raw_blocks, art_resolution) unless reveals && !reveals[:directive_lines].empty?

      parse_blocks_with_reveals(raw_blocks, art_resolution, reveals)
    end

    def parse_blocks_legacy(raw_blocks, art_resolution)
      blocks = []
      warnings = []
      index = 0

      while index < raw_blocks.length
        record = raw_blocks[index]
        block = record[:markdown]
        position = position_from_block(block)
        if position
          closing_index = raw_blocks[(index + 1)..]&.index { |candidate| candidate[:markdown] == ":::" }
          if closing_index
            closing_index += index + 1
            grouped = raw_blocks[(index + 1)...closing_index]
            grouped.each { |group| blocks << parsed_block(group, position, art_resolution, nil) unless group[:markdown] == "" }
            index = closing_index + 1
          elsif raw_blocks[index + 1]
            blocks << parsed_block(raw_blocks[index + 1], position, art_resolution, nil)
            index += 2
          else
            warnings << "Alignment directive has no following Markdown block."
            index += 1
          end
        elsif block == ":::" || block.start_with?(":::")
          warnings << "Unknown or malformed presentation directive was removed."
          index += 1
        else
          blocks << parsed_block(record, nil, art_resolution, nil)
          index += 1
        end
      end

      { blocks: blocks, warnings: warnings }
    end

    def parse_blocks_with_reveals(raw_blocks, art_resolution, reveals)
      blocks = []
      warnings = []
      scoped_position = nil
      index = 0

      while index < raw_blocks.length
        record = raw_blocks[index]
        block = record[:markdown]
        if block == ":::"
          warnings << "Unknown or malformed presentation directive was removed." unless scoped_position
          scoped_position = nil
          index += 1
          next
        end

        position = position_from_block(block)
        if position
          positions = [position]
          last_record = record
          index += 1
          while index < raw_blocks.length && (stacked_position = position_from_block(raw_blocks[index][:markdown]))
            positions << stacked_position
            last_record = raw_blocks[index]
            index += 1
          end
          selected_position = positions.last
          if position_scope_closes_in_lines?(reveals[:lines], last_record[:start_line])
            scoped_position = selected_position
          else
            scoped_position = nil
            if raw_blocks[index]
              blocks << parsed_block(raw_blocks[index], selected_position, art_resolution, reveals[:event_by_line])
              index += 1
            else
              warnings << "Alignment directive has no following Markdown block."
            end
          end
          next
        end

        if block.start_with?(":::")
          warnings << "Unknown or malformed presentation directive was removed."
          index += 1
          next
        end

        blocks << parsed_block(record, scoped_position, art_resolution, reveals[:event_by_line])
        index += 1
      end

      { blocks: blocks, warnings: warnings, reveal_event_count: reveals[:event_count] }
    end

    def parsed_block(record, position, art_resolution, event_by_line)
      binding = art_resolution[:bindings].find do |candidate|
        candidate[:target_lines][:start] == record[:start_line]
      end
      art = if binding
        {
          directive_id: binding[:directive_id],
          source_range: binding[:directive_range],
          **binding[:analysis]
        }
      end
      reveal_event = event_by_line && event_by_line[record[:start_line]]
      Block.new(markdown: record[:markdown], position: position, art: art, reveal_event: reveal_event)
    end

    def resolve_reveal_groups(markdown, mode, art_resolution)
      empty = { event_by_line: {}, event_count: 0, directive_lines: [], warnings: [], lines: markdown.split("\n", -1) }
      return empty unless mode == :presentation

      lines = markdown.split("\n", -1)
      directive_lines = art_resolution.dig(:boundary_map, :directiveLines).to_set
      blank_lines = art_resolution.dig(:boundary_map, :blankLines).to_set
      art_lines = art_resolution[:directives].map { |directive| directive[:line] }.to_set
      event_by_line = {}
      consumed = []
      warnings = []
      pending = []
      current = []
      event_ordinals = {}

      warn_conflicts = lambda do
        labels = pending.map { |step| step[:label].nil? ? "plain" : "label:#{canonical_step_label(step[:label])}" }.uniq
        warnings << "Conflicting step directives in one stack; the last valid step directive takes effect." if labels.length > 1
      end
      orphan = lambda do
        unless pending.empty?
          warn_conflicts.call
          warnings << "Step directive has no following contiguous Markdown group; place content immediately below it without a blank line."
          pending = []
        end
      end
      flush = lambda do
        unless current.empty?
          warn_conflicts.call
          step = pending.last
          if step
            identity = step[:label].nil? ? "plain:#{step[:sequence]}" : "label:#{canonical_step_label(step[:label])}"
            event_ordinals[identity] ||= event_ordinals.length
            ordinal = event_ordinals.fetch(identity)
            current.each { |line_index| event_by_line[line_index] = ordinal }
          end
          current = []
          pending = []
        end
      end

      step_sequence = 0
      lines.each_with_index do |line, line_index|
        step = directive_lines.include?(line_index) ? step_directive_for_line(line) : nil
        if step&.fetch(:kind) == :step
          flush.call
          consumed << line_index
          step_sequence += 1
          pending << step.merge(sequence: step_sequence)
          next
        elsif step&.fetch(:kind) == :malformed
          flush.call
          consumed << line_index
          warnings << "Malformed step directive was removed; use :::step or :::step{N} on its own line."
          next
        elsif step&.fetch(:kind) == :indented_code
          current << line_index
          next
        end

        if blank_lines.include?(line_index)
          flush.call
          orphan.call
          next
        end

        if directive_lines.include?(line_index)
          if line.match?(/\A {0,3}:::[ \t]*\z/)
            flush.call
            orphan.call
            next
          end

          compatible = position_from_block(line) || art_lines.include?(line_index) || line.match?(/\A\s*:::(?:section|subsection|footnote)\{/)
          unless compatible
            flush.call
            orphan.call
          end
          consumed << line_index if step
          next
        end

        current << line_index
      end
      flush.call
      orphan.call

      {
        event_by_line: event_by_line,
        event_count: event_ordinals.length,
        directive_lines: consumed,
        warnings: warnings,
        lines: lines
      }
    end

    def canonical_step_label(label)
      label.sub(/\A0+/, "").presence || "0"
    end

    def step_directive_for_line(line)
      return { kind: :indented_code } if line.match?(/\A {4,}:::step(?=\z|[^A-Za-z0-9_-])/)
      return unless line.match?(/\A[ \t]*:::step(?=\z|[^A-Za-z0-9_-])/)

      match = line.match(/\A {0,3}:::step(?:\{([0-9]+)\})?[ \t]*\z/)
      match ? { kind: :step, label: match[1] } : { kind: :malformed }
    end

    def position_scope_closes_in_lines?(lines, start_index)
      fence = nil
      math_fence = nil
      lines[(start_index + 1)..].to_a.each do |line|
        incoming_fence = fence_marker(line)
        if fence
          fence = toggle_fence(fence, incoming_fence) if incoming_fence
          next
        elsif incoming_fence
          fence = incoming_fence
          next
        elsif math_fence
          math_fence = nil if display_math_fence_marker(line) == math_fence
          next
        elsif (opening_math_fence = display_math_fence_opener(line))
          math_fence = opening_math_fence
          next
        end

        return true if line.match?(/\A {0,3}:::[ \t]*\z/)
        return false if position_from_block(line)
      end
      false
    end

    def markdown_blocks(markdown, art_resolution = { bindings: [] })
      blocks = []
      boundary = art_resolution.fetch(:boundary_map)
      block_starts = boundary[:blockStarts].to_set
      block_ends = boundary[:blockEnds].to_set
      directive_lines = boundary[:directiveLines].to_set
      blank_lines = boundary[:blankLines].to_set
      current = []
      current_start_line = nil
      current_end_line = nil
      fence = nil
      math_fence = nil

      flush = lambda do
        unless current.empty?
          blocks << { markdown: current.join("\n"), start_line: current_start_line, end_line: current_end_line }
          current = []
          current_start_line = nil
          current_end_line = nil
        end
      end
      push_line = lambda do |line, line_index|
        current_start_line ||= line_index
        current << line
        current_end_line = line_index + 1
      end
      markdown.split("\n", -1).each_with_index do |line, line_index|
        flush.call if block_starts.include?(line_index) && current.any?
        next_fence = fence_marker(line)
        fence = toggle_fence(fence, next_fence) if next_fence

        if fence.nil? && math_fence
          push_line.call(line, line_index)
          if display_math_fence_marker(line) == math_fence
            math_fence = nil
            flush.call if block_ends.include?(line_index + 1)
          end
          next
        elsif fence.nil? && (opening_math_fence = display_math_fence_opener(line))
          math_fence = opening_math_fence
          push_line.call(line, line_index)
          next
        end

        if (line.empty? || blank_lines.include?(line_index)) && directive_lines.include?(line_index)
          # Art and margin directives were consumed as metadata before this
          # pass. Their blank placeholders preserve source line ownership.
          flush.call
        elsif fence.nil? && directive_lines.include?(line_index)
          flush.call
          blocks << { markdown: line.strip, start_line: line_index, end_line: line_index + 1 }
        elsif (line.empty? || blank_lines.include?(line_index)) && fence.nil?
          art_binding = art_resolution[:bindings].find do |binding|
            line_index >= binding[:target_lines][:start] && line_index < binding[:target_lines][:end]
          end
          push_line.call(line, line_index) if art_binding && line_index + 1 < art_binding[:target_lines][:end]
          flush.call unless art_binding && line_index + 1 < art_binding[:target_lines][:end]
        else
          push_line.call(line, line_index)
        end
        flush.call if block_ends.include?(line_index + 1) && current.any?
      end
      flush.call
      blocks
    end

    def art_diagnostic_message(code)
      {
        "ART_NO_LIST_TARGET" => "Art needs a root Markdown list immediately after its directive.",
        "ART_INVALID_SYNTAX" => "Art directive syntax is invalid. Use :::art with no arguments.",
        "ART_UNSUPPORTED_CONTENT" => "Art contains unsupported content; the complete Markdown list is shown.",
        "ART_REVEAL_BOUNDARY" => "SmartArt list crosses a reveal boundary; split the Art list or remove the step marker inside it. The complete Markdown list is shown."
      }.fetch(code, "Art reported a layout diagnostic.")
    end

    def position_from_block(block)
      match = block.match(/\A\s*:::(align|position)[ \t]*\{([^}]*)\}\s*\z/)
      return unless match

      values = match[2].split.map(&:downcase)
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
