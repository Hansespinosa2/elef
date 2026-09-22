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

  test "parses margin settings and slide context directives" do
    source = <<~MARKDOWN
      ---
      show-in-margin:
        section: true
        subsection: false
        footnote: true
        slideCount: false
      ---
      # Intro
      ---
      :::section{Product strategy}
      :::subsection{The opportunity}
      # Opportunity
      :::footnote{Source: [research](https://example.com)}
      ---
      :::subsection{The shift}
      # Shift
    MARKDOWN

    document = Presentations::Document.parse(source)

    assert_equal [true, false, true, false], [
      document.margin_settings.section,
      document.margin_settings.subsection,
      document.margin_settings.footnote,
      document.margin_settings.slide_count
    ]
    assert_nil document.slides[0].section
    assert_equal "Product strategy", document.slides[1].section
    assert_equal "The opportunity", document.slides[1].subsection
    assert_equal "The shift", document.slides[2].subsection
    assert_nil document.slides[2].footnote
    refute_includes document.slides[1].markdown, ":::"
    assert_empty document.warnings
  end

  test "enables all margin regions by default" do
    settings = Presentations::Document.parse("# Slide").margin_settings

    assert_equal [true, true, true, true], [settings.section, settings.subsection, settings.footnote, settings.slide_count]
  end

  test "parses nested and escaped footnote braces at the end of a slide" do
    document = Presentations::Document.parse(<<~MARKDOWN)
      # Explain the configuration

      The note belongs to this slide.

      ```yaml
      :::footnote{This remains code}
      ```

      :::footnote{Use {production: true} and \{literal braces\}.}
    MARKDOWN

    assert_equal "Use {production: true} and {literal braces}.", document.slides.first.footnote
    assert_includes document.slides.first.markdown, ":::footnote{This remains code}"
    assert_empty document.warnings
  end

  test "warns and removes section directives that are not at the beginning" do
    document = Presentations::Document.parse(<<~MARKDOWN)
      # Intro

      :::footnote{Too early}

      Content first.

      :::section{Late context}
      :::subsection{Also late}
      ---
      :::section{Valid context}
      # Next
    MARKDOWN

    assert_nil document.slides.first.section
    assert_equal "Valid context", document.slides.second.section
    refute_includes document.slides.first.markdown, "Late context"
    assert_equal 3, document.warnings.length
    assert_equal 2, document.warnings.count { |warning| warning.include?("beginning of a slide") }
    assert_includes document.warnings, "Footnote margin directive must appear at the end of a slide."
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

  test "recognizes fenced code with a longer closing fence" do
    slide = Presentations::Document.parse("# Example\n\n```ruby\nputs 1\n````").slides.first

    assert_equal "code", slide.layout
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

  test "records whether a vertical position was explicitly requested" do
    document = Presentations::Document.parse(<<~MARKDOWN)
      :::position{center}

      Horizontal only.

      :::position{center middle}

      Horizontal and vertical.
    MARKDOWN

    assert_equal [false, true], document.slides.first.blocks.map { |block| block.position&.vertical_explicit }
  end

  test "warns and removes unknown presentation directives" do
    document = Presentations::Document.parse("# Slide\n\n:::unknown\n\nContent")

    refute_includes document.slides.first.markdown, ":::unknown"
    assert_equal 1, document.warnings.length
    assert_match "directive", document.warnings.first
  end

  test "detects keys inside front matter" do
    source = "---\npresentationTheme: dark\npresentationTypography: modern\n---\n# Title"

    assert Presentations::Document.front_matter_has_key?(source, "presentationTypography")
    refute Presentations::Document.front_matter_has_key?(source, "missing")
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

  test "does not render math inside inline code or escaped delimiters" do
    html = Presentations::MarkdownRenderer.render("`$x^2$` and $x^2$ and \\$x$")

    assert_equal 1, html.scan('class="katex"').length
    assert_includes html, "<code>$x^2$</code>"
    assert_includes html, "\\$x$"
  end

  test "rejects dangerous link and image protocols" do
    html = Presentations::MarkdownRenderer.render("[unsafe](javascript:alert(1)) ![image](javascript:alert(1))")

    refute_includes html, "javascript:"
    refute_includes html, "<a"
    refute_includes html, "<img"
  end

  test "sample data covers supported presentation features" do
    samples = Presentations::SampleData.load!

    assert_equal Presentations::SampleData::SAMPLES.length, samples.length
    assert Presentations::SampleData::SAMPLES.all? { |sample| sample[:purpose].present? }
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

  test "lineage seed creates three five-presentation trees" do
    records = Presentations::LineageSampleData.load!

    assert_equal 15, records.length
    assert Presentations::LineageSampleData::SAMPLES.all? { |sample| sample[:purpose].present? }
    assert records.all? { |record| record.slides.length >= 4 }
    assert_equal 6, records.count(&:continuation?)
    assert_equal 6, records.count(&:inspiration?)
    assert_equal %w[lineage-product-root lineage-research-root lineage-root],
      records.select { |record| record.parent.nil? }.map(&:sample_id).sort
    assert_equal records.find { |record| record.sample_id == "lineage-root" }.source,
      records.find { |record| record.sample_id == "lineage-continuation-june" }.fork_source

    root = records.find { |record| record.sample_id == "lineage-root" }
    assert_equal 4, root.slides.length
    assert_equal "Quarterly review", root.slides.first.section
    assert_equal "Baseline", root.slides.first.subsection
    assert_equal "Source: May operating review", root.slides.first.footnote
    assert root.document.margin_settings.section
    assert root.document.margin_settings.footnote

    workshop = records.find { |record| record.sample_id == "lineage-inspiration-workshop" }
    assert_includes workshop.slides.map(&:layout), "three-column"
    assert workshop.slides.any? do |slide|
      slide.blocks.any? { |block| block.position&.horizontal == "center" && block.position.vertical == "middle" }
    end

    findings = records.find { |record| record.sample_id == "lineage-research-continuation" }
    assert_includes findings.source, "~~~ruby"
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

  test "forks a maximum length title while preserving the original snapshot" do
    parent = Presentation.create!(title: "x" * 120, source: "# Original")
    Presentation::FORK_TYPES.each do |type|
      child = parent.fork_as(type)
      assert child.save, child.errors.full_messages.to_sentence
      assert_operator child.title.length, :<=, 120
      assert child.title.end_with?(" (#{type.capitalize})")
      assert_equal parent.title, child.fork_parent_title
      assert_equal parent.source, child.fork_source
    end
  end
end
