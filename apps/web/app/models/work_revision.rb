require "digest"

class WorkRevision < ApplicationRecord
  REASONS = %w[checkpoint recovery restore fork-origin publish import].freeze
  STATUSES = %w[checkpoint recovery restore fork-origin].freeze

  belongs_to :workspace
  belongs_to :work
  belongs_to :parent_revision, class_name: "WorkRevision", optional: true
  belongs_to :base_revision, class_name: "WorkRevision", optional: true

  serialize :metadata, coder: JSON, type: Hash

  validates :source_digest, :reason, :status, presence: true
  validates :reason, inclusion: { in: REASONS }
  validates :status, inclusion: { in: STATUSES }
  validate :source_digest_matches_source
  before_validation :prevent_persisted_mutation, on: :update
  before_update :prevent_mutation
  before_destroy :prevent_deletion

  scope :history, -> { order(created_at: :desc, id: :desc) }
  scope :checkpoints, -> { where(status: "checkpoint") }
  scope :recoveries, -> { where(status: "recovery") }

  def self.digest(source)
    Digest::SHA256.hexdigest(source.to_s)
  end

  def checkpoint?
    status == "checkpoint"
  end

  def recovery?
    status == "recovery"
  end

  private

  def source_digest_matches_source
    return if source_digest.blank? || source_digest == self.class.digest(source)

    errors.add(:source_digest, "does not match source")
  end

  def prevent_mutation
    raise ActiveRecord::ReadOnlyRecord, "Work revisions are immutable"
  end

  def prevent_persisted_mutation
    prevent_mutation if changed?
  end

  def prevent_deletion
    raise ActiveRecord::ReadOnlyRecord, "Work revisions are immutable"
  end
end
