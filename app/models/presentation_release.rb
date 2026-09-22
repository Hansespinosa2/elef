class PresentationRelease < ApplicationRecord
  RENDERER_VERSION = "markdown-slides-v1".freeze

  belongs_to :work
  belongs_to :source_revision, class_name: "WorkRevision"

  serialize :settings, coder: JSON
  serialize :asset_manifest, coder: JSON

  validates :source_digest, :renderer_version, :render_digest, :published_at, presence: true
  validate :source_revision_belongs_to_work
  before_update :prevent_mutation
  before_destroy :prevent_deletion

  def stale?
    work.draft_digest != source_digest
  end

  def current?
    !stale?
  end

  def presentation
    Presentation.new(
      id: work.id,
      title: work.title,
      source: source_revision.source,
      work_type: "presentation"
    )
  end

  private

  def source_revision_belongs_to_work
    return if source_revision.blank? || source_revision.work_id == work_id

    errors.add(:source_revision, "must belong to the released work")
  end

  def prevent_mutation
    raise ActiveRecord::ReadOnlyRecord, "Presentation releases are immutable"
  end

  def prevent_deletion
    raise ActiveRecord::ReadOnlyRecord, "Presentation releases are immutable"
  end
end
