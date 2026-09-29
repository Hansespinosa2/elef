class Snippet < ApplicationRecord
  CATEGORIES = ["Markdown", "LaTeX", "Mermaid", "Elef DSL"].freeze

  belongs_to :workspace

  before_validation :assign_workspace

  validates :name, :trigger, :body, presence: true
  validates :name, length: { maximum: 120 }
  validates :trigger, format: { with: /\A[a-z0-9][a-z0-9-]*\z/ }
  validates :category, inclusion: { in: CATEGORIES }

  scope :built_ins, -> { where(built_in: true) }
  scope :personal, -> { where(built_in: false) }
  scope :ordered, -> { order(:category, :name, :id) }

  def self.search(query)
    return ordered if query.blank?

    terms = query.to_s.downcase.split(/\s+/)
    ordered.select { |snippet| terms.all? { |term| snippet.search_text.include?(term) } }
  end

  def search_text
    [name, trigger, description, category].join(" ").downcase
  end

  def display_body
    body.gsub(/\$\{\d+(?::([^}]*))?\}/) { Regexp.last_match(1).presence || "example" }
  end

  private

  def assign_workspace
    self.workspace ||= Workspace.default
  end

end
