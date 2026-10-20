module Presentations
  module SampleData
    module_function

    MARKER_KEY = "elefSampleId"

    SAMPLES = [
      {
        id: "markdown-basics",
        title: "Sample: Markdown basics",
        purpose: "Prove Markdown hierarchy, sections, subsections, footnotes, slide counts, and readable narrative flow.",
        source: File.read(File.join(__dir__, "samples", "markdown-basics.md"))
      },
      {
        id: "layouts-and-themes",
        title: "Sample: Layouts and themes",
        purpose: "Prove themes, automatic layouts, columns, centered content, and every supported position.",
        source: File.read(File.join(__dir__, "samples", "layouts-and-themes.md"))
      },
      {
        id: "code-and-math",
        title: "Sample: Code and LaTeX math",
        purpose: "Prove syntax-highlighted code stays distinct from inline and display LaTeX math.",
        source: File.read(File.join(__dir__, "samples", "code-and-math.md"))
      },
      {
        id: "tables-and-media",
        title: "Sample: Tables and media",
        purpose: "Prove table layout, image rendering, safe links, and evidence-oriented content.",
        source: File.read(File.join(__dir__, "samples", "tables-and-media.md"))
      },
      {
        id: "slide-edge-cases",
        title: "Sample: Slide edge cases",
        purpose: "Prove slide boundaries, front matter, fenced delimiters, tilde fences, and unusual text.",
        source: File.read(File.join(__dir__, "samples", "slide-edge-cases.md"))
      },
      {
        id: "elef-workflow",
        title: "Sample: The Elef workflow",
        purpose: "Prove a realistic end-to-end story can combine authoring, preview, presentation, and review.",
        source: File.read(File.join(__dir__, "samples", "elef-workflow.md"))
      },
      {
        id: "renderer-stress-test",
        title: "Sample: Renderer stress test",
        purpose: "Prove dense combinations of text, code, math, tables, media, links, and boundaries.",
        source: File.read(File.join(__dir__, "samples", "renderer-stress-test.md"))
      }
    ].freeze

    def load!
      Presentation.transaction do
        SAMPLES.map do |sample|
          presentation = Presentation.joins(:presentation_detail).find_by(presentation_details: { sample_id: sample[:id] }) ||
            find_legacy_owned(sample[:id]) || Presentation.new
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
