class MathShortcut < ApplicationRecord
  PREFIXES = [".", "@"].freeze

  belongs_to :workspace

  serialize :aliases, coder: JSON, type: Array

  before_validation :normalize_aliases
  before_validation :assign_workspace

  validates :name, :expansion, presence: true
  validates :name, length: { maximum: 120 }
  validates :prefix, inclusion: { in: PREFIXES }
  validates :aliases, presence: true
  validate :aliases_are_usable

  scope :built_ins, -> { where(built_in: true) }
  scope :personal, -> { where(built_in: false) }
  scope :ordered, -> { order(:prefix, :name, :id) }

  def self.search(query)
    return ordered if query.blank?

    terms = query.to_s.downcase.split(/\s+/)
    ordered.select { |shortcut| terms.all? { |term| shortcut.search_text.include?(term) } }
  end

  def search_text
    [name, aliases, description, prefix].flatten.join(" ").downcase
  end

  def aliases=(value)
    value = value.split(/[\s,]+/) if value.is_a?(String)
    super(Array(value).map(&:to_s))
  end

  private

  def assign_workspace
    self.workspace ||= Workspace.default
  end

  def normalize_aliases
    self.aliases = aliases.reject(&:blank?).map { |value| value.strip.downcase }.uniq
  end

  def aliases_are_usable
    aliases.each do |value|
      errors.add(:aliases, "must contain a word alias, a digit, or =") unless value.match?(/\A(?:[A-Za-z][A-Za-z0-9_-]*|[0-9]|=)\z/)
    end
  end
end
