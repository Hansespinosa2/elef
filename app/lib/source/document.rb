require "json"

module Source
  module Document
    PORTABLE_DOCUMENT_KEY = "elef_document_key".freeze
    PORTABLE_DOCUMENT_ALIASES = "elef_aliases".freeze
    Position = Data.define(:horizontal, :vertical, :vertical_explicit)
    Block = Data.define(:markdown, :position)
    Region = Data.define(:blocks)
    MarginSettings = Data.define(:section, :subsection, :footnote, :slide_count)
    Slide = Data.define(:id, :index, :markdown, :layout, :blocks, :title, :regions, :section, :subsection, :footnote, :warnings)
    Parsed = Data.define(:source_name, :mode, :theme, :typography, :margin_settings, :slides, :warnings)
    SourceLine = Data.define(:start, :end_pos, :text, :ending)
    FrontMatter = Data.define(:lines, :closing_line, :body_start, :eol)

    module_function

    # All Work syntax (slides, blocks, directives, front matter, links) is
    # interpreted once by @elef/work-model through the shared renderer bundle.
    # This module keeps the Rails-facing signatures and data structs, mapping
    # JavaScript structures back onto them.
    def parse(source, source_name: "Untitled presentation", mode: :presentation)
      raise ArgumentError, "The selected file did not contain readable text." unless source.is_a?(String)

      mode = mode.to_sym
      raise ArgumentError, "Unsupported document mode" unless %i[presentation document].include?(mode)

      structure = Source::JavascriptRenderer.work_structure(source, source_name: source_name, mode: mode)
      slides = structure[:slides].map.with_index do |slide, index|
        blocks = slide[:blocks].map do |block|
          Block.new(markdown: block[:markdown], position: position_from(block[:position]))
        end
        Slide.new(
          id: "#{source_name}-#{index + 1}",
          index: index,
          markdown: blocks.map(&:markdown).join("\n\n"),
          layout: slide[:layout],
          blocks: blocks,
          title: slide[:title],
          regions: slide[:regions].map do |region|
            Region.new(blocks: region.map do |block|
              Block.new(markdown: block[:markdown], position: position_from(block[:position]))
            end)
          end,
          section: slide[:section],
          subsection: slide[:subsection],
          footnote: slide[:footnote],
          warnings: slide[:warnings]
        )
      end
      Parsed.new(
        source_name: source_name,
        mode: mode,
        theme: structure[:style][:theme],
        typography: structure[:style][:typography],
        margin_settings: MarginSettings.new(**structure[:marginSettings].slice(:section, :subsection, :footnote, :slide_count)),
        slides: slides,
        warnings: structure[:warnings]
      )
    end

    def theme_from_source(source)
      Source::JavascriptRenderer.read_style(source.to_s)[:theme]
    end

    def typography_from_source(source)
      Source::JavascriptRenderer.read_style(source.to_s)[:typography]
    end

    def style_overrides(source)
      Source::JavascriptRenderer.style_overrides(source.to_s)
    end

    def with_front_matter_value(source, key, value)
      Source::JavascriptRenderer.with_front_matter_value(source.to_s, key.to_s, value)
    end

    def portable_document_link_metadata(source)
      metadata = Source::JavascriptRenderer.portable_document_link_metadata(source.to_s)
      { document_key: metadata[:documentKey], aliases: metadata[:aliases] }
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

    def extract_first_h1(source)
      Source::JavascriptRenderer.first_heading(source.to_s)
    end

    def replace_first_h1(source, title)
      Source::JavascriptRenderer.replace_first_heading(source.to_s, title.to_s)
    end

    def normalize_folder_name(title, fallback: "Untitled presentation")
      value = (title.presence || fallback).unicode_normalize(:nfkc)
      value = value.gsub(/[<>:"\/\\|?*\u0000-\u001f]/, " ").gsub(/\s+/, " ").gsub(/[. ]+\z/, "").strip
      return fallback if value.blank? || [".", ".."].include?(value)

      value[0, 120]
    end

    def slide_source_ranges(source)
      normalized = source.to_s
      map = Source::JavascriptRenderer.editor_map(normalized, source_name: "ranges", mode: :presentation)
      utf16 = normalized.encode("UTF-16LE")
      map[:slides].map.with_index do |slide, index|
        range = slide[:source_range]
        delimiter = slide[:delimiter_range]
        {
          index: index,
          start: char_offset(utf16, range[:start]),
          end: char_offset(utf16, range[:end]),
          delimiter_start: delimiter && char_offset(utf16, delimiter[:start]),
          delimiter_end: delimiter && char_offset(utf16, delimiter[:end])
        }
      end
    end

    # Build the short-lived source projection used by the visual editor. The
    # shared JavaScript parser maps back into the original source so visual
    # edits can replace the smallest possible range. JavaScript and CodeMirror
    # both use UTF-16 offsets.
    def editor_map(source, source_name: "Untitled presentation", mode: :presentation)
      Source::JavascriptRenderer.editor_map(source, source_name: source_name, mode: mode)
    end

    def normalize_theme_value(value)
      Source::JavascriptRenderer.normalize_theme_value(value.to_s)
    end

    def normalize_typography_value(value)
      Source::JavascriptRenderer.normalize_typography_value(value.to_s)
    end

    def position_from(position)
      return nil unless position

      Position.new(
        horizontal: position[:horizontal],
        vertical: position[:vertical],
        vertical_explicit: position[:vertical_explicit]
      )
    end

    # JavaScript string offsets are UTF-16 code units; Ruby slices characters.
    # Convert each shared-parser offset back to a character offset.
    def char_offset(utf16_source, utf16_offset)
      return 0 if utf16_offset.zero?

      utf16_source.byteslice(0, utf16_offset * 2).encode("UTF-8").length
    end
  end
end
