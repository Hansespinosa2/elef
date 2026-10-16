class PresentationLineageEdge < ApplicationRecord
  FORK_TYPES = %w[continuation inspiration].freeze

  belongs_to :parent_work, class_name: "Work", optional: true
  belongs_to :child_work, class_name: "Work"
  belongs_to :origin_revision, class_name: "WorkRevision", optional: true

  validates :fork_type, inclusion: { in: FORK_TYPES }
  validates :child_work_id, uniqueness: true
  validate :presentation_works_only

  private

  def presentation_works_only
    if child_work && !child_work.presentation?
      errors.add(:child_work, "must be a presentation")
    end
    if parent_work && !parent_work.presentation?
      errors.add(:parent_work, "must be a presentation")
    end
  end
end
