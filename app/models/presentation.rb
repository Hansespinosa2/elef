class Presentation < ApplicationRecord
  DEFAULT_SOURCE = "# Untitled presentation\n\nStart writing Markdown here.".freeze
  FORK_TYPES = %w[continuation inspiration].freeze

  before_validation :normalize_source
  before_validation :derive_title, if: -> { title.blank? }
  before_validation :ensure_created_at

  validates :title, presence: true, length: { maximum: 120 }
  validates :fork_type, inclusion: { in: FORK_TYPES }, allow_nil: true
  validate :cannot_fork_from_itself

  belongs_to :parent, class_name: "Presentation", optional: true, inverse_of: :children
  has_many :children, class_name: "Presentation", foreign_key: :parent_id,
    dependent: :nullify, inverse_of: :parent

  scope :recent_first, -> { order(updated_at: :desc, id: :desc) }

  def document
    @document ||= Presentations::Document.parse(source.to_s, source_name: title)
  end

  def slides
    document.slides
  end

  def presentation_theme
    document.presentation_theme
  end

  def forked?
    parent_id.present?
  end

  def continuation?
    fork_type == "continuation"
  end

  def inspiration?
    fork_type == "inspiration"
  end

  def fork_as(type)
    raise ArgumentError, "Unsupported fork type" unless FORK_TYPES.include?(type.to_s)

    self.class.new(
      title: "#{title} (#{type.to_s.capitalize})",
      source: source,
      parent: self,
      fork_type: type,
      fork_source: source,
      fork_parent_title: title
    )
  end

  def source=(value)
    @document = nil
    super
  end

  def title=(value)
    @document = nil
    super
  end

  private

  def normalize_source
    self.source = source.to_s
  end

  def ensure_created_at
    self.created_at ||= Time.current
  end

  def derive_title
    self.title = Presentations::Document.normalize_folder_name(
      Presentations::Document.extract_first_h1(source.to_s),
      fallback: "Untitled presentation"
    )
  end

  def cannot_fork_from_itself
    errors.add(:parent, "cannot be itself") if parent_id.present? && parent_id == id
  end
end
