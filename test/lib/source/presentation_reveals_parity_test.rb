require "test_helper"

class PresentationRevealsParityTest < ActiveSupport::TestCase
  FIXTURES_PATH = Rails.root.join("test/fixtures/slide-reveals/parity-cases.json")

  test "Ruby presentation blocks match the shared JavaScript reveal contract fixtures" do
    fixtures = JSON.parse(File.read(FIXTURES_PATH))

    fixtures.each do |fixture|
      long_label_digits = fixture["long_label_digits"].to_i
      source = long_label_digits.positive? ?
        fixture.fetch("source").gsub("@LONG_LABEL@", "9" * long_label_digits) :
        fixture.fetch("source")
      parsed = Source::Document.parse(source, source_name: "Reveal parity", mode: fixture.fetch("mode").to_sym)
      blocks = parsed.slides.map do |slide|
        slide.blocks.map do |block|
          {
            markdown: block.markdown,
            reveal_event: block.reveal_event,
            position: block.position && [block.position.horizontal, block.position.vertical]
          }
        end
      end

      expected_blocks = fixture.fetch("expected_slide_blocks").map do |slide|
        slide.map { |block| block.transform_keys(&:to_sym) }
      end
      assert_equal expected_blocks, blocks, fixture.fetch("name")
      assert_equal fixture.fetch("event_counts"), parsed.slides.map(&:reveal_event_count), fixture.fetch("name")
      assert_equal fixture.fetch("warnings"), parsed.warnings, fixture.fetch("name")

      editor_map = Source::JavascriptRenderer.editor_map(source, source_name: "Reveal parity", mode: fixture.fetch("mode"))
      editor_map.fetch(:slides).each_with_index do |slide_map, slide_index|
        assert_equal blocks[slide_index].length, slide_map.fetch(:blocks).length, fixture.fetch("name")
        slide_map.fetch(:blocks).each_with_index do |mapped_block, block_index|
          expected = blocks[slide_index][block_index]
          mapped_source = source[mapped_block.fetch(:content_range).fetch(:start)...mapped_block.fetch(:content_range).fetch(:end)]
          assert_equal expected[:markdown], mapped_source.gsub(/\r\n?/, "\n"), fixture.fetch("name")
          if expected[:reveal_event].nil?
            assert_nil mapped_block[:reveal_event], fixture.fetch("name")
          else
            assert_equal expected[:reveal_event], mapped_block[:reveal_event], fixture.fetch("name")
          end
        end
      end
    end
  end
end
