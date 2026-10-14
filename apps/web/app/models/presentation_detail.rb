class PresentationDetail < ApplicationRecord
  belongs_to :work

  serialize :settings, coder: JSON, type: Hash

  validates :sample_id, uniqueness: true, allow_nil: true
end
