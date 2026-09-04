module Presentations
  module LineageSampleData
    module_function

    SAMPLES = [
      { id: "lineage-root", title: "Quarterly Review May", source: "# Quarterly Review May\n\nThe starting point for the lineage example." },
      { id: "lineage-continuation-june", title: "Quarterly Review June", parent: "lineage-root", fork_type: "continuation", source: "# Quarterly Review June\n\nA formal continuation." },
      { id: "lineage-inspiration-workshop", title: "Workshop Ideas", parent: "lineage-root", fork_type: "inspiration", source: "# Workshop Ideas\n\nAn independent interpretation." },
      { id: "lineage-continuation-july", title: "Quarterly Review July", parent: "lineage-continuation-june", fork_type: "continuation", source: "# Quarterly Review July\n\nThe next formal continuation." },
      { id: "lineage-inspiration-retrospective", title: "Retrospective Notes", parent: "lineage-inspiration-workshop", fork_type: "inspiration", source: "# Retrospective Notes\n\nA second generation of inspiration." },
      { id: "lineage-product-root", title: "Product Launch Plan", source: "# Product Launch Plan\n\nA second lineage root for the library example." },
      { id: "lineage-product-continuation", title: "Launch Narrative", parent: "lineage-product-root", fork_type: "continuation", source: "# Launch Narrative\n\nThe launch story continues." },
      { id: "lineage-product-inspiration", title: "Customer Story", parent: "lineage-product-root", fork_type: "inspiration", source: "# Customer Story\n\nA related story inspired by the plan." },
      { id: "lineage-product-followup", title: "Launch Retrospective", parent: "lineage-product-continuation", fork_type: "continuation", source: "# Launch Retrospective\n\nWhat changed after launch." },
      { id: "lineage-product-brief", title: "Briefing Notes", parent: "lineage-product-inspiration", fork_type: "inspiration", source: "# Briefing Notes\n\nA new interpretation of the customer story." },
      { id: "lineage-research-root", title: "Research Questions", source: "# Research Questions\n\nA third independent lineage root." },
      { id: "lineage-research-continuation", title: "Research Findings", parent: "lineage-research-root", fork_type: "continuation", source: "# Research Findings\n\nEvidence collected from the questions." },
      { id: "lineage-research-inspiration", title: "Workshop Prompts", parent: "lineage-research-root", fork_type: "inspiration", source: "# Workshop Prompts\n\nPrompts inspired by the research." },
      { id: "lineage-research-next", title: "Decision Memo", parent: "lineage-research-continuation", fork_type: "continuation", source: "# Decision Memo\n\nA decision based on the findings." },
      { id: "lineage-research-remix", title: "Talk Outline", parent: "lineage-research-inspiration", fork_type: "inspiration", source: "# Talk Outline\n\nA presentation outline born from the prompts." }
    ].freeze

    def load!
      records = {}

      SAMPLES.each do |attributes|
        record = Presentation.find_or_initialize_by(sample_id: attributes[:id])
        record.assign_attributes(
          title: attributes[:title],
          source: attributes[:source],
          fork_type: attributes[:fork_type],
          fork_source: nil,
          fork_parent_title: nil
        )
        records[attributes[:id]] = record
      end

      SAMPLES.each do |attributes|
        record = records.fetch(attributes[:id])
        parent = records[attributes[:parent]]
        record.parent = parent
        record.fork_parent_title = parent&.title
        record.fork_source = parent&.source
        record.save!
      end

      records.values
    end
  end
end
