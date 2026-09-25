class DocumentAlias < ApplicationRecord
  belongs_to :workspace
  belongs_to :work

  validates :alias_name, presence: true
  validates :alias_name, uniqueness: { scope: :workspace_id }

  scope :ordered, -> { order(:alias_name, :id) }
end
