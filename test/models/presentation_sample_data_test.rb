require "test_helper"

class PresentationSampleDataTest < ActiveSupport::TestCase
  test "sample data covers supported presentation features" do
    samples = Presentations::SampleData.load!

    assert_equal Presentations::SampleData::SAMPLES.length, samples.length
    assert Presentations::SampleData::SAMPLES.all? { |sample| sample[:purpose].present? }
    Presentations::SampleData::SAMPLES.zip(samples).each do |sample, presentation|
      assert_equal sample[:source], presentation.reload.source
    end
    assert_equal Presentations::SampleData::SAMPLES.map { |sample| sample[:id] },
      samples.map(&:sample_id)
    assert_equal %w[dark light match], samples.map(&:theme).uniq.sort
    assert samples.all? { |presentation| presentation.slides.length.between?(10, 20) }
    assert samples.all? { |presentation| presentation.source.lines.length > 50 }
    assert samples.all? { |presentation| presentation.source.scan(/^# /).length >= 8 }
    assert samples.any? { |presentation| presentation.source.include?("```ruby") }
    assert samples.any? { |presentation| presentation.source.include?("$$") }
    assert samples.any? { |presentation| presentation.source.include?("| Workflow | Authoring speed |") }
    refute samples.any? { |presentation| presentation.source.include?("slide-layout") }
    layouts = Presentation.find_by!(sample_id: "layouts-and-themes")
    assert_includes layouts.slides.map(&:layout), "two-column"
    assert_includes layouts.slides.map(&:layout), "three-column"
    assert_includes layouts.slides.map(&:layout), "statement"
    assert_equal 5, layouts.slides.count { |slide| slide.layout == "three-column" }
    %w[left center right].product(%w[top middle bottom]).each do |horizontal, vertical|
      vertical_value = vertical == "middle" ? "center" : vertical
      assert_includes layouts.source, ":::align{#{vertical_value} #{horizontal}}"
    end
    assert layouts.slides.any? { |slide| slide.blocks.any? { |block| block.position&.horizontal == "center" && block.position.vertical == "middle" } }
    assert layouts.slides.any? { |slide| slide.blocks.any? { |block| block.position&.horizontal == "right" && block.position.vertical == "bottom" } }
    assert_equal ["center", "middle"], [layouts.slides.first.blocks.first.position.horizontal, layouts.slides.first.blocks.first.position.vertical]
    assert_equal ["center", "top"], [layouts.slides.first.blocks.second.position.horizontal, layouts.slides.first.blocks.second.position.vertical]
    assert_includes Presentation.find_by!(sample_id: "tables-and-media").slides.map(&:layout), "image"
    assert_includes Presentation.find_by!(sample_id: "code-and-math").slides.map(&:layout), "code"
    assert_includes Presentation.find_by!(sample_id: "tables-and-media").slides.map(&:layout), "table"
    assert samples.any? { |presentation| presentation.source.include?("Fenced") }
  end
  test "renders every sample's representative content" do
    Presentations::SampleData.load!

    code_and_math = Source::Renderer.render(
      Presentation.find_by!(sample_id: "code-and-math").source
    )
    assert_includes code_and_math, "katex"
    assert_includes code_and_math, "process_records"
    tables_and_media = Source::Renderer.render(
      Presentation.find_by!(sample_id: "tables-and-media").source
    )

    assert_includes tables_and_media, "<table>"
    assert_includes tables_and_media, 'src="https://example.com/elef-workflow.png"'
    assert_includes tables_and_media, 'href="https://example.com/elef"'
    assert_includes Source::Renderer.render(
      Presentation.find_by!(sample_id: "code-and-math").source
    ), "$not_math$"
  end
end
