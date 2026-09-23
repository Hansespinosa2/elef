module Presentations
  # Pure source transformations used by the presentation canvas. They return
  # Markdown and never persist a work, so the normal draft/autosave pipeline
  # remains the only owner of saved state.
  module EditorOperations
    module_function

    def apply(source, operation, **options)
      case operation.to_s
      when "add_slide" then add_slide(source, **options)
      when "delete_slide" then delete_slide(source, **options)
      when "move_slide" then move_slide(source, **options)
      when "add_block" then add_block(source, **options)
      when "delete_block" then delete_block(source, **options)
      when "move_block" then move_block(source, **options)
      when "set_position" then set_position(source, **options)
      else
        raise ArgumentError, "Unsupported presentation editor operation"
      end
    end

    def add_slide(source, index: nil, markdown: "# New slide")
      source = source.to_s.dup
      markdown = markdown.to_s.strip.presence || "# New slide"
      ranges = Document.slide_source_ranges(source)
      target = index.nil? ? ranges.length : Integer(index)
      raise IndexError, "Slide index is out of bounds" unless target.between?(0, ranges.length)

      if target == ranges.length
        return markdown if source.strip.blank?

        separator = source.end_with?("\n") ? "---\n" : "\n---\n"
        source + separator + markdown
      else
        insertion = "#{markdown}\n---\n"
        source.insert(ranges[target][:start], insertion)
      end
    end

    def delete_slide(source, index:)
      source = source.to_s.dup
      ranges = Document.slide_source_ranges(source)
      index = Integer(index)
      raise IndexError, "Slide index is out of bounds" unless index.between?(0, ranges.length - 1)
      return source if ranges.length == 1 && source[ranges.first[:start]...ranges.first[:end]].to_s.blank?

      if index.zero?
        end_pos = ranges.first[:delimiter_end] || ranges.first[:end]
        source[ranges.first[:start]...end_pos] = ""
      elsif index == ranges.length - 1
        start_pos = ranges[index - 1][:delimiter_start]
        source[start_pos...ranges[index][:end]] = ""
      else
        start_pos = ranges[index][:start]
        end_pos = ranges[index][:delimiter_end] || ranges[index][:end]
        source[start_pos...end_pos] = ""
      end
      source
    end

    def move_slide(source, index:, to:)
      source = source.to_s.dup
      ranges = Document.slide_source_ranges(source)
      index = Integer(index)
      target = Integer(to)
      raise IndexError, "Slide index is out of bounds" unless index.between?(0, ranges.length - 1)
      raise IndexError, "Slide destination is out of bounds" unless target.between?(0, ranges.length - 1)
      return source if index == target

      slide = source[ranges[index][:start]...ranges[index][:end]].to_s.strip
      remaining = delete_slide(source, index: index)
      add_slide(remaining, index: target, markdown: slide)
    end

    def add_block(source, slide_index:, markdown:, index: nil, position: nil)
      source = source.to_s.dup
      map = Document.editor_map(source, mode: :presentation)
      slide = map[:slides][Integer(slide_index)]
      raise IndexError, "Slide index is out of bounds" unless slide

      blocks = slide[:blocks]
      target = index.nil? ? blocks.length : Integer(index)
      raise IndexError, "Block index is out of bounds" unless target.between?(0, blocks.length)
      markdown = markdown.to_s.strip
      markdown = "New block" if markdown.blank?
      markdown = positioned(markdown, position) if position.present?

      insertion_point = if target < blocks.length
        character_index(source, blocks[target][:range][:start])
      else
        character_index(source, slide[:range][:end])
      end
      if target < blocks.length
        source.insert(insertion_point, "#{markdown}\n\n")
      else
        prefix = if source[0...insertion_point].to_s.blank?
          ""
        elsif source[0...insertion_point].to_s.end_with?("\n")
          "\n"
        else
          "\n\n"
        end
        suffix = slide[:delimiter_range] ? "\n" : ""
        source.insert(insertion_point, "#{prefix}#{markdown}#{suffix}")
      end
    end

    def delete_block(source, slide_index:, block_index:)
      source = source.to_s.dup
      map = Document.editor_map(source, mode: :presentation)
      slide = map[:slides][Integer(slide_index)]
      block = slide && slide[:blocks][Integer(block_index)]
      raise IndexError, "Block index is out of bounds" unless block

      start_pos = character_index(source, block[:range][:start])
      end_pos = character_index(source, block[:range][:end])
      before = source[0...start_pos].to_s
      after = source[end_pos..].to_s
      if before.blank? && after.start_with?("\n")
        after = after[1..].to_s
      elsif after.start_with?("\n") && before.end_with?("\n\n")
        after = after[1..].to_s
      end
      before + after
    end

    def move_block(source, slide_index:, block_index:, to:)
      source = source.to_s.dup
      map = Document.editor_map(source, mode: :presentation)
      slide = map[:slides][Integer(slide_index)]
      blocks = slide && slide[:blocks]
      index = Integer(block_index)
      target = Integer(to)
      raise IndexError, "Block index is out of bounds" unless blocks && index.between?(0, blocks.length - 1)
      raise IndexError, "Block destination is out of bounds" unless target.between?(0, blocks.length - 1)
      return source if index == target

      block = source[character_index(source, blocks[index][:range][:start])...character_index(source, blocks[index][:range][:end])].to_s.strip
      remaining = delete_block(source, slide_index: slide_index, block_index: index)
      add_block(remaining, slide_index: slide_index, index: target, markdown: block)
    end

    def set_position(source, slide_index:, block_index:, position:)
      source = source.to_s.dup
      map = Document.editor_map(source, mode: :presentation)
      slide = map[:slides][Integer(slide_index)]
      block = slide && slide[:blocks][Integer(block_index)]
      raise IndexError, "Block index is out of bounds" unless block

      directive_id = block[:position_directive_id]
      directive = slide[:directives].find { |candidate| candidate[:id] == directive_id }
      if position.blank?
        return source unless directive

        removable = [directive]
        directive_index = slide[:directives].index(directive)
        closing = slide[:directives][directive_index + 1] if directive_index
        removable << closing if closing && closing[:type] == "position_close"
        removable.compact.sort_by { |candidate| candidate[:range][:start] }.reverse_each do |candidate|
          start_pos = character_index(source, candidate[:range][:start])
          end_pos = character_index(source, candidate[:range][:end])
          source[start_pos...end_pos] = ""
          if source[start_pos, 1] == "\n" && source[0...start_pos].to_s.end_with?("\n\n")
            source[start_pos, 1] = ""
          end
        end
        return source
      end

      replacement = ":::position{#{position.to_s.strip}}"
      if directive
        start_pos = character_index(source, directive[:range][:start])
        end_pos = character_index(source, directive[:range][:end])
        line_ending = source[start_pos...end_pos].to_s.match(/\r\n|\n|\r\z/)&.to_s || ""
        source[start_pos...end_pos] = "#{replacement}#{line_ending}"
      else
        block_start = character_index(source, block[:range][:start])
        source.insert(block_start, "#{replacement}\n\n")
      end
      source
    end

    def positioned(markdown, position)
      ":::position{#{position.to_s.strip}}\n\n#{markdown}\n\n:::"
    end

    def character_index(source, utf16_offset)
      return source.length if utf16_offset.to_i >= Document.utf16_length(source)

      offset = 0
      source.each_char.with_index do |character, index|
        return index if offset >= utf16_offset.to_i

        offset += Document.utf16_length(character)
      end
      source.length
    end
  end
end
