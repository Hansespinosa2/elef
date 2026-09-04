module Presentations
  module LineageSampleData
    module_function

    SAMPLES = [
      { id: "lineage-root", title: "Quarterly Review May", source: "# Quarterly Review May\n\nThe starting point for the lineage example." },
      { id: "lineage-continuation-june", title: "Quarterly Review June", parent: "lineage-root", fork_type: "continuation", source: "# Quarterly Review June\n\nA formal continuation." },
      { id: "lineage-inspiration-workshop", title: "Workshop Ideas", parent: "lineage-root", fork_type: "inspiration", source: "# Workshop Ideas\n\nAn independent interpretation." },
      { id: "lineage-continuation-july", title: "Quarterly Review July", parent: "lineage-continuation-june", fork_type: "continuation", source: "# Quarterly Review July\n\nThe next formal continuation." },
      { id: "lineage-inspiration-retrospective", title: "Retrospective Notes", parent: "lineage-inspiration-workshop", fork_type: "inspiration", source: "# Retrospective Notes\n\nA second generation of inspiration." }
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
