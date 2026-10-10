require "test_helper"

class SourceSlidePositionLayoutTest < ActiveSupport::TestCase
  CORPUS = JSON.parse(Rails.root.join("docs/align-directives-grammar/fixtures.json").read).fetch("fixtures").freeze

  test "Ruby placement matches every decided fixture's groups, lanes, layout, and warnings" do
    CORPUS.each do |fixture|
      source = fixture.fetch("source")
      assert_equal Presentation::DEFAULT_SOURCE, source if fixture.fetch("id") == "F-16"

      parsed = Source::Document.parse(source, source_name: fixture.fetch("id"), mode: :presentation)
      slide = parsed.slides.first
      expected = fixture.fetch("expected")
      assert_equal expected.fetch("layout"), slide.layout, fixture.fetch("id")

      contexts = %w[two-column three-column].include?(slide.layout) ? slide.regions.map(&:blocks) : [slide.blocks]
      placements = contexts.map { |blocks| Source::Document.position_layout(blocks) }
      actual_middle_groups = placements.each_with_index.flat_map do |placement, context_index|
        placement[:entries].filter_map do |entry|
          next unless entry[:type] == :middle

          placement_blocks = contexts[context_index]
          placement_blocks[entry[:start]...entry[:end]].map { |block| block_label(block.markdown) }
        end
      end
      actual_bottom_lanes = placements.each_with_index.flat_map do |placement, context_index|
        placement[:entries].filter_map do |entry|
          next unless entry[:type] == :bottom

          placement_blocks = contexts[context_index]
          placement_blocks[entry[:start]...entry[:end]].map { |block| block_label(block.markdown) }
        end
      end
      actual_region_placements = placements.each_with_index.map do |placement, context_index|
        placement_blocks = contexts[context_index]
        {
          "middleGroups" => placement[:entries].filter_map do |entry|
            next unless entry[:type] == :middle

            placement_blocks[entry[:start]...entry[:end]].map { |block| block_label(block.markdown) }
          end,
          "bottomLanes" => placement[:entries].filter_map do |entry|
            next unless entry[:type] == :bottom

            placement_blocks[entry[:start]...entry[:end]].map { |block| block_label(block.markdown) }
          end
        }
      end

      assert_equal expected.fetch("middleGroups"), actual_middle_groups, "#{fixture.fetch('id')} middle groups"
      assert_equal expected.fetch("bottomLanes"), actual_bottom_lanes, "#{fixture.fetch('id')} bottom lanes"
      assert_equal expected["regionPlacements"], actual_region_placements, "#{fixture.fetch('id')} per-region placement" if expected.key?("regionPlacements")
      assert_equal expected.fetch("warningPatterns").length, slide.warnings.length, "#{fixture.fetch('id')} warning count"
      expected.fetch("warningPatterns").each do |pattern|
        assert slide.warnings.any? { |warning| warning.downcase.include?(pattern) }, "#{fixture.fetch('id')} missing warning: #{pattern}"
      end
      assert_equal expected["flushBottom"], placements.any? { |placement| placement[:entries].any? { |entry| entry[:type] == :middle && entry[:flush_bottom] } } if expected.key?("flushBottom")
    end
  end

  test "position layout keeps each block in source order and marks only inner bottoms as absorbed" do
    slide = Source::Document.parse(CORPUS.find { |fixture| fixture.fetch("id") == "F-07" }.fetch("source"), mode: :presentation).slides.first
    placement = Source::Document.position_layout(slide.blocks)

    assert_equal [{ type: :middle, start: 0, end: 3, flush_bottom: nil }], placement[:entries]
    assert_empty placement[:warnings]
  end

  test "document mode does not report slide-only trailing-bottom placement warnings" do
    source = ":::align{bottom}\nFirst paragraph\n\nSecond paragraph"
    document = Source::Document.parse(source, mode: :document)
    presentation = Source::Document.parse(source, mode: :presentation)

    assert_empty document.warnings.grep(/trailing bottom/)
    assert_equal 1, presentation.warnings.grep(/trailing bottom/).length
  end

  test "position layout handles a long run of middle blocks in one group" do
    position = Source::Document::Position.new(horizontal: "center", vertical: "middle", vertical_explicit: true)
    blocks = Array.new(30_000) { Source::Document::Block.new(markdown: "Text", position: position) }

    placement = Source::Document.position_layout(blocks)

    assert_equal [{ type: :middle, start: 0, end: blocks.length, flush_bottom: nil }], placement[:entries]
    assert_empty placement[:warnings]
  end

  private

  def block_label(markdown)
    markdown.lines.first.to_s.sub(/\A\s{0,3}#+\s+/, "").strip
  end
end
