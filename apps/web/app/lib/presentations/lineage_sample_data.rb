module Presentations
  module LineageSampleData
    module_function

    SAMPLES = [
      {
        id: "lineage-root",
        title: "Quarterly Review May",
        purpose: "Root work: establish a baseline with margins, evidence, a footer, and a centered decision.",
        source: File.read(File.join(__dir__, "samples", "lineage-root.md"))
      },
      {
        id: "lineage-continuation-june",
        title: "Quarterly Review June",
        parent: "lineage-root",
        fork_type: "continuation",
        purpose: "Continuation work: preserve the review arc while updating evidence and the next decision.",
        source: File.read(File.join(__dir__, "samples", "lineage-continuation-june.md"))
      },
      {
        id: "lineage-inspiration-workshop",
        title: "Workshop Ideas",
        parent: "lineage-root",
        fork_type: "inspiration",
        purpose: "Inspiration work: deliberately reframe the review as a workshop rather than a continuation.",
        source: File.read(File.join(__dir__, "samples", "lineage-inspiration-workshop.md"))
      },
      {
        id: "lineage-continuation-july",
        title: "Quarterly Review July",
        parent: "lineage-continuation-june",
        fork_type: "continuation",
        purpose: "Second continuation: show a deeper branch with a durable metric and an explicit handoff.",
        source: File.read(File.join(__dir__, "samples", "lineage-continuation-july.md"))
      },
      {
        id: "lineage-inspiration-retrospective",
        title: "Retrospective Notes",
        parent: "lineage-inspiration-workshop",
        fork_type: "inspiration",
        purpose: "Second inspiration branch: preserve workshop learning while changing the output into practice notes.",
        source: File.read(File.join(__dir__, "samples", "lineage-inspiration-retrospective.md"))
      },
      {
        id: "lineage-product-root",
        title: "Product Launch Plan",
        purpose: "Root work: establish a launch narrative with a table, evidence, and a clear audience promise.",
        source: File.read(File.join(__dir__, "samples", "lineage-product-root.md"))
      },
      {
        id: "lineage-product-continuation",
        title: "Launch Narrative",
        parent: "lineage-product-root",
        fork_type: "continuation",
        purpose: "Continuation work: turn the launch plan into a sequence that can be presented to the next audience.",
        source: File.read(File.join(__dir__, "samples", "lineage-product-continuation.md"))
      },
      {
        id: "lineage-product-inspiration",
        title: "Customer Story",
        parent: "lineage-product-root",
        fork_type: "inspiration",
        purpose: "Inspiration work: reinterpret the launch plan through one customer story and a centered outcome.",
        source: File.read(File.join(__dir__, "samples", "lineage-product-inspiration.md"))
      },
      {
        id: "lineage-product-followup",
        title: "Launch Retrospective",
        parent: "lineage-product-continuation",
        fork_type: "continuation",
        purpose: "Second continuation: inspect launch outcomes and preserve a measurable feedback loop.",
        source: File.read(File.join(__dir__, "samples", "lineage-product-followup.md"))
      },
      {
        id: "lineage-product-brief",
        title: "Briefing Notes",
        parent: "lineage-product-inspiration",
        fork_type: "inspiration",
        purpose: "Second inspiration branch: compress the customer story into a briefing with a different audience and goal.",
        source: File.read(File.join(__dir__, "samples", "lineage-product-brief.md"))
      },
      {
        id: "lineage-research-root",
        title: "Research Questions",
        purpose: "Root work: frame a research program with questions, hypotheses, and a bounded next step.",
        source: File.read(File.join(__dir__, "samples", "lineage-research-root.md"))
      },
      {
        id: "lineage-research-continuation",
        title: "Research Findings",
        parent: "lineage-research-root",
        fork_type: "continuation",
        purpose: "Continuation work: turn research questions into evidence, a small model, and a decision.",
        source: File.read(File.join(__dir__, "samples", "lineage-research-continuation.md"))
      },
      {
        id: "lineage-research-inspiration",
        title: "Workshop Prompts",
        parent: "lineage-research-root",
        fork_type: "inspiration",
        purpose: "Inspiration work: turn research questions into prompts for a workshop rather than findings.",
        source: File.read(File.join(__dir__, "samples", "lineage-research-inspiration.md"))
      },
      {
        id: "lineage-research-next",
        title: "Decision Memo",
        parent: "lineage-research-continuation",
        fork_type: "continuation",
        purpose: "Second continuation: convert findings into a decision memo with an explicit recommendation and footnote.",
        source: File.read(File.join(__dir__, "samples", "lineage-research-next.md"))
      },
      {
        id: "lineage-research-remix",
        title: "Talk Outline",
        parent: "lineage-research-inspiration",
        fork_type: "inspiration",
        purpose: "Second inspiration branch: remix workshop prompts into a talk outline with a different narrative arc.",
        source: File.read(File.join(__dir__, "samples", "lineage-research-remix.md"))
      }
    ].each_with_index.map do |sample, index|
      day_offsets = [0, 7, 7, 14, 14, 0, 7, 7, 14, 14, 0, 7, 7, 14, 14]
      sample.merge(created_at: Time.utc(2026, 1, 1) + day_offsets[index].days + index.minutes)
    end.freeze

    def load!
      Presentation.transaction do
        records = {}

        SAMPLES.each do |attributes|
          record = Presentation.joins(:presentation_detail).find_by(presentation_details: { sample_id: attributes[:id] }) || Presentation.new
          record.assign_attributes(
            sample_id: attributes[:id],
            title: attributes[:title],
            source: attributes[:source],
            created_at: attributes[:created_at]
          )
          records[attributes[:id]] = record
        end

        SAMPLES.each do |attributes|
          record = records.fetch(attributes[:id])
          parent = records[attributes[:parent]]
          record.parent = parent
          record.fork_type = attributes[:fork_type] if attributes[:fork_type]
          record.save!
          if parent
            edge = PresentationLineageEdge.find_or_initialize_by(child_work: record)
            edge.assign_attributes(
              parent_work: parent,
              origin_revision: parent.latest_checkpoint,
              fork_type: attributes[:fork_type],
              parent_title_snapshot: parent.title,
              origin_source_snapshot: parent.source
            )
            edge.save!
          else
            PresentationLineageEdge.where(child_work: record).delete_all
          end
        end

        records.values
      end
    end
  end
end
