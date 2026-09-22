class Workspace < ApplicationRecord
  has_many :works, dependent: :destroy
  has_many :work_revisions, dependent: :delete_all
  has_many :document_aliases, dependent: :destroy
  has_many :snippets, dependent: :destroy

  validates :name, :slug, presence: true
  validates :slug, uniqueness: true

  scope :system, -> { where(system: true) }

  def self.default
    find_or_create_by!(slug: "default") do |workspace|
      workspace.name = "Default workspace"
      workspace.system = true
    end
  rescue ActiveRecord::RecordNotUnique
    find_by!(slug: "default")
  end
end
