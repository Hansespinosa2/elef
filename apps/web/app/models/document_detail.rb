class DocumentDetail < ApplicationRecord
  belongs_to :work

  validates :document_key, presence: true, uniqueness: true

  def canonical_link
    "[[document:#{document_key}]]"
  end
end
