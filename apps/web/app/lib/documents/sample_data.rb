module Documents
  module SampleData
    module_function

    Conflict = Data.define(:sample_id, :title, :existing_document)
    LoadResult = Data.define(:records, :conflicts)

    SAMPLES = [
      {
        id: "document-markdown-tour",
        title: "Fixture: Markdown tour",
        purpose: "Prove continuous Markdown semantics, hierarchy, emphasis, lists, links, and thematic breaks.",
        source: File.read(File.join(__dir__, "samples", "document-markdown-tour.md"))
      },
      {
        id: "document-design-principles",
        title: "Fixture: Elef design principles",
        purpose: "Express ten principles for a keyboard-first, welcoming, transparent authoring experience.",
        source: File.read(File.join(__dir__, "samples", "document-design-principles.md"))
      },
      {
        id: "document-components",
        title: "Fixture: Rich components",
        purpose: "Prove tables, fenced code, inline and display math, and safe media in a document.",
        source: File.read(File.join(__dir__, "samples", "document-components.md"))
      },
      {
        id: "document-positioned-content",
        title: "Fixture: Positioned content",
        purpose: "Prove document block alignment without exposing the alignment directive.",
        source: File.read(File.join(__dir__, "samples", "document-positioned-content.md"))
      },
      {
        id: "document-boundaries",
        title: "Fixture: Markdown boundaries",
        purpose: "Prove front matter, thematic breaks, fenced delimiters, Unicode, and wrapping.",
        source: File.read(File.join(__dir__, "samples", "document-boundaries.md"))
      },
      {
        id: "document-links-hub",
        title: "Fixture: Link hub",
        purpose: "Prove a high-degree graph node and duplicate-edge deduplication.",
        source: File.read(File.join(__dir__, "samples", "document-links-hub.md"))
      },
      {
        id: "document-links-branch-a",
        title: "Fixture: Link branch A",
        purpose: "Prove a linked branch can return to the hub and continue to another branch.",
        source: File.read(File.join(__dir__, "samples", "document-links-branch-a.md"))
      },
      {
        id: "document-links-branch-b",
        title: "Fixture: Link branch B",
        purpose: "Prove a second branch remains legible and independently navigable.",
        source: File.read(File.join(__dir__, "samples", "document-links-branch-b.md"))
      },
      {
        id: "document-links-cycle-a",
        title: "Fixture: Link cycle A",
        purpose: "Prove one half of a reciprocal document cycle remains renderable.",
        source: File.read(File.join(__dir__, "samples", "document-links-cycle-a.md"))
      },
      {
        id: "document-links-cycle-b",
        title: "Fixture: Link cycle B",
        purpose: "Prove reciprocal cycles do not recurse or duplicate graph nodes.",
        source: File.read(File.join(__dir__, "samples", "document-links-cycle-b.md"))
      },
      {
        id: "document-links-unresolved",
        title: "Fixture: Unresolved links",
        purpose: "Prove resolved, unresolved, inline-code, and fenced-code link distinctions.",
        source: File.read(File.join(__dir__, "samples", "document-links-unresolved.md"))
      },
      {
        id: "document-links-orphan",
        title: "Fixture: Graph orphan",
        purpose: "Prove a standalone document remains visible in the graph without edges.",
        source: File.read(File.join(__dir__, "samples", "document-links-orphan.md"))
      },
      {
        id: "document-stress-renderer",
        title: "Stress: Renderer kitchen sink",
        purpose: "Prove combined content types, wrapping, and generated HTML under density.",
        source: File.read(File.join(__dir__, "samples", "document-stress-renderer.md"))
      },
      {
        id: "document-stress-warnings",
        title: "Stress: Warnings and unsafe input",
        purpose: "Prove malformed directives warn locally and unsafe protocols are removed.",
        source: File.read(File.join(__dir__, "samples", "document-stress-warnings.md"))
      },
      {
        id: "document-full-report",
        title: "Report: The State of Calm Authoring",
        purpose: "Prove a long-form report remains readable across ten or more pages of structured Markdown.",
        source: File.read(File.join(__dir__, "samples", "document-full-report.md"))
      }
    ].freeze

    def load!
      conflicts = SAMPLES.filter_map do |sample|
        existing_document = Document.find_by(sample_id: nil, title: sample[:title])
        next unless existing_document

        Conflict.new(sample[:id], sample[:title], existing_document)
      end
      conflicted_sample_ids = conflicts.each_with_object({}) do |conflict, sample_ids|
        sample_ids[conflict.sample_id] = true
      end

      records = Document.transaction do
        SAMPLES.map do |sample|
          next if conflicted_sample_ids[sample[:id]]

          document = Document.find_or_initialize_by(sample_id: sample[:id])
          document.assign_attributes(title: sample[:title], source: sample[:source])
          document.save!
          document
        end.compact
      end

      LoadResult.new(records, conflicts)
    end
  end
end
