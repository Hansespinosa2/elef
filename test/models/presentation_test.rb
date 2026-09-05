require "test_helper"

class PresentationTest < ActiveSupport::TestCase
  test "stores raw source and derives ordered slides" do
    presentation = Presentation.create!(title: "Demo", source: "# One\n---\n# Two")

    assert_equal "# One\n---\n# Two", presentation.reload.source
    assert_equal ["# One", "# Two"], presentation.slides.map(&:markdown)
  end

  test "preserves empty slides and ignores front matter and fenced separators" do
    source = "---\ntitle: Demo\npresentationTheme: dark\n---\n```yaml\n---\n```\n---\n---"
    document = Presentations::Document.parse(source, source_name: "Demo")

    assert_equal "dark", document.presentation_theme
    assert_equal ["```yaml\n---\n```", "", ""], document.slides.map(&:markdown)
  end

  test "malformed front matter remains ordinary Markdown" do
    document = Presentations::Document.parse("---\npresentationTheme: dark")

    assert_equal "match", document.presentation_theme
    assert_equal ["", "presentationTheme: dark"], document.slides.map(&:markdown)
  end

  test "layout directive is metadata instead of rendered Markdown" do
    slide = Presentations::Document.parse(":::slide-layout{intro}\n# Welcome").slides.first

    assert_equal "intro", slide.layout
    assert_equal "# Welcome", slide.markdown
  end

  test "blank source is a valid one-slide presentation" do
    presentation = Presentation.create!(title: "Blank", source: "")

    assert_equal [""], presentation.slides.map(&:markdown)
  end

  test "derives a safe title from the first heading" do
    presentation = Presentation.create!(source: "# Quarterly / Review?\n\nBody")

    assert_equal "Quarterly Review", presentation.title
  end

  test "renders supported markdown, code, images, links, tables, strikethrough, and math" do
    html = Presentations::MarkdownRenderer.render(<<~MARKDOWN)
      # Heading

      - item

      ~~gone~~

      [Elef](https://example.com)

      ![Alt](image.png)

      | A | B |
      | --- | --- |
      | 1 | 2 |

      ```ruby
      puts "$not_math$"
      ```

      $x^2$
    MARKDOWN

    assert_includes html, "<h1>Heading</h1>"
    assert_includes html, "<li>item</li>"
    assert_includes html, "<del>gone</del>"
    assert_includes html, "href=\"https://example.com\""
    assert_includes html, "src=\"image.png\""
    assert_includes html, "<table>"
    assert_includes html, "puts"
    assert_includes html, "$not_math$"
    assert_includes html, "katex"
  end

  test "sample data covers supported presentation features" do
    samples = Presentations::SampleData.load!

    assert_equal Presentations::SampleData::SAMPLES.length, samples.length
    Presentations::SampleData::SAMPLES.zip(samples).each do |sample, presentation|
      assert_equal sample[:source], presentation.reload.source
    end
    assert_equal Presentations::SampleData::SAMPLES.map { |sample| sample[:id] },
      samples.map(&:sample_id)
    assert_equal %w[dark light match], samples.map(&:presentation_theme).uniq.sort
    assert samples.all? { |presentation| presentation.slides.length.between?(10, 15) }
    assert samples.all? { |presentation| presentation.source.lines.length > 50 }
    assert samples.all? { |presentation| presentation.source.scan(/^# /).length >= 8 }
    assert samples.any? { |presentation| presentation.source.include?("```ruby") }
    assert samples.any? { |presentation| presentation.source.include?("$$") }
    assert samples.any? { |presentation| presentation.source.include?("| Workflow | Authoring speed |") }
    assert samples.any? { |presentation| presentation.slides.any? { |slide| slide.layout == "intro" } }
    assert samples.any? { |presentation| presentation.source.include?("Fenced") }
  end

  test "renders every sample's representative content" do
    Presentations::SampleData.load!

    code_and_math = Presentations::MarkdownRenderer.render(
      Presentation.find_by!(sample_id: "code-and-math").source
    )
    assert_includes code_and_math, "katex"
    assert_includes code_and_math, "process_records"
    tables_and_media = Presentations::MarkdownRenderer.render(
      Presentation.find_by!(sample_id: "tables-and-media").source
    )

    assert_includes tables_and_media, "<table>"
    assert_includes tables_and_media, 'src="https://example.com/elef-workflow.png"'
    assert_includes tables_and_media, 'href="https://example.com/elef"'
    assert_includes Presentations::MarkdownRenderer.render(
      Presentation.find_by!(sample_id: "code-and-math").source
    ), "$not_math$"
  end

  test "lineage seed creates three five-presentation trees" do
    records = Presentations::LineageSampleData.load!

    assert_equal 15, records.length
    assert_equal 6, records.count(&:continuation?)
    assert_equal 6, records.count(&:inspiration?)
    assert_equal %w[lineage-product-root lineage-research-root lineage-root],
      records.select { |record| record.parent.nil? }.map(&:sample_id).sort
    assert_equal records.find { |record| record.sample_id == "lineage-root" }.source,
      records.find { |record| record.sample_id == "lineage-continuation-june" }.fork_source
  end

  test "presentation creation always has a timestamp" do
    presentation = Presentation.new(title: "Timestamped", source: "# Timestamped", created_at: nil)

    presentation.save!

    assert_not_nil presentation.created_at
  end

  test "deleting a parent leaves the fork detached and intact" do
    parent = Presentation.create!(title: "Parent", source: "# Parent")
    child = parent.fork_as("continuation")
    child.save!

    parent.destroy!

    assert_nil child.reload.parent
    assert_equal "# Parent", child.source
    assert_equal "Parent", child.fork_parent_title
  end
end
