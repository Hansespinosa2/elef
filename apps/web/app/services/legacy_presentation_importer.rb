require "digest"
require "securerandom"

class LegacyPresentationImporter
  def self.call(workspace: Workspace.default)
    new(workspace: workspace).call
  end

  def initialize(workspace:)
    @workspace = workspace
  end

  def call
    connection = ActiveRecord::Base.connection
    raise "The legacy presentations table is not available" unless connection.data_source_exists?("presentations")

    imported = 0
    rows = connection.select_all("SELECT * FROM presentations ORDER BY id").to_a
    Work.transaction do
      rows.each do |row|
        next if Work.exists?(id: row.fetch("id"))

        work = build_work(row)
        work.save!
        imported += 1
      end
      rows.each do |row|
        work = Work.find_by(id: row.fetch("id"))
        next unless work

        import_lineage(work, row)
        import_release(work, row)
      end
    end
    imported
  end

  private

  def build_work(row)
    klass = row["work_type"].to_s == "document" ? Document : Presentation
    work = klass.new(
      id: row.fetch("id"),
      workspace: @workspace,
      title: row["title"].presence || default_title(klass),
      source: row["source"].to_s,
      created_at: row["created_at"],
      updated_at: row["updated_at"]
    )
    work.sample_id = row["sample_id"] if work.respond_to?(:sample_id) && row["sample_id"].present?
    work.set_initial_revision_metadata(
      reason: "import",
      metadata: { imported_legacy_id: row.fetch("id") }
    )
    work
  end

  def import_lineage(work, row)
    return unless work.presentation?
    return unless row["parent_id"].present? || row["fork_source"].present? || row["fork_parent_title"].present?

    parent = Work.find_by(id: row["parent_id"], kind: "presentation")
    edge = PresentationLineageEdge.find_or_initialize_by(child_work: work)
    edge.assign_attributes(
      parent_work: parent,
      origin_revision: parent&.latest_checkpoint,
      fork_type: PresentationLineageEdge::FORK_TYPES.include?(row["fork_type"].to_s) ? row["fork_type"] : "continuation",
      parent_title_snapshot: row["fork_parent_title"],
      origin_source_snapshot: row["fork_source"]
    )
    edge.save!
  end

  def import_release(work, row)
    return unless work.presentation? && row["last_published_at"].present?

    revision = work.latest_checkpoint
    digest = WorkRevision.digest(revision.source)
    release = work.presentation_releases.find_or_initialize_by(
      render_digest: Digest::SHA256.hexdigest([digest, "legacy", "{}", "[]"].join("\0"))
    )
    if release.new_record?
      release.assign_attributes(
        source_revision: revision,
        source_digest: digest,
        renderer_version: "legacy",
        settings: {},
        asset_manifest: [],
        published_at: row["last_published_at"]
      )
      release.save!
    end
    work.update_columns(published_release_id: release.id)
  end

  def default_title(klass)
    klass == Document ? "Untitled document" : "Untitled presentation"
  end
end
