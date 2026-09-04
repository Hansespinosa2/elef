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

  test "defaults presentation typography to book" do
    assert_equal "book", Presentations::Document.parse("# Title").presentation_typography
    assert_equal "book", Presentations::Document.parse("---\npresentationTypography: unknown\n---\n# Title").presentation_typography
  end

  test "reads and updates presentation typography without losing front matter" do
    source = "---\ntitle: Demo\npresentationTheme: dark\npresentationTypography: modern\n---\n# Title\n---\n# Second"
    presentation = Presentation.create!(title: "Demo", source: source)

    assert_equal "modern", presentation.presentation_typography
    presentation.presentation_typography = "technical"

    assert_equal "technical", presentation.presentation_typography
    assert_includes presentation.source, "title: Demo\n"
    assert_includes presentation.source, "presentationTheme: dark\n"
    assert_includes presentation.source, "presentationTypography: technical\n"
    assert_includes presentation.source, "# Title\n---\n# Second"
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
end
