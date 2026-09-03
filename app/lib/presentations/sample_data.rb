module Presentations
  module SampleData
    module_function

    MARKER_KEY = "elefSampleId"

    SAMPLES = [
      {
        id: "markdown-basics",
        title: "Sample: Markdown basics",
        source: <<~MARKDOWN
          ---
          #{MARKER_KEY}: markdown-basics
          presentationTheme: light
          ---
          :::slide-layout{intro}
          # Markdown basics

          A small tour of the Markdown Elef supports.
          ---
          # Lists and links

          - headings and paragraphs
          - [links](https://example.com)
          - ~~strikethrough~~
        MARKDOWN
      },
      {
        id: "layouts-and-themes",
        title: "Sample: Layouts and themes",
        source: <<~MARKDOWN
          ---
          #{MARKER_KEY}: layouts-and-themes
          presentationTheme: dark
          ---
          :::slide-layout{intro}
          # Layouts and themes
          ---
          :::slide-layout{body}
          # A body slide

          Layout metadata is removed before Markdown rendering.
        MARKDOWN
      },
      {
        id: "code-and-math",
        title: "Sample: Code and LaTeX math",
        source: <<~MARKDOWN
          ---
          #{MARKER_KEY}: code-and-math
          presentationTheme: match
          ---
          # Code and LaTeX

          Inline math: $x^2 + y^2 = z^2$

          ```ruby
          puts "$not_math$"
          ```
          ---
          # Display equation

          $$\\int_0^1 x^2 dx = \\frac{1}{3}$$
        MARKDOWN
      },
      {
        id: "tables-and-media",
        title: "Sample: Tables and media",
        source: <<~MARKDOWN
          ---
          #{MARKER_KEY}: tables-and-media
          ---
          # Tables and media

          | Feature | Example |
          | --- | --- |
          | Image | ![Elef](https://example.com/elef.png) |
          | Link | [Elef](https://example.com) |
        MARKDOWN
      },
      {
        id: "slide-edge-cases",
        title: "Sample: Slide edge cases",
        source: <<~MARKDOWN
          ---
          #{MARKER_KEY}: slide-edge-cases
          presentationTheme: light
          ---
          # Fenced separators

          ```yaml
          ---
          example: true
          ```
          ---
          ---
          # Final slide
        MARKDOWN
      }
    ].freeze

    def load!
      Presentation.transaction do
        SAMPLES.map do |sample|
          presentation = Presentation.find_by(sample_id: sample[:id]) || find_legacy_owned(sample[:id]) || Presentation.new
          presentation.assign_attributes(
            sample_id: sample[:id],
            title: sample[:title],
            source: sample[:source]
          )
          presentation.save!
          presentation
        end
      end
    end

    def find_legacy_owned(id)
      marker = "#{MARKER_KEY}: #{id}"
      Presentation.where("source LIKE ?", "%#{Presentation.sanitize_sql_like(marker)}%").find do |presentation|
        front_matter_lines(presentation.source).any? { |line| line.strip == marker }
      end
    end
    private_class_method :find_legacy_owned

    def front_matter_lines(source)
      lines = source.to_s.lines
      return [] unless lines.first&.strip == "---"

      closing_index = lines.drop(1).find_index { |line| line.strip == "---" }
      closing_index ? lines[1..closing_index] : []
    end
    private_class_method :front_matter_lines
  end
end
