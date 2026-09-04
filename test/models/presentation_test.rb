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

  test "automatic layouts do not require a layout directive" do
    slide = Presentations::Document.parse("# Welcome\n\nA clear opening.").slides.first

    assert_equal "statement", slide.layout
    assert_equal "# Welcome\n\nA clear opening.", slide.markdown
  end

  test "infers column layouts from repeated sibling headings" do
    two_column = Presentations::Document.parse(<<~MARKDOWN).slides.first
      # Compare approaches

      ## Fast

      Write quickly.

      ## Safe

      Validate carefully.
    MARKDOWN
    three_column = Presentations::Document.parse(<<~MARKDOWN).slides.first
      # Three priorities

      ## Speed

      Short feedback loops.

      ## Quality

      Reliable output.

      ## Trust

      Source remains canonical.
    MARKDOWN

    assert_equal "two-column", two_column.layout
    assert_equal ["## Fast", "## Safe"], two_column.regions.map { |region| region.blocks.first.markdown }
    assert_equal "three-column", three_column.layout
    assert_equal 3, three_column.regions.length
  end

  test "infers focused content layouts and keeps mixed content as body" do
    assert_equal "statement", Presentations::Document.parse("# Takeaway\n\nMake it clear.").slides.first.layout
    assert_equal "image", Presentations::Document.parse("# Visual\n\n![Alt](image.png)").slides.first.layout
    assert_equal "table", Presentations::Document.parse("# Data\n\n| A | B |\n| --- | --- |\n| 1 | 2 |").slides.first.layout
    assert_equal "code", Presentations::Document.parse("# Example\n\n```ruby\nputs 1\n```").slides.first.layout
    assert_equal "body", Presentations::Document.parse("# Mixed\n\nA paragraph.\n\n- One\n- Two").slides.first.layout
  end

  test "parses block positioning and removes extension directives" do
    document = Presentations::Document.parse(<<~MARKDOWN)
      # Positioned

      :::position{center middle}

      A centered message.

      :::position{right bottom}
      - One
      - Two
    MARKDOWN
    slide = document.slides.first

    assert_equal "body", slide.layout
    assert_equal [nil, ["center", "middle"], ["right", "bottom"]],
      slide.blocks.map { |block| block.position&.then { |position| [position.horizontal, position.vertical] } }
    refute_includes slide.markdown, ":::"
    assert_empty document.warnings
  end

  test "warns and removes unknown presentation directives" do
    document = Presentations::Document.parse("# Slide\n\n:::unknown\n\nContent")

    refute_includes document.slides.first.markdown, ":::unknown"
    assert_equal 1, document.warnings.length
    assert_match "directive", document.warnings.first
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
      assert_includes layouts.source, ":::position{#{horizontal} #{vertical}}"
    end
    assert layouts.slides.any? { |slide| slide.blocks.any? { |block| block.position&.horizontal == "center" && block.position.vertical == "middle" } }
    assert layouts.slides.any? { |slide| slide.blocks.any? { |block| block.position&.horizontal == "right" && block.position.vertical == "bottom" } }
    assert_includes Presentation.find_by!(sample_id: "tables-and-media").slides.map(&:layout), "image"
    assert_includes Presentation.find_by!(sample_id: "code-and-math").slides.map(&:layout), "code"
    assert_includes Presentation.find_by!(sample_id: "tables-and-media").slides.map(&:layout), "table"
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
