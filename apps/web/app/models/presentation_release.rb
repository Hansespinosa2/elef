class PresentationRelease < ApplicationRecord
  RENDERER_VERSION = "markdown-slides-v1".freeze

  belongs_to :work
  belongs_to :source_revision, class_name: "WorkRevision"

  serialize :settings, coder: JSON
  serialize :asset_manifest, coder: JSON

  validates :source_digest, :renderer_version, :render_digest, :published_at, presence: true
  validate :source_revision_belongs_to_work
  validate :work_is_presentation
  before_update :prevent_mutation
  before_destroy :prevent_deletion

  def self.asset_manifest_for(work)
    attachments = if work.persisted?
      ActiveStorage::Attachment.where(
        record_type: work.class.base_class.name,
        record_id: work.id,
        name: "assets"
      ).includes(:blob)
    else
      work.assets.attachments
    end

    attachments.map do |attachment|
      blob = attachment.blob
      {
        "id" => blob.id,
        "key" => blob.key,
        "filename" => blob.filename.to_s,
        "content_type" => blob.content_type,
        "byte_size" => blob.byte_size,
        "checksum" => blob.checksum
      }
    end.sort_by { |asset| [asset["key"].to_s, asset["filename"].to_s] }
  end

  def stale?
    return true if work.draft_digest != source_digest
    return true if renderer_version != self.class::RENDERER_VERSION

    pinned_title = settings.is_a?(Hash) && (settings["title"] || settings[:title])
    return true if pinned_title.present? && pinned_title != work.title

    Array(asset_manifest) != self.class.asset_manifest_for(work)
  end

  def current?
    !stale?
  end

  def presentation
    release_title = if settings.is_a?(Hash)
      settings["title"].presence || settings[:title].presence
    end
    released_presentation = Presentation.new(
      id: work.id,
      title: release_title.presence || work.title,
      source: source_revision.source,
      work_type: "presentation",
      workspace: work.workspace
    )
    released_presentation.assets = work.assets.blobs if work.assets.attached?
    released_presentation
  end

  private

  def source_revision_belongs_to_work
    return if source_revision.blank? || source_revision.work_id == work_id

    errors.add(:source_revision, "must belong to the released work")
  end

  def work_is_presentation
    return if work.blank? || work.presentation?

    errors.add(:work, "must be a presentation")
  end

  def prevent_mutation
    raise ActiveRecord::ReadOnlyRecord, "Presentation releases are immutable"
  end

  def prevent_deletion
    raise ActiveRecord::ReadOnlyRecord, "Presentation releases are immutable"
  end
end
